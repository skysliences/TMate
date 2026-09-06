import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { coordinatesOrNull, pressureOrNull, mergeStatus } from './domain.mjs';
import { decodeMqttValue } from './mqtt.mjs';
import { telemetrySql } from './queries.mjs';

const db = new PGlite();
const sampleTime = '2026-09-01T00:00:00.000Z';
const sample = {
  latitude: '31.2',
  longitude: '121.4',
  locationDate: sampleTime,
  ...Object.fromEntries(
    ['fl', 'fr', 'rl', 'rr'].flatMap((wheel, i) => [
      [`tpms_pressure_${wheel}`, `${2 + i / 10}`],
      [`tpms_pressure_${wheel}_date`, sampleTime],
    ]),
  ),
};
before(async () => {
  await db.exec(`
    CREATE TABLE positions(id int primary key, car_id int, date timestamp,
      latitude numeric, longitude numeric,
      tpms_pressure_fl numeric, tpms_pressure_fr numeric,
      tpms_pressure_rl numeric, tpms_pressure_rr numeric);
    INSERT INTO positions VALUES
      (1,1,'2026-09-01 00:00:00',31.2,121.4,2.1,2.2,2.3,2.4),
      (2,1,'2026-09-02 00:00:00',91,121.5,NULL,0,-1,11),
      (3,1,'2026-09-03 00:00:00',NULL,121.6,NULL,NULL,2.5,NULL),
      (4,1,'2026-09-03 00:00:00',NULL,NULL,NULL,NULL,2.6,NULL),
      (5,1,'2026-09-04 00:00:00',NULL,NULL,NULL,NULL,NULL,NULL),
      (6,2,'2026-09-05 00:00:00',40,100,3,3,3,3);
  `);
});
after(async () => {
  await db.close();
});

void test('database finds each last valid value independently, preserving zero, dates and car isolation', async () => {
  const {
    rows: [row],
  } = await db.query(telemetrySql, [1]);
  const status = mergeStatus({}, {}, {}, null, row);
  assert.deepEqual(status.coordinates, { latitude: 31.2, longitude: 121.4 });
  assert.equal(status.locationRecordedAt, sampleTime);
  assert.equal(status.locationSource, 'database');
  assert.deepEqual(status.tires, [2.1, 0, 2.6, 2.4]);
  assert.deepEqual(status.tireSources, Array(4).fill('database'));
  assert.deepEqual(status.tiresRecordedAt, [
    sampleTime,
    '2026-09-02T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
    sampleTime,
  ]);
  const {
    rows: [other],
  } = await db.query(telemetrySql, [2]);
  assert.deepEqual(mergeStatus({}, {}, {}, null, other).tires, [3, 3, 3, 3]);
  const {
    rows: [empty],
  } = await db.query(telemetrySql, [999]);
  assert.equal(mergeStatus({}, {}, {}, null, empty).coordinates, null);
  assert.deepEqual(
    mergeStatus({}, {}, {}, null, empty).tires,
    Array(4).fill(null),
  );
});

void test('database telemetry dates stay separate from newer battery and charging samples', () => {
  const status = mergeStatus(
    { date: '2026-09-03T00:00:00Z', battery: 40 },
    { date: '2026-09-04T00:00:00Z', battery: 80 },
    {},
    null,
    sample,
  );
  assert.equal(status.battery, 80);
  assert.equal(status.updatedAt, '2026-09-04T00:00:00Z');
  assert.equal(status.locationRecordedAt, sampleTime);
  assert.deepEqual(status.tiresRecordedAt, Array(4).fill(sampleTime));
});

void test('MQTT overrides only valid fields and never assigns receipt time as measurement time', () => {
  const status = mergeStatus(
    {},
    {},
    {},
    {
      connected: true,
      values: {
        location: { latitude: 0, longitude: 0 },
        geofence: ' 家 ',
        tpms_pressure_fl: '0',
        tpms_pressure_fr: 'nil',
        tpms_pressure_rl: null,
        tpms_pressure_rr: false,
        since: '2026-09-05T00:00:00Z',
      },
    },
    sample,
  );
  assert.deepEqual(status.coordinates, { latitude: 0, longitude: 0 });
  assert.equal(status.location, '家');
  assert.equal(status.locationSource, 'mqtt');
  assert.equal(status.locationRecordedAt, null);
  assert.deepEqual(status.tires, [0, 2.1, 2.2, 2.3]);
  assert.deepEqual(status.tireSources, [
    'mqtt',
    'database',
    'database',
    'database',
  ]);
  assert.deepEqual(status.tiresRecordedAt, [
    null,
    sampleTime,
    sampleTime,
    sampleTime,
  ]);
});

