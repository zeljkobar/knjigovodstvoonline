"""Run the real shell flow with isolated fake external commands; never touches a DB."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class DeployScriptTests(unittest.TestCase):
    def execute(self, fail=''):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = (Path(__file__).resolve().parents[1] / 'deploy_knjigovodstvo.sh').read_text()
            # Only the production location is replaced in the test fixture.
            script = root / 'deploy.sh'
            script.write_text(source.replace('/var/www/knjigovodstvoonline', str(root)))
            stub = root / 'command'
            stub.write_text('#!' + sys.executable + '\n' + '''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
command = ' '.join([name, *args])
with open(os.environ['TEST_LOG'], 'a') as log:
    log.write(json.dumps({'command': command, 'bank': os.environ.get('BANK_AUTOMATION_ENABLED'), 'sep': os.environ.get('SEP_AUTOMATION_ENABLED')}) + '\\n')
if os.environ.get('TEST_FAIL') and command.startswith(os.environ['TEST_FAIL']): sys.exit(1)
if name == 'uname': print('Linux')
elif name == 'id': print('deploy')
elif name == 'git':
    if args == ['branch', '--show-current']: print('main')
    elif args[:2] == ['rev-parse', '--git-path']: print(str(pathlib.Path.cwd() / 'lock'))
    elif args[:1] == ['rev-parse']: print('a' * 40)
elif name == 'curl': print('HTTP/1.1 200 OK')
''')
            stub.chmod(0o755)
            for name in ['git', 'npm', 'npx', 'pm2', 'curl', 'sleep', 'flock', 'id', 'uname']:
                (root / name).symlink_to(stub)
            log = root / 'commands.jsonl'
            result = subprocess.run(['/bin/bash', str(script)], cwd=root, capture_output=True, text=True,
                                    env={**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'], 'TEST_LOG': str(log), 'TEST_FAIL': fail})
            return result, [json.loads(line) for line in log.read_text().splitlines()]

    def test_success_migrates_before_restart_and_disables_build_automation(self):
        result, rows = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = [row['command'] for row in rows]
        order = ['git pull --ff-only origin main', 'npm ci --include=dev', 'npx --no-install prisma migrate deploy',
                 'npx --no-install prisma generate', 'npm run build', 'pm2 restart knjigovodstvoonline --update-env']
        indices = [commands.index(command) for command in order]
        self.assertEqual(indices, sorted(indices))
        build = next(row for row in rows if row['command'] == 'npm run build')
        self.assertEqual((build['bank'], build['sep']), ('false', 'false'))
        self.assertIn('::SUMMA_DEPLOY_PHASE::done', result.stdout)

    def test_failed_pull_install_or_migration_never_restarts_app(self):
        for failure in ['git pull', 'npm ci', 'npx --no-install prisma migrate deploy', 'npm run build']:
            with self.subTest(failure=failure):
                result, rows = self.execute(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(row['command'].startswith('pm2 restart') for row in rows))
                self.assertNotIn('::SUMMA_DEPLOY_PHASE::done', result.stdout)
                if failure in ['git pull', 'npm ci']:
                    self.assertFalse(any('prisma migrate deploy' in row['command'] for row in rows))

    def test_failed_health_check_cannot_report_success(self):
        result, _ = self.execute('curl')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('::SUMMA_DEPLOY_PHASE::done', result.stdout)


if __name__ == '__main__':
    unittest.main()
