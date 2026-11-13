#!/usr/bin/python3 -I
"""Root-owned deploy coordinator. Project code always runs as deploy, never as root."""
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path('/var/lib/summa-deploy')
APP = Path('/var/www/knjigovodstvoonline')
SCRIPT = APP / 'deploy_knjigovodstvo.sh'
NODE_BIN = Path('/home/deploy/.nvm/versions/node/v22.18.0/bin')
LOCK = Path('/run/lock/summa-deploy-control.lock')
RUN_LOCK = Path('/run/lock/summa-deploy-run.lock')
BACKUP_HELPER = Path('/usr/local/sbin/summa-deploy-backup')
UNIT = 'summa-deploy.service'
SITE = 'knjigovodstvoonline'
# Only reviewed targets. Browser input never supplies paths, arguments, URLs or shell.
TARGETS = {
    SITE: {'app': APP, 'script': SCRIPT, 'branch': 'main', 'health': 'http://127.0.0.1:3004/'},
    'rahmetli': {'app': Path('/var/www/rahmetli.me'), 'script': Path('/var/www/rahmetli.me/deploy.sh'), 'branch': 'main', 'health': 'http://127.0.0.1:3002/'},
    'dokumenta': {'app': Path('/var/www/dokumenta'), 'script': Path('/var/www/dokumenta/deploy_dokumenta.sh'), 'branch': 'master', 'health': 'http://127.0.0.1:3001/api/health'},
    'royalservices': {'app': Path('/var/www/royalservices.me'), 'script': Path('/home/deploy/deploy-royal.sh'), 'branch': 'main', 'health': 'http://127.0.0.1:3003/health',
                      'sha256': '5a7e8929fc659372016475b3173440818031789036b913d7227a4f624d82a8b9'},
    'spedicija': {'app': Path('/var/www/spedicija'), 'script': Path('/var/www/spedicija/deploy_spedicija.sh'), 'branch': 'main', 'health': 'http://127.0.0.1:8590/api/health',
                 'sha256': 'c07458e1b9367403307dfdbb9a43840992ddc01447a988976a9423cf42faeb00'},
    'fiscal-api': {'app': Path('/home/deploy/apps/summa-fiscal'), 'script': Path('/home/deploy/apps/summa-fiscal/deploy/deploy-production.sh'), 'branch': 'main', 'health': 'http://127.0.0.1:8585/health'},
    'turizam': {'app': Path('/var/www/turizam'), 'script': Path('/var/www/turizam/scripts/deploy/update.sh'), 'branch': 'main', 'args': ['/etc/turizam/deploy.conf']},
}
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
COMMIT = re.compile(r'^[a-f0-9]{40}$')
PHASES = ('queued', 'preflight', 'backup', 'pull', 'dependencies', 'migrations', 'generate', 'build', 'restart', 'health', 'script', 'done')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC'}
APP_ENV = {**ENV, 'PATH': str(NODE_BIN) + ':/home/deploy/bin:/usr/local/bin:/usr/bin:/bin',
           'HOME': '/home/deploy', 'USER': 'deploy', 'LOGNAME': 'deploy', 'PM2_HOME': '/home/deploy/.pm2',
           'NODE_ENV': 'production', 'npm_config_include': 'dev', 'GIT_TERMINAL_PROMPT': '0', 'CI': 'true'}


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


def read_state(site=None):
    if site is not None and site not in TARGETS:
        raise ValueError('Unsupported site')
    path = ROOT / (site + '.json' if site else 'state.json')
    if site and not path.exists():
        legacy = read_state()
        return legacy if legacy.get('site') == site else {}
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
    site = state.get('site')
    if site not in TARGETS:
        raise ValueError('Unsupported site')
    # Global queue and per-site history; never copy success metadata between sites.
    for name in [site + '.json', 'state.json']:
        tmp = ROOT / (name + '.tmp')
        with tmp.open('w') as target:
            json.dump(state, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(tmp, ROOT / name)


def systemctl(*args, timeout=15):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, capture_output=True,
                          text=True, timeout=timeout, env=ENV).stdout


def properties(unit=None):
    return dict(line.split('=', 1) for line in systemctl('show', unit or UNIT, '--property=LoadState,ActiveState,SubState,Result').splitlines() if '=' in line)


