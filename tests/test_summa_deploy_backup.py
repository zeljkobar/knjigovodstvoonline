import importlib.util
import json
from pathlib import Path
import tempfile
import tarfile
import io
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('deploy_backup', Path(__file__).resolve().parents[1] / 'scripts/ops/summa-deploy-backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class DeployBackupTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name)
        for name, value in [('ROOT', self.root / 'state'), ('LOCAL', self.root / 'local'),
                            ('CREATE_LOCK', self.root / 'create.lock'), ('UPLOAD_LOCK', self.root / 'upload.lock')]:
            p = patch.object(backup, name, value); p.start(); self.addCleanup(p.stop)
        self.request_id = '11111111-1111-4111-8111-111111111111'
        self.base, self.worker = MagicMock(), MagicMock()
        self.worker.config = {'remote_root': 'summa_onedrive:Summa backup/deploy'}
        self.path = backup.LOCAL / 'knjigovodstvoonline' / 'summa-knjigovodstvoonline-20261113T010000Z-12345678.tar.age'
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b'encrypted')
        self.meta = {'database': 'knjigovodstvoonline', 'filename': self.path.name, 'encrypted_bytes': 9, 'encrypted_sha256': 'hash'}
        self.worker.create.return_value = (self.path, self.meta)
        self.base.sha256.return_value = 'hash'
        self.worker.verify_remote.return_value = (9, 'hash')

    def record(self, **changes):
        return {'site': 'knjigovodstvoonline', 'requestId': self.request_id, 'database': 'knjigovodstvoonline',
                'local': 'verified', 'createdAt': backup.now(), 'cloud': 'queued', 'uploadedAt': None,
                'retained': True, 'metadata': self.meta, **changes}

    def test_prepare_only_selected_database_no_network_and_no_reuse(self):
        for site, database in backup.DATABASES.items():
            rid = str(__import__('uuid').uuid4())
            with patch.object(backup, 'backend', return_value=(self.base, self.worker)), patch.object(backup, 'verify_local') as verify, patch.object(backup, 'mysql_create', return_value=(self.path, self.meta)) as mysql:
                self.worker.create.reset_mock()
                status = backup.prepare(site, rid)
                if database is None:
                    verify.assert_not_called(); self.worker.create.assert_not_called()
                    self.assertEqual(status['local'], 'not_required')
                elif database in backup.MYSQL_ENV:
                    mysql.assert_called_once_with(self.base, self.worker, database)
                    self.worker.create.assert_not_called()
                else:
                    self.worker.create.assert_called_once_with(database)
                    verify.assert_called_once_with(self.base, self.path, self.meta)
                self.worker.rclone.assert_not_called()
                with self.assertRaises(RuntimeError): backup.prepare(site, rid)

    def test_failed_verification_never_publishes_success_or_queue(self):
        with patch.object(backup, 'backend', return_value=(self.base, self.worker)), patch.object(backup, 'verify_local', side_effect=RuntimeError('bad archive')):
            with self.assertRaises(RuntimeError): backup.prepare('knjigovodstvoonline', self.request_id)
        self.assertFalse((backup.ROOT / (self.request_id + '.json')).exists())

    def test_upload_failure_keeps_local_copy_and_retry_succeeds(self):
        record = self.record()
        self.worker.rclone.side_effect = RuntimeError('sensitive provider failure')
        backup.upload_one(record, self.base, self.worker)
        self.assertEqual(backup.status(record['site'], self.request_id)['cloud'], 'warning')
        self.assertTrue(self.path.exists())
        self.assertNotIn('sensitive', (backup.ROOT / (self.request_id + '.json')).read_text())
        self.worker.rclone.side_effect = None
        backup.upload_one(record, self.base, self.worker)
        self.assertEqual(record['cloud'], 'verified')
        self.assertIsNotNone(record['uploadedAt'])
        self.assertTrue(self.path.exists())

    def test_corrupt_local_or_remote_copy_never_becomes_verified(self):
        record = self.record()
        self.base.sha256.return_value = 'corrupt'
        backup.upload_one(record, self.base, self.worker)
        self.assertEqual(record['cloud'], 'warning'); self.worker.rclone.assert_not_called()
        self.base.sha256.return_value = 'hash'
        self.worker.verify_remote.return_value = (9, 'corrupt')
        backup.upload_one(record, self.base, self.worker)
        self.assertEqual(record['cloud'], 'warning'); self.assertTrue(self.path.exists())

    def test_queue_survives_restart_and_never_mutates_deploy_or_nightly_history(self):
        record = self.record(cloud='uploading')
        backup.save(record)
        with patch.object(backup, 'backend', return_value=(self.base, self.worker)):
            self.assertEqual(backup.upload(), 0)
        self.assertEqual(backup.status(record['site'], self.request_id)['cloud'], 'verified')
        self.assertEqual([p.name for p in backup.ROOT.glob('*.json')], [self.request_id + '.json'])

    def test_local_decryption_checks_contents_and_postgres_archive(self):
        metadata = {**self.meta, 'dump_bytes': 4, 'dump_sha256': 'hash'}
        def command(args, **kwargs):
            if args[0] == '/usr/bin/age':
                archive = Path(args[args.index('--output') + 1])
                with tarfile.open(archive, 'w') as tar:
                    member = tarfile.TarInfo('database.dump'); member.size = 4
                    tar.addfile(member, io.BytesIO(b'dump'))
        self.base.run.side_effect = command
        backup.verify_local(self.base, self.path, metadata)
        self.assertEqual(self.base.run.call_args.args[0][:2], ['/usr/bin/pg_restore', '--list'])
        self.base.sha256.side_effect = ['hash', 'corrupt']
        with self.assertRaises(RuntimeError): backup.verify_local(self.base, self.path, metadata)
        self.assertFalse(list(backup.LOCAL.glob('.work-*')))

    def test_mysql_nontransactional_tables_stop_before_dump_or_upload(self):
        self.base.run.return_value = b'MyISAM\n'
        with self.assertRaises(RuntimeError): backup.mysql_create(self.base, self.worker, 'rahmetli_me')
        self.assertEqual(self.base.run.call_count, 1)
        self.worker.rclone.assert_not_called()

    def test_scope_and_path_validation(self):
        for site, rid in [('other', self.request_id), ('knjigovodstvoonline', '../file')]:
            with self.assertRaises(ValueError): backup.prepare(site, rid)
        backup.save(self.record())
        with self.assertRaises(ValueError): backup.read('rahmetli', self.request_id)
        record = self.record(metadata={**self.meta, 'filename': '../database.dump'})
        self.base.backup_time.return_value = None
        with self.assertRaises(ValueError): backup.backup_path(record, self.base)
        self.assertNotIn('metadata', backup.status('knjigovodstvoonline', self.request_id))

    def test_retention_keeps_unsent_and_latest_verified_and_never_touches_nightly(self):
        old = self.record(cloud='verified', createdAt='2020-01-02T00:00:00+00:00')
        pending_path = self.path.with_name(self.path.name.replace('12345678', '22222222'))
        latest_path = self.path.with_name(self.path.name.replace('12345678', '33333333'))
        pending_path.write_bytes(b'encrypted'); latest_path.write_bytes(b'encrypted')
        pending = self.record(cloud='warning', createdAt='2020-01-01T00:00:00+00:00',
            requestId='22222222-2222-4222-8222-222222222222', metadata={**self.meta, 'filename': pending_path.name})
        latest = self.record(cloud='verified', createdAt=backup.now(),
            requestId='33333333-3333-4333-8333-333333333333', metadata={**self.meta, 'filename': latest_path.name})
        backup.prune([pending, old], self.base, self.worker)
        self.worker.rclone.assert_not_called(); self.assertTrue(self.path.exists())
        self.worker.rclone.side_effect = RuntimeError('cloud unavailable')
        backup.prune([pending, old, latest], self.base, self.worker)
        self.assertTrue(self.path.exists()); self.assertTrue(old['retained'])
        self.worker.rclone.reset_mock(); self.worker.rclone.side_effect = None
        backup.prune([pending, old, latest], self.base, self.worker)
        self.worker.rclone.assert_called_once_with('deletefile', 'summa_onedrive:Summa backup/deploy/knjigovodstvoonline/' + self.path.name)
        self.assertFalse(old['retained']); self.assertFalse(self.path.exists())
        self.assertTrue(pending['retained']); self.assertTrue(pending_path.exists())
        self.assertTrue(latest['retained']); self.assertTrue(latest_path.exists())

if __name__ == '__main__':
    unittest.main()
