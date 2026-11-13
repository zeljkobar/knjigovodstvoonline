#!/usr/bin/python3 -I
"""Root-owned deploy coordinator. Project code always runs as deploy, never as root."""
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path('/var/lib/summa-deploy')
APP = Path('/var/www/knjigovodstvoonline')
SCRIPT = APP / 'deploy_knjigovodstvo.sh'
NODE_BIN = Path('/home/deploy/.nvm/versions/node/v22.18.0/bin')
LOCK = Path('/run/lock/summa-deploy-control.lock')
RUN_LOCK = Path('/run/lock/summa-deploy-run.lock')
BACKUP_STATE = Path('/var/lib/summa-backup/last-run.json')
UNIT = 'summa-deploy.service'
SITE = 'knjigovodstvoonline'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
COMMIT = re.compile(r'^[a-f0-9]{40}$')
PHASES = ('queued', 'preflight', 'backup', 'pull', 'dependencies', 'migrations', 'generate', 'build', 'restart', 'health', 'done')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC'}
APP_ENV = {**ENV, 'PATH': str(NODE_BIN) + ':/home/deploy/bin:/usr/local/bin:/usr/bin:/bin',
           'HOME': '/home/deploy', 'USER': 'deploy', 'LOGNAME': 'deploy', 'PM2_HOME': '/home/deploy/.pm2',
           'NODE_ENV': 'production', 'GIT_TERMINAL_PROMPT': '0', 'CI': 'true'}


def now():
    return datetime.now(timezone.utc).isoformat()


def date(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None
    except ValueError:
        return None


def read_state():
    path = ROOT / 'state.json'
    if not path.exists():
        return {}
    if path.is_symlink() or path.stat().st_size > 262144:
        raise ValueError('Invalid state')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('Invalid state')
    return value


def write_state(state):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = ROOT / 'state.tmp'
    with tmp.open('w') as target:
        json.dump(state, target)
        target.flush()
        os.fsync(target.fileno())
    os.replace(tmp, ROOT / 'state.json')


def systemctl(*args, timeout=15):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, capture_output=True,
                          text=True, timeout=timeout, env=ENV).stdout


def properties(unit=UNIT):
    return dict(line.split('=', 1) for line in systemctl('show', unit, '--property=LoadState,ActiveState,SubState,Result').splitlines() if '=' in line)


def script_ready():
    return SCRIPT.is_file() and not SCRIPT.is_symlink() and SCRIPT.stat().st_size < 65536 and '# SUMMA_DEPLOY_PROTOCOL=1' in SCRIPT.read_text()


def revision():
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/bin/git', '-C', str(APP), 'rev-parse', 'HEAD'],
                            capture_output=True, text=True, timeout=10, env=APP_ENV)
    value = result.stdout.strip()
    return value if result.returncode == 0 and COMMIT.fullmatch(value) else None


def public_status():
    service = properties()
    state = read_state()
    running = service.get('ActiveState') in {'activating', 'active', 'deactivating', 'reloading'}
    outcome = state.get('outcome', 'idle')
    if outcome not in {'idle', 'running', 'succeeded', 'failed'}:
        outcome = 'failed'
    interrupted = not running and (outcome == 'running' or (outcome != 'failed' and service.get('Result') not in {None, '', 'success'}))
    if interrupted:
        outcome = 'failed'
    last = state.get('lastSuccess') or {}
    last_commit = last.get('commit')
    return {'version': 1, 'site': SITE, 'ready': service.get('LoadState') == 'loaded' and script_ready(),
            'checkedAt': now(), 'running': running, 'outcome': 'running' if running else outcome,
            'requestId': state.get('requestId') if UUID.fullmatch(str(state.get('requestId', ''))) else None,
            'phase': state.get('phase') if state.get('phase') in PHASES else 'queued',
            'startedAt': date(state.get('startedAt')), 'finishedAt': date(state.get('finishedAt')),
            'currentCommit': revision(),
            'lastSuccess': {'at': date(last.get('at')), 'commit': last_commit} if date(last.get('at')) and isinstance(last_commit, str) and COMMIT.fullmatch(last_commit) else None,
            'error': 'interrupted' if interrupted else state.get('error') if state.get('error') in {'backup_failed', 'script_failed', 'preflight_failed', 'start_failed', 'interrupted'} else None}


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {'requestId', 'actorId', 'site'} or request['site'] != SITE:
        raise ValueError('Unsupported request')
    if any(not isinstance(request[k], str) or not UUID.fullmatch(request[k]) for k in ['requestId', 'actorId']):
        raise ValueError('Invalid identity')