def prepare_script(site):
    target = TARGETS[site]
    script = target['script']
    if not script.is_file() or script.is_symlink() or script.stat().st_size >= 65536:
        raise ValueError('Missing script')
    content = script.read_bytes()
    if target.get('sha256') and hashlib.sha256(content).hexdigest() != target['sha256']:
        raise ValueError('Adapter needs review')
    body = content.decode()
    if site == SITE and '# SUMMA_DEPLOY_PROTOCOL=1' not in body:
        raise ValueError('Old accounting script')
    # Adapt a verified snapshot, leaving other repositories and their scripts intact.
    if site == 'royalservices':
        body = body.replace('sudo git pull origin ', 'git pull --ff-only origin ')
        body = body.replace('sudo chown -R deploy:deploy "$APP_DIR"', ': # Existing deploy ownership is retained')
        body = body.replace('sudo chmod -R 755 "$APP_DIR"', ': # Existing file permissions are retained')
        body = body.replace('echo "⚠ Backend not running in PM2 yet - start it manually with:"', 'exit 1')
    if site == 'spedicija':
        body = body.replace('sudo nginx -t', ': # Fixed nginx check is performed by coordinator')
        body = body.replace('sudo systemctl reload nginx', ': # Fixed nginx reload is performed by coordinator')
    body = body.replace('git pull origin ', 'git pull --ff-only origin ')
    # bash -c snapshots keep $0 equal to the real script path, including nested launchers.
    body = body.replace('${BASH_SOURCE[0]}', '$0')
    return body


def git(site, *args):
    return subprocess.run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/bin/git', '-C', str(TARGETS[site]['app']), *args],
                          capture_output=True, text=True, timeout=5, env=APP_ENV)


def readiness(site):
    try:
        prepare_script(site)
    except (OSError, ValueError, UnicodeError):
        return 'script_unprepared'
    try:
        branch = git(site, 'branch', '--show-current')
        if branch.returncode != 0:
            return 'access_failed'
        if branch.stdout.strip() != TARGETS[site]['branch']:
            return 'wrong_branch'
        changes = git(site, 'status', '--porcelain', '--untracked-files=no')
        if changes.returncode != 0:
            return 'access_failed'
        if changes.stdout.strip():
            return 'uncommitted_changes'
    except (OSError, subprocess.TimeoutExpired):
        return 'access_failed'
    return None


def revision(site=SITE):
    result = git(site, 'rev-parse', 'HEAD')
    value = result.stdout.strip()
    return value if result.returncode == 0 and COMMIT.fullmatch(value) else None


def service_running(service):
    return service.get('ActiveState') in {'activating', 'active', 'deactivating', 'reloading'}


def public_status(site=SITE, service=None, current=None):
    service = properties() if service is None else service
    state = read_state(site)
    current = read_state() if current is None else current
    is_current = current.get('site') == site
    running = service_running(service) and is_current
    blocked = readiness(site) if service.get('LoadState') == 'loaded' else 'service_unavailable'
    outcome = state.get('outcome', 'idle')
    if outcome not in {'idle', 'running', 'succeeded', 'failed'}:
        outcome = 'failed'
    interrupted = not running and (outcome == 'running' or (is_current and outcome != 'failed' and service.get('Result') not in {None, '', 'success'}))
    if interrupted:
        outcome = 'failed'
    last = state.get('lastSuccess') or {}
    last_commit = last.get('commit')
    return {'version': 1, 'site': site, 'ready': blocked is None, 'blockReason': blocked,
            'checkedAt': now(), 'running': running, 'outcome': 'running' if running else outcome,
            'requestId': state.get('requestId') if UUID.fullmatch(str(state.get('requestId', ''))) else None,
            'phase': state.get('phase') if state.get('phase') in PHASES else 'queued',
            'startedAt': date(state.get('startedAt')), 'finishedAt': date(state.get('finishedAt')),
            'currentCommit': revision(site), 'backup': backup_status(state),
            'lastSuccess': {'at': date(last.get('at')), 'commit': last_commit} if date(last.get('at')) and isinstance(last_commit, str) and COMMIT.fullmatch(last_commit) else None,
            'error': 'interrupted' if interrupted else state.get('error') if state.get('error') in {'backup_failed', 'script_failed', 'preflight_failed', 'start_failed', 'interrupted'} else None}


def public_catalog():
    service = properties()
    current = read_state()
    current_site = current.get('site')
    running = service_running(service)
    return {'version': 2, 'checkedAt': now(), 'running': running,
            'activeSite': current_site if running and current_site in TARGETS else None,
            'sites': [public_status(site, service, current) for site in TARGETS]}


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {'requestId', 'actorId', 'site'} or not isinstance(request['site'], str) or request['site'] not in TARGETS:
        raise ValueError('Unsupported request')
    if any(not isinstance(request[k], str) or not UUID.fullmatch(request[k]) for k in ['requestId', 'actorId']):
        raise ValueError('Invalid identity')


