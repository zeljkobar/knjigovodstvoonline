#!/usr/bin/python3 -I
"""Local pre-deploy backups and an independent, durable OneDrive upload queue."""
from datetime import datetime, timedelta, timezone
import fcntl
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid

BASE_HELPER = Path('/usr/local/sbin/summa-backup')
CONFIG = Path('/etc/summa-backup/config.json')
ROOT = Path('/var/lib/summa-deploy-backup')
LOCAL = Path('/var/backups/summa-deploy')
CREATE_LOCK = Path('/run/lock/summa-deploy-backup.lock')
UPLOAD_LOCK = Path('/run/lock/summa-deploy-upload.lock')
IDENTITY = Path('/etc/summa-backup/recovery.agekey')
# Reviewed actual storage, not inferred from site names. Royal only sends email.
DATABASES = {'knjigovodstvoonline': 'knjigovodstvoonline', 'rahmetli': 'rahmetli_me',
             'dokumenta': 'dokumenta_portal', 'royalservices': None,
             'spedicija': 'spedicija', 'fiscal-api': 'summa_fiscal', 'turizam': 'turizam_prod',
             'summasummarum': 'summasum_'}
MYSQL_ENV = {'rahmetli_me': Path('/var/www/rahmetli.me/.env'),
             'dokumenta_portal': Path('/var/www/dokumenta/.env'),
             'summasum_': Path('/var/www/app/.env')}
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


def now():
    return datetime.now(timezone.utc).isoformat()


def trusted_module(path, name):
    info = path.stat()
    if path.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('Backup helper is not root-owned')
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def backend():
    base = trusted_module(BASE_HELPER, 'summa_backup_runtime')
    config = base.load_config(CONFIG)
    # Separate workspace/state/remote namespace: nightly cleanup cannot touch this queue.
    config.update(local_root=str(LOCAL), state_root=str(ROOT), remote_root=config['remote_root'] + '/deploy')
    return base, base.Backups(config)


def validate(site, request_id):
    if site not in DATABASES or not isinstance(request_id, str) or not UUID.fullmatch(request_id):
        raise ValueError('Invalid backup request')


