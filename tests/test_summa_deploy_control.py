import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, call

spec = importlib.util.spec_from_file_location('deploy_control', Path(__file__).resolve().parents[1] / 'scripts/ops/summa-deploy-control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class DeployControlTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name)
        for name, value in [('ROOT', self.root), ('LOCK', self.root / 'lock'), ('RUN_LOCK', self.root / 'run-lock'),
                            ('NODE_BIN', self.root), ('BACKUP_STATE', self.root / 'backup.json')]:
            p = patch.object(control, name, value)
            p.start()
            self.addCleanup(p.stop)
        (self.root / 'node').touch()
        self.request = {'site': control.SITE, 'requestId': '11111111-1111-4111-8111-111111111111', 'actorId': '22222222-2222-4222-8222-222222222222'}

    def queue(self):
        control.write_state({**self.request, 'outcome': 'running', 'phase': 'queued'})

    def test_start_is_audited_fixed_scope_and_idempotent(self):
        with patch.object(control, 'public_status', return_value={'running': False, 'ready': True}), patch.object(control, 'systemctl') as command:
            self.assertEqual(control.start(self.request)['status'], 'accepted')
            self.assertEqual(control.start(self.request)['status'], 'already_requested')
            self.assertEqual(control.start({**self.request, 'requestId': '33333333-3333-4333-8333-333333333333'})['status'], 'cooldown')
            self.assertEqual(command.call_args_list, [call('reset-failed', control.UNIT), call('start', '--no-block', control.UNIT)])
        self.assertEqual(json.loads((self.root / 'requests.jsonl').read_text())['actorId'], self.request['actorId'])

    def test_running_or_unprepared_service_cannot_start(self):
        with patch.object(control, 'systemctl') as command:
            for status, result in [({'running': True}, 'already_running'), ({'running': False, 'ready': False}, 'setup_required')]:
                with patch.object(control, 'public_status', return_value=status):
                    self.assertEqual(control.start(self.request)['status'], result)
            command.assert_not_called()

    def test_forged_scope_and_failed_durable_audit_cannot_launch(self):
        with patch.object(control, 'public_status', return_value={'running': False, 'ready': True}), patch.object(control, 'systemctl') as command:
            for invalid in [{}, {**self.request, 'site': 'other'}, {**self.request, 'actorId': ';id'}, {**self.request, 'command': '/bin/sh'}]:
                with self.assertRaises(ValueError):
                    control.start(invalid)
            # A directory in place of the audit file simulates a write failure.
            (self.root / 'requests.jsonl').mkdir()
            with self.assertRaises(OSError):
                control.start(self.request)
            command.assert_not_called()

    def test_failure_status_preserves_cause_and_detects_interruption(self):
        with patch.object(control, 'properties', return_value={'LoadState': 'loaded', 'ActiveState': 'failed', 'Result': 'exit-code'}), patch.object(control, 'script_ready', return_value=True), patch.object(control, 'revision', return_value='a'*40):
            control.write_state({'outcome': 'failed', 'error': 'backup_failed', 'phase': 'backup', 'secret': 'SECRET'})
            status = control.public_status()
            self.assertEqual(status['error'], 'backup_failed')
            self.assertNotIn('SECRET', json.dumps(status))
            self.queue()
            status = control.public_status()
            self.assertFalse(status['running'])
            self.assertEqual(status['outcome'], 'failed')
            self.assertEqual(status['error'], 'interrupted')

    def test_backup_failure_prevents_all_project_commands(self):
        self.queue()
        with patch.object(control, 'script_ready', return_value=True), patch.object(control, 'verified_backup', side_effect=RuntimeError('SECRET')), patch.object(control, 'run_script') as script:
            self.assertEqual(control.run(), 1)
            script.assert_not_called()
        self.assertEqual(control.read_state()['error'], 'backup_failed')

    def test_script_failure_keeps_phase_and_previous_success(self):
        self.queue()
        prior = {'at': '2026-11-13T01:00:00+00:00', 'commit': 'a'*40}
        state = control.read_state()
        state['lastSuccess'] = prior
        control.write_state(state)
        def script(state):
            state['phase'] = 'migrations'
            return 1
        with patch.object(control, 'script_ready', return_value=True), patch.object(control, 'verified_backup'), patch.object(control, 'run_script', side_effect=script):
            self.assertEqual(control.run(), 1)
        state = control.read_state()
        self.assertEqual((state['outcome'], state['phase'], state['error']), ('failed', 'migrations', 'script_failed'))
        self.assertEqual(state['lastSuccess'], prior)

    def test_success_requires_completion_and_revision(self):
        def script(state):
            state['phase'] = 'done'
            return 0
        for revision in [None, 'a'*40]:
            self.queue()
            with patch.object(control, 'script_ready', return_value=True), patch.object(control, 'verified_backup'), patch.object(control, 'run_script', side_effect=script), patch.object(control, 'revision', return_value=revision):
                self.assertEqual(control.run(), 0 if revision else 1)
            self.assertEqual(control.read_state()['outcome'], 'succeeded' if revision else 'failed')

    def test_old_or_failed_backup_cannot_authorize_migrations(self):
        with patch.object(control, 'properties', return_value={}), patch.object(control, 'systemctl'):
            for state in [{'ok': True, 'finished_utc': '2020-01-01T00:00:00Z', 'databases': {control.SITE: {'ok': True}}},
                          {'ok': False, 'finished_utc': '2099-01-01T00:00:00Z', 'databases': {control.SITE: {'ok': False}}}]:
                control.BACKUP_STATE.write_text(json.dumps(state))
                with self.assertRaises(RuntimeError):
                    control.verified_backup()


if __name__ == '__main__':
    unittest.main()
