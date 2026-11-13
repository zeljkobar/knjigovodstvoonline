#!/usr/bin/env python3
"""Manual recovery drill. Restores into uniquely named disposable databases only."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid


DATABASES = {"knjigovodstvoonline": "knjigovodstvoonline", "summa_fiscal": "fiskal-api",
             "spedicija": "spedicija", "turizam_prod": "turizam_prod"}


def run(args, **kwargs):
    result = subprocess.run(args, stderr=subprocess.PIPE, timeout=1800, **kwargs)
    if result.returncode:
        raise RuntimeError(f"Recovery check failed: {Path(args[0]).name} exit {result.returncode}")
    return result


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root on the backup server")
    os.umask(0o077)
    config = json.loads(Path('/etc/summa-backup/config.json').read_text())
    if config["databases"] != DATABASES or config["remote_root"] != 'summa_onedrive:Summa backup':
        raise SystemExit("Unexpected backup scope")
    pg = ['/usr/sbin/runuser', '-u', 'postgres', '--']
    connection = ['--host=/var/run/postgresql', '--port=5432']
    results = []
    for database, folder in DATABASES.items():
        state = json.loads((Path(config['state_root']) / (database + '.json')).read_text())
        name = state['filename']
        if not re.fullmatch(rf'summa-{re.escape(database)}-\d{{8}}T\d{{6}}Z-[a-f0-9]{{8}}\.tar\.age', name):
            raise RuntimeError('Invalid backup filename')
        test_db = 'summa_restore_check_' + uuid.uuid4().hex[:16]
        created = False
        try:
            with tempfile.TemporaryDirectory(prefix='summa-restore-') as work:
                work = Path(work)
                encrypted = work / 'backup.tar.age'
                with encrypted.open('wb') as target:
                    run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/local/bin/rclone',
                         '--config', config['rclone_config'], '--contimeout', '15s', '--timeout', '2m',
                         'cat', config['remote_root'] + '/' + folder + '/' + name], stdout=target)
                if hashlib.sha256(encrypted.read_bytes()).hexdigest() != state['encrypted_sha256']:
                    raise RuntimeError('Encrypted backup checksum mismatch')
                archive = work / 'backup.tar'
                run(['/usr/bin/age', '--decrypt', '--identity', '/etc/summa-backup/recovery.agekey',
                     '--output', str(archive), str(encrypted)], stdout=subprocess.DEVNULL)
                with tarfile.open(archive) as tar:
                    metadata = json.load(tar.extractfile('backup.json'))
                    dump = work / 'database.dump'
                    with dump.open('wb') as target:
                        shutil.copyfileobj(tar.extractfile('database.dump'), target)
                    if metadata['database'] != database or hashlib.sha256(dump.read_bytes()).hexdigest() != metadata['dump_sha256']:
                        raise RuntimeError('Database dump checksum mismatch')
                    for label in config.get('recovery_files', {}).get(database, {}):
                        if tar.getmember('recovery/' + label).size == 0:
                            raise RuntimeError('Recovery material is empty')
                    if database == 'summa_fiscal':
                        for label in config['fiscal_attachments']:
                            if not tar.getmember(label).isdir():
                                raise RuntimeError('Fiscal attachment directory missing')
                # No --if-exists/--clean, no reuse: a collision fails without touching it.
                run(pg + ['/usr/bin/createdb', *connection, '--template=template0', test_db], stdout=subprocess.DEVNULL)
                created = True
                with dump.open('rb') as source:
                    run(pg + ['/usr/bin/pg_restore', *connection, '--no-owner', '--no-privileges',
                              '--exit-on-error', '--dbname=' + test_db], stdin=source, stdout=subprocess.DEVNULL)
                count = run(pg + ['/usr/bin/psql', *connection, '-X', '-At', '--dbname=' + test_db,
                                 '-c', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';"], stdout=subprocess.PIPE).stdout.decode().strip()
                print(f'{database}: download, decryption, checksum, full restore OK ({count} tables)', flush=True)
                results.append({'database': database, 'filename': name, 'tables': int(count), 'ok': True})
        finally:
            if created:
                run(pg + ['/usr/bin/dropdb', *connection, test_db], stdout=subprocess.DEVNULL)
    from datetime import datetime, timezone
    Path(config['state_root'], 'last-restore-check.json').write_text(json.dumps({
        'checked_utc': datetime.now(timezone.utc).isoformat(), 'ok': True, 'databases': results
    }, indent=2) + '\n')
    print('All recovery checks passed; temporary databases removed', flush=True)


if __name__ == '__main__':
    main()