def start(request):
    validate_request(request)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        status = public_status()
        if status['running']:
            return {'status': 'already_running'}
        if not status['ready']:
            return {'status': 'setup_required'}
        prior = read_state()
        if prior.get('requestId') == request['requestId']:
            return {'status': 'already_requested'}
        requested = date(prior.get('requestedAt'))
        if requested and (datetime.now(timezone.utc) - datetime.fromisoformat(requested)).total_seconds() < 120:
            return {'status': 'cooldown'}
        state = {**request, 'requestedAt': now(), 'startedAt': None, 'finishedAt': None, 'phase': 'queued',
                 'outcome': 'running', 'lastSuccess': prior.get('lastSuccess')}
        write_state(state)
        # Audit intent must be durable before starting an external job.
        with (ROOT / 'requests.jsonl').open('a') as target:
            target.write(json.dumps(request | {'at': state['requestedAt']}) + '\n')
            target.flush()
            os.fsync(target.fileno())
        try:
            systemctl('reset-failed', UNIT)
            systemctl('start', '--no-block', UNIT)
        except Exception:
            state.update(outcome='failed', error='start_failed', finishedAt=now())
            write_state(state)
            raise
        return {'status': 'accepted'}


def verified_backup():
    began = now()
    service = properties('summa-backup.service')
    systemctl('reset-failed', 'summa-backup.service')
    systemctl('restart' if service.get('SubState') == 'auto-restart' else 'start', 'summa-backup.service', timeout=7300)
    state = json.loads(BACKUP_STATE.read_text())
    finished = date(state.get('finished_utc'))
    if state.get('ok') is not True or not finished or finished < began or state.get('databases', {}).get(SITE, {}).get('ok') is not True:
        raise RuntimeError('No fresh verified backup')


def run_script(state):
    # A snapshot avoids executing a partially rewritten shell file after its git pull.
    body = SCRIPT.read_text()
    if '# SUMMA_DEPLOY_PROTOCOL=1' not in body or len(body) > 65536:
        raise RuntimeError('Unprepared deploy script')
    log_path = ROOT / ('deploy-' + state['requestId'] + '.log')
    with log_path.open('wb') as log:
        child = subprocess.Popen(['/usr/sbin/runuser', '-u', 'deploy', '--', '/bin/bash', '-c', body, str(SCRIPT)],
                                 cwd=APP, env=APP_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        written = 0
        assert child.stdout is not None
        # Bounded chunks avoid retaining arbitrary command output in memory or exposing it to the UI.
        pending = b''
        for chunk in iter(lambda: child.stdout.read1(4096), b''):
            if written < 5_000_000:
                kept = chunk[:5_000_000-written]
                log.write(kept)
                written += len(kept)
            pending = (pending + chunk)[-8192:]
            lines = pending.split(b'\n')
            pending = lines.pop()
            for line in lines:
                match = re.fullmatch(rb'::SUMMA_DEPLOY_PHASE::([a-z]+)\r?', line)
                if match and match[1].decode() in PHASES:
                    # The backup has already run; the script cannot replace coordinator phases.
                    phase = match[1].decode()
                    if phase not in {'queued', 'backup'}:
                        state['phase'] = phase
                        write_state(state)
        return child.wait()


def run():
    with RUN_LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = read_state()
        validate_request({key: state.get(key) for key in ['site', 'requestId', 'actorId']})
        if state.get('outcome') != 'running' or state.get('phase') != 'queued':
            raise RuntimeError('No queued request')
        state.update(startedAt=now(), phase='preflight')
        write_state(state)
        try:
            if not script_ready() or not (NODE_BIN / 'node').is_file():
                raise RuntimeError('Deployment prerequisites missing')
            state['phase'] = 'backup'
            write_state(state)
            verified_backup()
            state['phase'] = 'preflight'
            write_state(state)
            if run_script(state) != 0:
                raise RuntimeError('Deployment script failed')
            commit = revision()
            if state.get('phase') != 'done' or not commit:
                raise RuntimeError('Deployment completion not confirmed')
            state.update(outcome='succeeded', finishedAt=now(), error=None)
            state['lastSuccess'] = {'at': state['finishedAt'], 'commit': commit}
            write_state(state)
            return 0
        except Exception:
            code = 'backup_failed' if state['phase'] == 'backup' else 'preflight_failed' if state['phase'] == 'preflight' else 'script_failed'
            state.update(outcome='failed', finishedAt=now(), error=code)
            write_state(state)
            return 1


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'status', 'start', 'run'}:
        raise SystemExit('Unsupported operation')
    try:
        if sys.argv[1] == 'run':
            return run()
        result = public_status() if sys.argv[1] == 'status' else start(json.loads(sys.stdin.read(4097)))
        print(json.dumps(result))
        return 0
    except Exception:
        print(json.dumps({'error': 'DEPLOY_CONTROL_FAILED'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
