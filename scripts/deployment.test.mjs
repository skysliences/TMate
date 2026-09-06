import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { validateMobileConfig, renderNetworkSecurity } from './configure-mobile.mjs';
import { includeSource } from './package-source.mjs';
import { validateConfig } from '../server/config.mjs';
import { parseEnv } from 'node:util';

void test('configuration templates fail closed until users fill their own secrets', async () => {
  const template = parseEnv(await readFile('.env.example', 'utf8'));
  assert.throws(() => validateConfig(template), /API_KEY/);
  const valid = { ...template, API_KEY: 'a'.repeat(64), DATABASE_URL: `postgresql://tmate_reader:${'b'.repeat(64)}@database:5432/teslamate` };
  assert.equal(validateConfig(valid), true);
  const check = execFileSync(process.execPath, ['scripts/check-config.mjs', '--environment'], { env: { ...process.env, ...valid }, encoding: 'utf8' });
  assert.match(check, /配置检查通过/);
  assert.ok(!check.includes(valid.API_KEY) && !check.includes(valid.DATABASE_URL));
  assert.throws(() => validateConfig({ ...valid, AMAP_KEY: 'CHANGE_ME' }), /AMAP_KEY/);
  assert.throws(() => validateConfig({ ...valid, WEB_ORIGIN: 'https://example.com/' }), /WEB_ORIGIN/);
  assert.throws(() => validateConfig({ ...valid, ALLOWED_ORIGINS: '*' }), /ALLOWED_ORIGINS/);
  assert.throws(() => validateConfig({ ...valid, PORT: '65536' }), /PORT/);
  assert.throws(() => validateConfig({ ...valid, MQTT_URL: 'mqtt://user:password@broker' }), /MQTT_URL/);
});

void test('mobile defaults have no personal server, secrets or general cleartext allowance', async () => {
  const config = JSON.parse(await readFile('mobile.config.json', 'utf8'));
  validateMobileConfig(config);
  const secure = { defaultServerUrl: '', androidHttpOrigin: '' };
  assert.doesNotMatch(renderNetworkSecurity(secure), /cleartextTrafficPermitted="true"/);
  assert.throws(() => validateMobileConfig({ ...secure, API_KEY: 'a'.repeat(32) }), /密钥/);
  for (const value of ['http://example.com', 'http://0.0.0.0:8787', 'http://169.254.169.254', 'http://192.168.50.20:8787/path']) {
    assert.throws(() => validateMobileConfig({ ...secure, androidHttpOrigin: value }));
  }
  const lan = { defaultServerUrl: 'http://192.168.50.20:8787', androidHttpOrigin: 'http://192.168.50.20:8787' };
  assert.match(renderNetworkSecurity(lan), /includeSubdomains="false">192\.168\.50\.20/);
  assert.throws(() => validateMobileConfig({ ...secure, defaultServerUrl: 'https://user:secret@example.com' }));
});

void test('source allowlist excludes configs, certificates, caches, personal deployments and signing keys', () => {
  for (const path of ['.env', '.env.admin', '.openai/hosting.json', 'deploy/teslamate/.env', 'deploy/fnos-deployment.md', 'deploy/compose.fnos.https.yaml', 'deploy/nginx.https.conf', 'public/key.pem', 'server/token.key', 'android/local.properties', 'work/android-signing/signing.json', 'android/app/build/outputs/apk/app.apk', 'ios/App/App/public/index.html', 'android/app/src/main/assets/public/index.html', 'map-cache/addresses.json', 'outputs/old-source.zip']) assert.equal(includeSource(path), false, path);
  for (const path of ['.env.example', '.env.admin.example', 'deploy/teslamate/.env.example', 'README.md', 'docs/deployment.md', 'scripts/install-teslamate.py', 'server/config.mjs', 'public/icon.svg']) assert.equal(includeSource(path), true, path);
});

void test('read-only initializer grants only the nine tables and rejects an existing role', async () => {
  const db = new PGlite();
  const names = ['cars', 'drives', 'positions', 'charging_processes', 'charges', 'states', 'addresses', 'geofences', 'updates'];
  try {
    for (const name of [...names, 'tokens']) await db.exec(`CREATE TABLE ${name}(id int)`);
    const sql = execFileSync('python3', ['-c', "import sys;sys.path.insert(0,'scripts');from importlib.machinery import SourceFileLoader;m=SourceFileLoader('reader','scripts/create-readonly-role.py').load_module();print(m.reader_sql({'DATABASE_URL':'postgresql://tmate_reader:'+'a'*64+'@localhost/postgres'})[2])"], { encoding: 'utf8' }).replace(/^\\set .*\n/m, '');
    await db.exec(sql);
    for (const name of names) {
      const { rows: [row] } = await db.query(`SELECT has_table_privilege('tmate_reader',$1,'SELECT') AS can_read, has_table_privilege('tmate_reader',$1,'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write`, [name]);
      assert.equal(row.can_read, true);
      assert.equal(row.can_write, false);
    }
    assert.equal((await db.query("SELECT has_table_privilege('tmate_reader','tokens','SELECT') AS allowed")).rows[0].allowed, false);
    await assert.rejects(db.exec(sql));
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});

void test('read-only initializer rolls back when PUBLIC grants would expose Tesla tokens', async () => {
  const db = new PGlite();
  try {
    for (const name of ['cars', 'drives', 'positions', 'charging_processes', 'charges', 'states', 'addresses', 'geofences', 'updates', 'tokens']) await db.exec(`CREATE TABLE ${name}(id int)`);
    await db.exec('GRANT SELECT ON tokens TO PUBLIC');
    const sql = execFileSync('python3', ['-c', "import sys;sys.path.insert(0,'scripts');from importlib.machinery import SourceFileLoader;m=SourceFileLoader('reader','scripts/create-readonly-role.py').load_module();print(m.reader_sql({'DATABASE_URL':'postgresql://tmate_reader:'+'a'*64+'@localhost/postgres'})[2])"], { encoding: 'utf8' }).replace(/^\\set .*\n/m, '');
    await assert.rejects(db.exec(sql), /Unexpected inherited/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname='tmate_reader'")).rows[0].count, 0);
  } finally { await db.close(); }
});
