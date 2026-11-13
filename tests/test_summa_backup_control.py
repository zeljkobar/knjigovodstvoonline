import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, call
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('backup_control', Path(__file__).resolve().parents[1] / 'scripts/ops/summa-backup-control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        for name, value in [('ROOT', self.root), ('LOCK', self.root / 'lock')]:
            patcher = patch.object(control, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.request = {'requestId': '11111111-1111-4111-8111-111111111111', 'actorId': '22222222-2222-4222-8222-222222222222'}

    def write(self, name, data):
        (self.root / name).write_text(json.dumps(data))

    def properties(self, unit, fields):
        if unit.endswith('.timer'):
            return {'LoadState': 'loaded', 'ActiveState': 'active', 'UnitFileState': 'enabled', 'NextElapseUSecRealtime': 'Sat 2026-11-14 02:00:00 UTC'}
        return {'LoadState': 'loaded', 'ActiveState': 'inactive', 'Result': 'success', 'ExecMainStartTimestamp': 'Fri 2026-11-13 02:00:00 UTC'}

    def test_status_projects_only_safe_fields_and_ignores_stale_running_file(self):
        self.write('spedicija.json', {'verified_utc': '2026-11-13T02:01:00Z', 'encrypted_bytes': 42,
                   'filename': 'summa-spedicija-20261113T020000Z-deadbeef.tar.age', 'private_key': 'SECRET'})
        self.write('current-run.json', {'started_utc': '2026-11-13T02:00:00Z', 'databases': {'spedicija': {'phase': 'uploading'}}})
        self.write('last-run.json', {'finished_utc': '2026-11-13T02:01:00Z', 'databases': {'spedicija': {'ok': False, 'error': 'SECRET'}}})
        with patch.object(control, 'properties', side_effect=self.properties):
            status = control.public_status()
        self.assertFalse(status['running'])
        self.assertEqual(len(status['databases']), 4)
        self.assertNotIn('SECRET', json.dumps(status))
        self.assertTrue(all(row['phase'] is None for row in status['databases']))
        self.assertEqual(status['scheduler']['nextRunAt'], '2026-11-14T02:00:00+00:00')
        self.assertFalse(status['databases'][2]['lastAttempt']['ok'])

    def test_start_is_fixed_scope_audited_and_idempotent(self):
        with patch.object(control, 'public_status', return_value={'running': False}), patch.object(control, 'command') as command:
            self.assertEqual(control.start(self.request)['status'], 'accepted')
            self.assertEqual(control.start(self.request)['status'], 'already_requested')
            self.assertEqual(control.start({**self.request, 'requestId': '33333333-3333-4333-8333-333333333333'})['status'], 'cooldown')
            self.assertEqual(command.call_args_list, [call('reset-failed', 'summa-backup.service'), call('start', '--no-block', 'summa-backup.service')])
        self.assertEqual(json.loads((self.root / 'manual-requests.jsonl').read_text())['actorId'], self.request['actorId'])

    def test_running_job_cannot_start_again(self):
        with patch.object(control, 'public_status', return_value={'running': True}), patch.object(control, 'command') as command:
            self.assertEqual(control.start(self.request)['status'], 'already_running')
            command.assert_not_called()

    def test_manual_start_replaces_pending_retry_without_waiting_fifteen_minutes(self):
        with patch.object(control, 'public_status', return_value={'running': False, 'retryPending': True}), patch.object(control, 'command') as command:
            self.assertEqual(control.start(self.request)['status'], 'accepted')
            self.assertEqual(command.call_args_list, [call('reset-failed', 'summa-backup.service'), call('restart', '--no-block', 'summa-backup.service')])

    def test_unapproved_arguments_and_failed_audit_cannot_start(self):
        with patch.object(control, 'public_status', return_value={'running': False}), patch.object(control, 'command') as command:
            for invalid in [{}, {**self.request, 'database': 'postgres'}, {**self.request, 'actorId': ';whoami'}]:
                with self.assertRaises(ValueError):
                    control.start(invalid)
            with patch.object(control, 'write_request', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    control.start(self.request)
            command.assert_not_called()

    def test_failed_start_can_be_retried_after_cooldown(self):
        with patch.object(control, 'public_status', return_value={'running': False}), patch.object(control, 'command', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                control.start(self.request)
        prior = control.read('manual-request.json')
        self.assertEqual(prior['status'], 'failed')
        prior['createdAt'] = '2026-01-01T00:00:00Z'
        self.write('manual-request.json', prior)
        with patch.object(control, 'public_status', return_value={'running': False}), patch.object(control, 'command'), patch.object(control, 'now', return_value=datetime(2026, 11, 13, tzinfo=timezone.utc)):
            self.assertEqual(control.start(self.request)['status'], 'accepted')


if __name__ == '__main__':
    unittest.main()
