#!/usr/bin/python3 -I
"""Privileged, fixed-scope bridge. Only public status and starting the backup unit."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path('/var/lib/summa-backup')
LOCK = Path('/run/lock/summa-backup-control.lock')
DATABASES = ('knjigovodstvoonline', 'summa_fiscal', 'spedicija', 'turizam_prod')
PHASES = {'queued', 'dumping', 'encrypting', 'uploading', 'verifying', 'pruning', 'done', 'failed'}
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC'}


def now():
    return datetime.now(timezone.utc)


def read(name):
    path = ROOT / name
    if not path.exists():
        return {}
    if path.is_symlink() or path.stat().st_size > 262144:
        raise ValueError('Invalid state file')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('Invalid state')
    return value


def timestamp(value):
    if not isinstance(value, str) or len(value) > 80:
        return None
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            return None
        return date.astimezone(timezone.utc).isoformat()
    except ValueError:
        match = re.search(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', value)
        if match and value.endswith(' UTC'):
            return datetime.strptime(match[0], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).isoformat()
    return None


def command(*args):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, capture_output=True,
                          text=True, timeout=10, env=ENV).stdout


def properties(unit, fields):
    output = command('show', unit, '--property=' + ','.join(fields))
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def public_status():
    timer = properties('summa-backup.timer', ['LoadState', 'ActiveState', 'UnitFileState', 'NextElapseUSecRealtime'])
    service = properties('summa-backup.service', ['LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStartTimestamp'])
    if timer.get('LoadState') != 'loaded' or service.get('LoadState') != 'loaded':
        raise RuntimeError('Backup service unavailable')
    running = service.get('ActiveState') in {'activating', 'active', 'deactivating', 'reloading'} and service.get('SubState') != 'auto-restart'
    latest, current, restore = read('last-run.json'), read('current-run.json'), read('last-restore-check.json')
    current_start = timestamp(current.get('started_utc'))
    service_start = timestamp(service.get('ExecMainStartTimestamp'))
    current_matches = bool(running and current_start and not current.get('finished_utc')
                           and (not service_start or current_start >= service_start))
    rows = []
    for database in DATABASES:
        saved = read(database + '.json')
        last_ok = timestamp(saved.get('verified_utc'))
        filename = saved.get('filename', '')
        valid_name = isinstance(filename, str) and re.fullmatch(rf'summa-{database}-\d{{8}}T\d{{6}}Z-[a-f0-9]{{8}}\.tar\.age', filename)
        size = saved.get('encrypted_bytes')
        success = {'verifiedAt': last_ok, 'bytes': size, 'filename': filename} if last_ok and valid_name and type(size) is int and 0 < size < 2**53 else None
        attempt = latest.get('databases', {}).get(database, {})
        phase = current.get('databases', {}).get(database, {}).get('phase') if current_matches else None
        rows.append({'database': database, 'lastSuccess': success,
                     'lastAttempt': {'finishedAt': timestamp(latest.get('finished_utc')), 'ok': attempt['ok']}
                     if type(attempt.get('ok')) is bool else None,
                     'phase': phase if phase in PHASES else ('queued' if running else None)})
    return {'version': 1, 'checkedAt': now().isoformat(), 'running': running,
            'retryPending': service.get('SubState') == 'auto-restart',
            'serviceFailed': service.get('Result') not in {None, '', 'success'},
            'startedAt': service_start if running else None,
            'scheduler': {'enabled': timer.get('UnitFileState') in {'enabled', 'enabled-runtime'},
                          'active': timer.get('ActiveState') == 'active',
                          'nextRunAt': timestamp(timer.get('NextElapseUSecRealtime'))},
            'lastRestoreAt': timestamp(restore.get('checked_utc')) if restore.get('ok') is True else None,
            'databases': rows}


def write_request(value):
    ROOT.mkdir(mode=0o700, exist_ok=True)
    path = ROOT / 'manual-request.json'
    temporary = ROOT / 'manual-request.tmp'
    temporary.write_text(json.dumps(value) + '\n')
    os.replace(temporary, path)


def start(request):
    if not isinstance(request, dict) or set(request) != {'requestId', 'actorId'} or any(
        not isinstance(request[k], str) or not UUID.fullmatch(request[k]) for k in request):
        raise ValueError('Invalid request')
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = public_status()
        if state['running']:
            return {'status': 'already_running'}
        prior = read('manual-request.json')
        # Repeated clicks/retried requests never enqueue a second backup.
        if prior.get('requestId') == request['requestId'] and prior.get('status') != 'failed':
            return {'status': 'already_requested'}
        created = timestamp(prior.get('createdAt'))
        if created and (now() - datetime.fromisoformat(created)).total_seconds() < 120:
            return {'status': 'cooldown'}
        record = {**request, 'createdAt': now().isoformat(), 'status': 'requested'}
        # Durable intent before the external action; a failed audit write prevents start.
        write_request(record)
        with (ROOT / 'manual-requests.jsonl').open('a') as audit:
            audit.write(json.dumps(record) + '\n')
            audit.flush()
            os.fsync(audit.fileno())
        try:
            # An explicit audited manual request begins a fresh retry allowance.
            # Automatic retries remain limited by the unit's StartLimit settings.
            command('reset-failed', 'summa-backup.service')
            # start alone does not cancel systemd's pending 15-minute retry delay.
            command('restart' if state.get('retryPending') else 'start', '--no-block', 'summa-backup.service')
        except Exception:
            write_request({**record, 'status': 'failed'})
            raise
        write_request({**record, 'status': 'accepted'})
        return {'status': 'accepted'}


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'status', 'start'}:
        raise SystemExit('Unsupported operation')
    try:
        result = public_status() if sys.argv[1] == 'status' else start(json.loads(sys.stdin.read(2049)))
        print(json.dumps(result))
    except Exception:
        # Never expose stderr, paths, environment, raw files or exception details to the app.
        print(json.dumps({'error': 'BACKUP_CONTROL_FAILED'}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
