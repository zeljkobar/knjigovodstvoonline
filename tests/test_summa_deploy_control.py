import importlib.util
import json
import io
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, call, MagicMock

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
        p = patch.object(control, 'properties', return_value={'LoadState': 'loaded', 'ActiveState': 'inactive', 'Result': 'success'})
        p.start()
        self.addCleanup(p.stop)
        self.request = {'site': control.SITE, 'requestId': '11111111-1111-4111-8111-111111111111', 'actorId': '22222222-2222-4222-8222-222222222222'}

    def queue(self):
        control.write_state({**self.request, 'outcome': 'running', 'phase': 'queued'})

    def test_start_is_audited_fixed_scope_and_idempotent(self):
        with patch.object(control, 'public_status', return_value={'running': False, 'ready': True}), patch.object(control, 'systemctl') as command:
            self.assertEqual(control.start(self.request)['status'], 'accepted')
            self.assertEqual(control.start(self.request)['status'], 'already_requested')
            self.assertEqual(control.start({**self.request, 'requestId': '33333333-3333-4333-8333-333333333333'})['status'], 'cooldown')
            self.assertEqual(command.call_args_list, [call('start', '--no-block', control.UNIT)])
        self.assertEqual(json.loads((self.root / 'requests.jsonl').read_text())['actorId'], self.request['actorId'])

    def test_running_or_unprepared_service_cannot_start(self):
        with patch.object(control, 'systemctl') as command:
            for status, result in [({'running': True}, 'already_running'), ({'running': False, 'ready': False}, 'setup_required')]:
                with patch.object(control, 'public_status', return_value=status), patch.object(control, 'properties', return_value={'ActiveState': 'active' if status['running'] else 'inactive'}):
                    self.assertEqual(control.start(self.request)['status'], result)
            command.assert_not_called()

    def test_only_failed_service_is_reset_before_start(self):
        with patch.object(control, 'properties', return_value={'ActiveState': 'failed'}), patch.object(control, 'public_status', return_value={'ready': True}), patch.object(control, 'systemctl') as command:
            self.assertEqual(control.start(self.request)['status'], 'accepted')
            self.assertEqual(command.call_args_list, [call('reset-failed', control.UNIT), call('start', '--no-block', control.UNIT)])

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
        with patch.object(control, 'properties', return_value={'LoadState': 'loaded', 'ActiveState': 'failed', 'Result': 'exit-code'}), patch.object(control, 'readiness', return_value=None), patch.object(control, 'revision', return_value='a'*40):
            control.write_state({**self.request, 'outcome': 'failed', 'error': 'backup_failed', 'phase': 'backup', 'secret': 'SECRET'})
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
        with patch.object(control, 'readiness', return_value=None), patch.object(control, 'verified_backup', side_effect=RuntimeError('SECRET')), patch.object(control, 'run_script') as script:
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
        with patch.object(control, 'readiness', return_value=None), patch.object(control, 'verified_backup'), patch.object(control, 'run_script', side_effect=script):
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
            with patch.object(control, 'readiness', return_value=None), patch.object(control, 'verified_backup'), patch.object(control, 'run_script', side_effect=script), patch.object(control, 'revision', return_value=revision), patch.object(control, 'verify_site'):
                self.assertEqual(control.run(), 0 if revision else 1)
            self.assertEqual(control.read_state()['outcome'], 'succeeded' if revision else 'failed')

    def test_old_or_failed_backup_cannot_authorize_migrations(self):
        with patch.object(control, 'properties', return_value={}), patch.object(control, 'systemctl'):
            for state in [{'ok': True, 'finished_utc': '2020-01-01T00:00:00Z', 'databases': {control.SITE: {'ok': True}}},
                          {'ok': False, 'finished_utc': '2099-01-01T00:00:00Z', 'databases': {control.SITE: {'ok': False}}}]:
                control.BACKUP_STATE.write_text(json.dumps(state))
                with self.assertRaises(RuntimeError):
                    control.verified_backup()

    def test_separate_site_history_and_global_busy_guard(self):
        control.write_state({**self.request, 'outcome': 'succeeded', 'phase': 'done', 'lastSuccess': {'at': control.now(), 'commit': 'a'*40}})
        control.write_state({**self.request, 'site': 'rahmetli', 'outcome': 'running', 'phase': 'script'})
        with patch.object(control, 'properties', return_value={'LoadState': 'loaded', 'ActiveState': 'active'}), patch.object(control, 'readiness', return_value=None), patch.object(control, 'revision', return_value='b'*40), patch.object(control, 'systemctl') as command:
            catalog = control.public_catalog()
            self.assertEqual(catalog['activeSite'], 'rahmetli')
            self.assertEqual(len(catalog['sites']), 7)
            accounting = next(row for row in catalog['sites'] if row['site'] == control.SITE)
            rahmetli = next(row for row in catalog['sites'] if row['site'] == 'rahmetli')
            self.assertFalse(accounting['running'])
            self.assertEqual(accounting['lastSuccess']['commit'], 'a'*40)
            self.assertTrue(rahmetli['running'])
            self.assertIsNone(rahmetli['lastSuccess'])
            self.assertEqual(control.start({**self.request, 'site': 'turizam'})['status'], 'already_running')
            command.assert_not_called()

    def test_every_target_executes_as_deploy_with_exact_script_cwd_and_arguments(self):
        for site, target in control.TARGETS.items():
            with self.subTest(site=site):
                state = {**self.request, 'site': site, 'phase': 'script'}
                process = MagicMock()
                process.stdout = io.BufferedReader(io.BytesIO(b'ordinary log\n'))
                process.wait.return_value = 0
                with patch.object(control, 'prepare_script', return_value='echo TEST'), patch.object(control.subprocess, 'Popen', return_value=process) as popen:
                    self.assertEqual(control.run_script(state), 0)
                    args, kwargs = popen.call_args
                    self.assertEqual(args[0], ['/usr/sbin/runuser', '-u', 'deploy', '--', '/bin/bash', '-c', 'echo TEST', str(target['script']), *target.get('args', [])])
                    self.assertEqual(kwargs['cwd'], target['app'])
                process.stdout.close()

    def test_adapter_never_grants_project_root_and_refuses_unreviewed_changes(self):
        script = self.root / 'adapter.sh'
        body = 'sudo git pull origin "$BRANCH"\nsudo chown -R deploy:deploy "$APP_DIR"\nsudo chmod -R 755 "$APP_DIR"\n'
        script.write_text(body)
        target = {**control.TARGETS['royalservices'], 'script': script, 'sha256': hashlib.sha256(script.read_bytes()).hexdigest()}
        with patch.dict(control.TARGETS, {'royalservices': target}):
            adapted = control.prepare_script('royalservices')
            self.assertNotIn('sudo ', adapted)
            self.assertIn('git pull --ff-only', adapted)
            self.assertEqual(script.read_text(), body)
            script.write_text(body + 'unreviewed command\n')
            with self.assertRaises(ValueError):
                control.prepare_script('royalservices')

    def test_dirty_site_blocks_start_without_mutations(self):
        with patch.object(control, 'prepare_script'), patch.object(control, 'git', side_effect=[MagicMock(returncode=0, stdout='main\n'), MagicMock(returncode=0, stdout=' M package-lock.json\n')]):
            self.assertEqual(control.readiness('spedicija'), 'uncommitted_changes')
        with patch.object(control, 'public_status', return_value={'ready': False}), patch.object(control, 'systemctl') as command:
            self.assertEqual(control.start({**self.request, 'site': 'spedicija'})['status'], 'setup_required')
            command.assert_not_called()

    def test_nginx_privilege_is_only_for_spedicija_and_fixed_commands(self):
        with patch.object(control.subprocess, 'run', return_value=MagicMock(returncode=0)) as run, patch.object(control, 'systemctl') as systemctl:
            control.verify_site('rahmetli')
            systemctl.assert_not_called()
            self.assertTrue(all(call.args[0][0] == '/usr/sbin/runuser' for call in run.call_args_list))
            run.reset_mock()
            control.verify_site('spedicija')
            self.assertEqual(run.call_args_list[0].args[0], ['/usr/sbin/nginx', '-t'])
            systemctl.assert_called_once_with('reload', 'nginx')


if __name__ == '__main__':
    unittest.main()
