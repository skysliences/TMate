import importlib.util
import io
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from deploy_common import read_env


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load('installer', 'install-teslamate.py')
reader = load('reader', 'create-readonly-role.py')


class DeploymentTests(unittest.TestCase):
    def config(self):
        config = read_env(installer.ROOT / 'deploy/teslamate/.env.example')
        config.update(ENCRYPTION_KEY='a' * 64, DATABASE_PASS='b' * 64, GRAFANA_ADMIN_PASSWORD='c' * 64)
        return config

    def test_templates_require_real_values(self):
        with self.assertRaises(ValueError):
            installer.validate(read_env(installer.ROOT / 'deploy/teslamate/.env.example'))
        installer.validate(self.config())

    def test_no_public_bind_or_shared_passwords_or_old_postgres(self):
        for change in [{'TM_BIND_ADDRESS': '0.0.0.0'}, {'TM_BIND_ADDRESS': '8.8.8.8'}, {'POSTGRES_VERSION': '17'}, {'TESLAMATE_VERSION': 'latest'}, {'DATABASE_PASS': 'a' * 64}, {'TESLAMATE_PORT': '3000'}, {'TESLAMATE_HOSTNAME': 'localhost;id'}]:
            with self.assertRaises(ValueError):
                installer.validate(dict(self.config(), **change))

    def test_no_env_execution_and_duplicate_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            marker = Path(directory) / 'must-not-exist'
            path.write_text(f"VALUE=$(touch {marker})\n", encoding='utf8')
            self.assertTrue(read_env(path)['VALUE'].startswith('$(touch '))
            self.assertFalse(marker.exists())
            path.write_text('VALUE=a\nVALUE=b\n', encoding='utf8')
            with self.assertRaises(ValueError):
                read_env(path)

    def invoke(self, guard='', check=False):
        calls = []
        config = self.config()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('\n'.join(f'{key}={value}' for key, value in config.items()) + '\n', encoding='utf8')
            path.chmod(0o600)

            def run(command, **kwargs):
                calls.append(command)
                self.assertEqual(kwargs['env']['DATABASE_PASS'], config['DATABASE_PASS'])
                self.assertNotIn(config['DATABASE_PASS'], ' '.join(command))
                output = ''
                if command[:4] == ['docker', 'ps', '-a', '--format'] and guard == 'image':
                    output = 'teslamate/teslamate:4.2.0'
                if command[:3] == ['docker', 'ps', '-aq'] and guard == 'container':
                    output = 'existing-id'
                if command[:4] == ['docker', 'volume', 'ls', '-q'] and guard == 'volume':
                    output = 'existing-data'
                if command[:3] == ['docker', 'network', 'ls'] and guard == 'network':
                    output = config['TESLAMATE_NETWORK']
                return types.SimpleNamespace(returncode=0, stdout=output)

            with patch('sys.argv', ['install', '--env', str(path)] + (['--check'] if check else [])), patch.object(installer.shutil, 'which', return_value='/test/docker'), patch.object(installer.subprocess, 'run', side_effect=run), patch.dict(os.environ, {'DATABASE_PASS': 'wrong-shell-value'}), redirect_stdout(io.StringIO()) as output:
                if guard:
                    with self.assertRaisesRegex(ValueError, '拒绝覆盖'):
                        installer.main()
                else:
                    installer.main()
                self.assertNotIn(config['ENCRYPTION_KEY'], output.getvalue())
        return calls

    def test_check_never_connects_docker(self):
        self.assertEqual(self.invoke(check=True), [])

    def test_existing_installations_never_mutated(self):
        for guard in ['image', 'container', 'volume', 'network']:
            calls = self.invoke(guard)
            self.assertFalse(any('pull' in cmd or 'up' in cmd or 'down' in cmd for cmd in calls))

    def test_fresh_install_scope_and_env_precedence(self):
        calls = self.invoke()
        self.assertTrue(any('pull' in cmd for cmd in calls))
        self.assertTrue(any('up' in cmd and '--wait' in cmd for cmd in calls))
        self.assertFalse(any('down' in cmd or 'rm' in cmd or 'prune' in cmd for cmd in calls))

    def test_reader_escaping_and_no_admin_role_reuse(self):
        password = "abc'\\;DROP ROLE other;--password"
        from urllib.parse import quote
        role, database, sql = reader.reader_sql({'DATABASE_URL': f'postgresql://tmate_reader:{quote(password, safe="")}@localhost/teslamate'})
        self.assertEqual(role, 'tmate_reader')
        self.assertEqual(database, 'teslamate')
        self.assertIn("abc''\\;DROP ROLE other;--password", sql)
        self.assertIn('SET LOCAL standard_conforming_strings = on', sql)
        for user in ['postgres', 'teslamate', 'reader;DROP']:
            with self.assertRaises(ValueError):
                reader.reader_sql({'DATABASE_URL': f'postgresql://{user}:long-enough-test-password@localhost/teslamate'})


if __name__ == '__main__':
    unittest.main()
