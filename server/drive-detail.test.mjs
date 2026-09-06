import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readDriveDetail } from './drive-detail.mjs';

const db = new PGlite();
before(async () => {
  await db.exec(`
    CREATE TABLE cars(id int PRIMARY KEY, efficiency numeric);
    CREATE TABLE drives(id int PRIMARY KEY,car_id int,start_date timestamp,end_date timestamp,distance numeric,start_rated_range_km numeric,end_rated_range_km numeric);
    CREATE TABLE positions(id int PRIMARY KEY,car_id int,drive_id int,date timestamp,battery_level int,rated_battery_range_km numeric);
    INSERT INTO cars VALUES (1,0.15),(2,NULL);
    INSERT INTO drives VALUES (1,1,'2026-01-01','2026-01-01 00:00:10',10,200,190),(2,1,'2026-01-01',NULL,10,200,190);
    INSERT INTO positions VALUES (1,1,1,'2026-01-01',0,0),(2,1,1,'2026-01-01 00:00:10',10,40);
  `);
});
after(() => db.close());

void test('legacy schemas, absent GPS, valid zeroes and UTC timestamps are supported', async () => {
  const data = await readDriveDetail(db, 1, 1);
  assert.equal(data.energy.netKwh, 1.5);
  assert.equal(data.energy.consumptionKwh100Km, 15);
  assert.equal(data.energy.recoveredKwh, null);
  assert.equal(data.energy.recoveryUnavailable, 'no-power');
  assert.deepEqual(data.battery.series.battery[0], {
    date: '2026-01-01T00:00:00.000Z',
    value: 0,
  });
  assert.equal(data.battery.series.ratedRange[0].value, 0);
  assert.deepEqual(data.battery.series.heater, []);
  assert.deepEqual(data.battery.series.usableBattery, []);
  assert.equal(await readDriveDetail(db, 2, 1), null);
  assert.equal(await readDriveDetail(db, 1, 2), null);
  assert.equal(await readDriveDetail(db, 1, 999), null);
});

void test('recovery integrates raw adjacent power samples, including zero crossings, but never null gaps', async () => {
  await db.exec(`
    ALTER TABLE positions ADD COLUMN power numeric;
    ALTER TABLE positions ADD COLUMN usable_battery_level int;
    ALTER TABLE positions ADD COLUMN est_battery_range_km numeric;
    ALTER TABLE positions ADD COLUMN battery_heater boolean;
    INSERT INTO drives VALUES (3,1,'2026-01-02','2026-01-02 00:00:10',20,190,200);
    INSERT INTO positions(id,car_id,drive_id,date,power,battery_level,usable_battery_level,est_battery_range_km,battery_heater)
    SELECT 10+i,1,3,'2026-01-02'::timestamp + i * interval '1 second',
      (ARRAY[-36,-36,36,36,-36,NULL,-36,-36])[i+1],80,79,350,false FROM generate_series(0,7) i;
    INSERT INTO positions(id,car_id,drive_id,date,power,battery_level) VALUES
      (99,2,3,'2026-01-02 00:00:08',-999,1),
      (98,1,3,'2026-01-02 00:00:11',-999,1);
  `);
  const data = await readDriveDetail(db, 1, 3);
  assert.ok(Math.abs(data.energy.recoveredKwh - 0.025) < 1e-10);
  assert.equal(data.energy.recoveryCoverage, 0.5);
  assert.equal(data.energy.recoveryUnavailable, null);
  assert.equal(data.energy.netKwh, -1.5);
  assert.equal(data.energy.consumptionKwh100Km, -7.5);
  assert.equal(data.battery.series.battery.length, 8);
  assert.equal(data.battery.series.heater[0].value, 0);
  assert.equal(data.battery.series.usableBattery[0].value, 79);
});

void test('sparse power is unknown, not zero; a fully observed positive-power interval can be zero', async () => {
  await db.exec(`
    INSERT INTO drives VALUES
      (4,2,'2026-01-03','2026-01-03 00:02:00',0,200,190),
      (5,1,'2026-01-03','2026-01-03 00:00:01',10,200,190);
    INSERT INTO positions(id,car_id,drive_id,date,power) VALUES
      (100,2,4,'2026-01-03',-36),(101,2,4,'2026-01-03 00:01:01',-36),
      (102,1,5,'2026-01-03',10),(103,1,5,'2026-01-03 00:00:01',10);
  `);
  const sparse = await readDriveDetail(db, 2, 4);
  assert.equal(sparse.energy.netKwh, null);
  assert.equal(sparse.energy.netUnavailable, 'no-efficiency');
  assert.equal(sparse.energy.consumptionKwh100Km, null);
  assert.equal(sparse.energy.recoveredKwh, null);
  assert.equal(sparse.energy.recoveryUnavailable, 'sparse-power');
  const observed = await readDriveDetail(db, 1, 5);
  assert.equal(observed.energy.recoveredKwh, 0);
  assert.equal(observed.energy.recoveryCoverage, 1);
});

void test('sensor-specific downsampling preserves endpoints and sparse optional sensors without changing energy totals', async () => {
  await db.exec(`
    INSERT INTO drives VALUES (6,1,'2026-01-04','2026-01-04 01:00:00',10,200,190);
    INSERT INTO positions(id,car_id,drive_id,date,battery_level,rated_battery_range_km,power,battery_heater)
    SELECT 1000+i,1,6,'2026-01-04'::timestamp + i * interval '1 second',80,350,-1,
      CASE WHEN i=7 THEN true WHEN i=12 THEN false ELSE NULL END FROM generate_series(0,3600) i;
  `);
  const data = await readDriveDetail(db, 1, 6);
  assert.equal(data.battery.sampleCounts.battery, 3601);
  assert.ok(data.battery.series.battery.length <= 1002);
  assert.equal(data.battery.series.battery[0].date, '2026-01-04T00:00:00.000Z');
  assert.equal(
    data.battery.series.battery.at(-1).date,
    '2026-01-04T01:00:00.000Z',
  );
  assert.deepEqual(
    data.battery.series.heater.map((p) => p.value),
    [1, 0],
  );
  assert.ok(Math.abs(data.energy.recoveredKwh - 1) < 1e-10);
  assert.equal(data.energy.recoveryCoverage, 1);
});