def start(request):
    validate_request(request)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        service = properties()
        status = public_status(request['site'], service)
        if service_running(service):
            return {'status': 'already_running'}
        if not status['ready']:
            return {'status': 'setup_required'}
        prior = read_state()
        site_prior = read_state(request['site'])
        if prior.get('requestId') == request['requestId'] or site_prior.get('requestId') == request['requestId']:
            return {'status': 'already_requested'}
        requested = date(prior.get('requestedAt'))
        if requested and (datetime.now(timezone.utc) - datetime.fromisoformat(requested)).total_seconds() < 120:
            return {'status': 'cooldown'}
        state = {**request, 'requestedAt': now(), 'startedAt': None, 'finishedAt': None, 'phase': 'queued',
                 'outcome': 'running', 'lastSuccess': site_prior.get('lastSuccess')}
        write_state(state)
        # Audit intent must be durable before starting an external job.
        with (ROOT / 'requests.jsonl').open('a') as target:
            target.write(json.dumps(request | {'at': state['requestedAt']}) + '\n')
            target.flush()
            os.fsync(target.fileno())
        try:
            # An inactive oneshot can be garbage-collected by systemd: reset-failed
            # then fails with 'Unit not loaded'. Only reset an actual failed unit.
            if service.get('ActiveState') == 'failed':
                systemctl('reset-failed', UNIT)
            systemctl('start', '--no-block', UNIT)
        except Exception:
            state.update(outcome='failed', error='start_failed', finishedAt=now())
            write_state(state)
            raise
        return {'status': 'accepted'}


def backup_module():
    info = BACKUP_HELPER.stat()
    if BACKUP_HELPER.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('Backup helper is not root-owned')
    loader = importlib.machinery.SourceFileLoader('summa_deploy_backup_runtime', str(BACKUP_HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def backup_status(state):
    if not state.get('backup'):
        return None  # Legacy deployments did not have a per-request local backup.
    try:
        return backup_module().status(state['site'], state['requestId'])
    except Exception:
        return {**state['backup'], 'cloud': 'warning' if state['backup'].get('local') == 'verified' else 'not_required'}


def verified_backup(state):
    state['backup'] = backup_module().prepare(state['site'], state['requestId'])
    write_state(state)
    # A durable queue and independent timer survive app/deploy failures and reboots.
    # OneDrive availability cannot veto a verified local backup.
    if state['backup']['cloud'] != 'not_required':
        try:
            systemctl('start', '--no-block', 'summa-deploy-upload.service')
        except Exception:
            pass  # The timer retries; the UI continues to show the pending copy.


def run_script(state):
    target = TARGETS[state['site']]
    body = prepare_script(state['site'])
    log_path = ROOT / ('deploy-' + state['requestId'] + '.log')
    with log_path.open('wb') as log:
        child = subprocess.Popen(['/usr/sbin/runuser', '-u', 'deploy', '--', '/bin/bash', '-c', body, str(target['script']), *target.get('args', [])],
                                 cwd=target['app'], env=APP_ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
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


def verify_site(site):
    if site == 'spedicija':
        # Exactly these root operations; no path or command is supplied by the project.
        subprocess.run(['/usr/sbin/nginx', '-t'], check=True, capture_output=True, timeout=20, env=ENV)
        systemctl('reload', 'nginx')
    health = TARGETS[site].get('health')
    if health:
        for attempt in range(10):
            result = subprocess.run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/bin/curl',
                                     '--connect-timeout', '5', '--max-time', '10', '-fsS', '-o', '/dev/null', health],
                                    capture_output=True, timeout=15, env=APP_ENV)
            if result.returncode == 0:
                return
            if attempt < 9:
                time.sleep(2)
        raise RuntimeError('Site did not pass health check')
    # Turizam's update.mjs verifies the exact release revision and DB health itself.


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
            if readiness(state['site']) is not None or not (NODE_BIN / 'node').is_file():
                raise RuntimeError('Deployment prerequisites missing')
            state['phase'] = 'backup'
            write_state(state)
            verified_backup(state)
            state['phase'] = 'script'
            write_state(state)
            if run_script(state) != 0:
                raise RuntimeError('Deployment script failed')
            state['phase'] = 'health'
            write_state(state)
            verify_site(state['site'])
            commit = revision(state['site'])
            if not commit:
                raise RuntimeError('Deployment completion not confirmed')
            state.update(outcome='succeeded', phase='done', finishedAt=now(), error=None)
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
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'status', 'catalog', 'start', 'run'}:
        raise SystemExit('Unsupported operation')
    try:
        if sys.argv[1] == 'run':
            return run()
        result = public_status() if sys.argv[1] == 'status' else public_catalog() if sys.argv[1] == 'catalog' else start(json.loads(sys.stdin.read(4097)))
        if sys.argv[1] == 'status' and result.get('phase') == 'script':
            result['phase'] = 'preflight'  # Compatibility with the already deployed single-site UI.
        print(json.dumps(result))
        return 0
    except Exception:
        print(json.dumps({'error': 'DEPLOY_CONTROL_FAILED'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
