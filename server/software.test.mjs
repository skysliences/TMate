import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { readSoftware } from './software.mjs';
import { createStatusCache, CACHE_TTL } from './mqtt-cache.mjs';
import { mergeStatus } from './domain.mjs';
void test('software fallback selects only latest completed upgrade for the requested car', async () => {
  const db = new PGlite();
  try {
    assert.equal((await readSoftware(db, 1)).unavailable, 'no-table');
    await db.exec(`CREATE TABLE updates(id int,car_id int,version text,end_date timestamp);
      INSERT INTO updates VALUES (1,1,'2026.8.3.6','2026-09-01'),(2,1,'2026.10',NULL),(3,2,'2026.12','2026-09-03'),(4,1,'','2026-09-02');`);
    const software = await readSoftware(db, 1);
    assert.equal(software.version, '2026.8.3.6');
    assert.equal(mergeStatus({}, {}, {}, null, {}, software).versionSource, 'database');
    assert.equal((await readSoftware(db, 99)).unavailable, 'no-record');
    assert.equal((await readSoftware({ query: () => { throw Object.assign(new Error(), { code: '42501' }); } }, 1)).unavailable, 'permission');
    await assert.rejects(readSoftware({ query: () => { throw new Error('disconnected'); } }, 1));
  } finally { await db.close(); }
});
void test('MQTT status cache survives restart, preserves false, limits lifetime and excludes other telemetry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tmate-status-test-'));
  let now = 1788500000000;
  try {
    const cache = await createStatusCache(directory, () => now);
    cache.set(1, 'sentry_mode', false);
    cache.set(1, 'version', '2026.8.3.6');
    cache.set(1, 'latitude', 30);
    cache.set(1, 'sentry_mode', null);
    await cache.flush();
    assert.equal((await stat(join(directory, 'vehicle-status.json'))).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(join(directory, 'vehicle-status.json'), 'utf8'), /latitude/);
    const restored = await createStatusCache(directory, () => now);
    assert.equal(restored.get(1).sentry_mode.value, false);
    assert.deepEqual(restored.get(2), {});
    const status = mergeStatus({}, {}, {}, { connected: false, status: restored.get(1) });
    assert.equal(status.sentry, false);
    assert.equal(status.sentrySource, 'cache');
    assert.equal(status.sentryReceivedAt, new Date(now).toISOString());
    assert.equal(status.versionSource, 'cache');
    assert.equal(status.live, false);
    const database = mergeStatus({}, {}, {}, { connected: false, status: restored.get(1) }, {}, { version: '2026.9', recordedAt: '2026-09-02T00:00:00Z' });
    assert.equal(database.version, '2026.9');
    now += CACHE_TTL;
    assert.deepEqual(restored.get(1), {});
    assert.deepEqual((await createStatusCache(directory, () => now)).get(1), {});
  } finally { await rm(directory, { recursive: true }); }
});
void test('no sentry observation remains unknown; live false and upgrade sources remain distinct', () => {
  assert.equal(mergeStatus().sentry, null);
  const status = mergeStatus({}, {}, {}, { connected: true, values: { version: '2026.10', sentry_mode: false } }, {}, { version: '2026.9' });
  assert.equal(status.sentry, false);
  assert.equal(status.sentrySource, 'mqtt');
  assert.equal(status.sentryReceivedAt, null);
  assert.equal(status.version, '2026.10');
  assert.equal(status.versionSource, 'mqtt');
});