def save(record):
    validate(record['site'], record['requestId'])
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = ROOT / (record['requestId'] + '.json')
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as out:
        json.dump(record, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)
    fd = os.open(ROOT, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(site, request_id):
    validate(site, request_id)
    path = ROOT / (request_id + '.json')
    if path.is_symlink() or path.stat().st_size > 16384:
        raise ValueError('Invalid backup record')
    record = json.loads(path.read_text())
    if record.get('site') != site or record.get('requestId') != request_id or record.get('database') != DATABASES[site]:
        raise ValueError('Mismatched backup record')
    if record.get('cloud') not in {'queued', 'uploading', 'verified', 'warning', 'not_required'}:
        raise ValueError('Invalid upload state')
    return record


def public(record):
    return {k: record.get(k) for k in ['database', 'local', 'createdAt', 'cloud', 'uploadedAt', 'retained']}


def status(site, request_id):
    return public(read(site, request_id))


def mysql_create(base, worker, database):
    # Local root socket authentication; no credentials in commands or environment.
    engines = base.run(['/usr/bin/mysql', '--protocol=socket', '--batch', '--skip-column-names', '-e',
                       "SELECT DISTINCT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='" + database + "' AND TABLE_TYPE='BASE TABLE'"])
    if not engines.strip() or any(e != b'InnoDB' for e in engines.splitlines()):
        raise RuntimeError('MySQL tables do not support a consistent transaction snapshot')
    name = f"summa-{database}-{datetime.now(timezone.utc).strftime(base.FORMAT)}-{uuid.uuid4().hex[:8]}.tar.age"
    folder = LOCAL / database
    folder.mkdir(mode=0o750, parents=True, exist_ok=True)
    worker.share_encrypted(folder, 0o750)
    with tempfile.TemporaryDirectory(prefix='.work-', dir=LOCAL) as temporary:
        work = Path(temporary)
        dump = work / 'database.sql'
        with dump.open('wb') as out:
            base.run(['/usr/bin/mysqldump', '--protocol=socket', '--single-transaction', '--quick',
                      '--routines', '--triggers', '--events', '--hex-blob', database], stdout=out)
        with dump.open('rb') as source:
            source.seek(max(0, dump.stat().st_size - 1024))
            complete = b'-- Dump completed on ' in source.read()
        if dump.stat().st_size < 100 or not complete:
            raise RuntimeError('Incomplete MySQL dump')
        metadata = {'database': database, 'created_utc': now(), 'dump_format': 'MySQL SQL',
                    'dump_sha256': base.sha256(dump), 'dump_bytes': dump.stat().st_size}
        recovery = work / 'recovery'
        recovery.mkdir(mode=0o700)
        shutil.copyfile(MYSQL_ENV[database], recovery / 'application.env')
        os.chmod(recovery / 'application.env', 0o600)
        base.atomic_json(work / 'backup.json', metadata)
        archive = work / 'backup.tar'
        with tarfile.open(archive, 'w') as tar:
            for item in [dump, work / 'backup.json', recovery]:
                tar.add(item, arcname=item.name)
        encrypted = work / name
        base.run(['/usr/bin/age', '--recipients-file', worker.config['recipients_file'], '--output', str(encrypted), str(archive)])
        os.replace(encrypted, folder / name)
    path = folder / name
    worker.share_encrypted(path, 0o640)
    metadata.update(filename=name, encrypted_bytes=path.stat().st_size, encrypted_sha256=base.sha256(path))
    return path, metadata


def verify_local(base, path, metadata):
    if path.is_symlink() or path.stat().st_size != metadata['encrypted_bytes'] or base.sha256(path) != metadata['encrypted_sha256']:
        raise RuntimeError('Local encrypted backup mismatch')
    # Verify age authentication and actual contents after decryption, without extracting paths.
    with tempfile.TemporaryDirectory(prefix='.work-', dir=LOCAL) as temporary:
        work = Path(temporary)
        archive = work / 'backup.tar'
        base.run(['/usr/bin/age', '--decrypt', '--identity', str(IDENTITY), '--output', str(archive), str(path)])
        dump = work / 'dump'
        member_name = 'database.sql' if metadata['database'] in MYSQL_ENV else 'database.dump'
        with tarfile.open(archive) as tar:
            member = tar.getmember(member_name)
            if not member.isfile() or member.size != metadata['dump_bytes']:
                raise RuntimeError('Invalid archived database')
            with tar.extractfile(member) as source, dump.open('wb') as target:
                shutil.copyfileobj(source, target)
        if base.sha256(dump) != metadata['dump_sha256']:
            raise RuntimeError('Archived dump checksum mismatch')
        if member_name == 'database.dump':
            base.run(['/usr/bin/pg_restore', '--list', str(dump)], stdout=subprocess.DEVNULL)
    with path.open('rb') as file:
        os.fsync(file.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def prepare(site, request_id):
    validate(site, request_id)
    with CREATE_LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (ROOT / (request_id + '.json')).exists():
            raise RuntimeError('Cannot reuse an earlier pre-deploy backup')
        database = DATABASES[site]
        record = {'site': site, 'requestId': request_id, 'database': database, 'createdAt': now(),
                  'local': 'not_required' if database is None else 'verified',
                  'cloud': 'not_required' if database is None else 'queued', 'uploadedAt': None, 'retained': database is not None}
        if database is not None:
            base, worker = backend()
            LOCAL.mkdir(mode=0o750, parents=True, exist_ok=True)
            worker.share_encrypted(LOCAL, 0o750)
            # Only our creation workspace, protected by CREATE_LOCK; no nightly files.
            for entry in LOCAL.glob('.work-*'):
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
            path, metadata = mysql_create(base, worker, database) if database in MYSQL_ENV else worker.create(database)
            verify_local(base, path, metadata)
            record['metadata'] = metadata
        # No successful result until both the verified file and upload job are durable.
        save(record)
        return public(record)


def backup_path(record, base):
    database, metadata = record['database'], record['metadata']
    name = metadata['filename']
    if database not in DATABASES.values() or not database or metadata.get('database') != database or base.backup_time(database, name) is None:
        raise ValueError('Invalid queued backup')
    return LOCAL / database / name


def upload_one(record, base, worker):
    path = backup_path(record, base)
    meta = record['metadata']
    record.update(cloud='uploading', attemptedAt=now())
    save(record)
    try:
        if path.is_symlink() or path.stat().st_size != meta['encrypted_bytes'] or base.sha256(path) != meta['encrypted_sha256']:
            raise RuntimeError('Local backup changed')
        destination = worker.config['remote_root'] + '/' + record['database'] + '/' + path.name
        worker.rclone('copyto', str(path), destination, '--immutable')
        size, digest = worker.verify_remote(destination)
        if size != meta['encrypted_bytes'] or digest != meta['encrypted_sha256']:
            raise RuntimeError('Uploaded backup verification failed')
        record.update(cloud='verified', uploadedAt=now())
    except Exception:
        # Local copy remains intact and will be retried, independent of deploy outcome.
        record.update(cloud='warning')
    save(record)


def prune(records, base, worker):
    # Delete only files named in verified queue records. Unsent backups never expire.
    verified = [r for r in records if r['cloud'] == 'verified' and r.get('retained')]
    latest = {r['database']: max(v['createdAt'] for v in verified if v['database'] == r['database']) for r in verified}
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    for record in verified:
        if record['createdAt'] == latest[record['database']] or datetime.fromisoformat(record['createdAt']) >= cutoff:
            continue
        path = backup_path(record, base)
        try:
            worker.rclone('deletefile', worker.config['remote_root'] + '/' + record['database'] + '/' + path.name)
            path.unlink(missing_ok=True)
            record['retained'] = False
            save(record)
        except Exception:
            print('Deploy backup retention will be retried', flush=True)


def upload():
    with UPLOAD_LOCK.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        base, worker = backend()
        records = []
        for path in sorted(ROOT.glob('*.json')):
            if not UUID.fullmatch(path.stem):
                continue
            try:
                value = json.loads(path.read_text())
                record = read(value['site'], path.stem)
                records.append(record)
                if record['cloud'] in {'queued', 'uploading', 'warning'}:
                    upload_one(record, base, worker)
            except Exception:
                print('Invalid deploy backup queue entry; retained for review', flush=True)
        prune(records, base, worker)
        return 0


if __name__ == '__main__':
    os.umask(0o077)
    if os.geteuid() != 0 or sys.argv[1:] != ['upload']:
        raise SystemExit('Unsupported operation')
    sys.exit(upload())