void test('missing or malformed MQTT values preserve database fallback, including during disconnect', () => {
  for (const live of [
    null,
    { connected: true, values: {} },
    {
      connected: true,
      values: {
        location: { latitude: 91, longitude: 120 },
        latitude: 30,
        geofence: 'nil',
        tpms_pressure_fl: 'bad',
        tpms_pressure_fr: -1,
      },
    },
    {
      connected: false,
      values: {
        location: { latitude: 40, longitude: 100 },
        tpms_pressure_fl: 3,
      },
    },
  ]) {
    const status = mergeStatus({}, {}, {}, live, sample);
    assert.deepEqual(status.coordinates, { latitude: 31.2, longitude: 121.4 });
    assert.deepEqual(status.tires, [2, 2.1, 2.2, 2.3]);
    assert.equal(status.locationSource, 'database');
    assert.equal(status.locationRecordedAt, sampleTime);
  }
});

void test('legacy MQTT coordinates need both values, and geofence does not borrow old coordinates', () => {
  const legacy = mergeStatus(
    {},
    {},
    {},
    { connected: true, values: { latitude: '30', longitude: '120' } },
    sample,
  );
  assert.deepEqual(legacy.coordinates, { latitude: 30, longitude: 120 });
  assert.equal(legacy.locationSource, 'mqtt');
  const fence = mergeStatus(
    {},
    {},
    {},
    { connected: true, values: { geofence: '公司' } },
    sample,
  );
  assert.equal(fence.location, '公司');
  assert.equal(fence.coordinates, null);
  assert.equal(fence.locationSource, 'mqtt');
  assert.equal(fence.locationRecordedAt, null);
});

void test('unknown telemetry stays null and invalid dates are never fabricated', () => {
  const empty = mergeStatus();
  assert.equal(empty.locationSource, null);
  assert.equal(empty.locationRecordedAt, null);
  assert.deepEqual(empty.tires, Array(4).fill(null));
  assert.deepEqual(empty.tireSources, Array(4).fill(null));
  assert.deepEqual(empty.tiresRecordedAt, Array(4).fill(null));
  const invalid = mergeStatus({}, {}, {}, null, {
    ...sample,
    locationDate: 'bad',
    tpms_pressure_fl_date: null,
  });
  assert.equal(invalid.locationRecordedAt, null);
  assert.equal(invalid.tiresRecordedAt[0], null);
});

void test('telemetry validators reject malformed coordinates/pressures, without losing valid zeros', () => {
  for (const value of [
    null,
    undefined,
    '',
    ' ',
    false,
    true,
    [],
    {},
    'NaN',
    Infinity,
    -1,
    11,
  ])
    assert.equal(pressureOrNull(value), null);
  assert.equal(pressureOrNull('0'), 0);
  assert.equal(pressureOrNull('2.5'), 2.5);
  for (const value of [
    null,
    [],
    {},
    { latitude: true, longitude: 100 },
    { latitude: 0, longitude: '' },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
  ])
    assert.equal(coordinatesOrNull(value), null);
  assert.deepEqual(coordinatesOrNull({ latitude: '-90', longitude: '180' }), {
    latitude: -90,
    longitude: 180,
  });
});

void test('MQTT location JSON is decoded safely alongside legacy scalar topics', () => {
  const decode = (key, value) => decodeMqttValue(key, Buffer.from(value));
  assert.deepEqual(decode('location', '{"latitude":31.2,"longitude":121.4}'), {
    latitude: 31.2,
    longitude: 121.4,
  });
  for (const text of [
    'broken',
    '[]',
    '{"latitude":91,"longitude":120}',
    '{"latitude":30}',
  ])
    assert.equal(decode('location', text), undefined);
  for (const text of ['nil', 'null', ''])
    assert.equal(decode('location', text), null);
  assert.equal(decode('tpms_pressure_fl', '2.5'), '2.5');
  assert.equal(decode('latitude', '30'), '30');
  assert.equal(decode('locked', 'false'), false);
});
