import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { driveTotalsSql, recentDrivingSql } from './queries.mjs';
import { readDriveDetail } from './drive-detail.mjs';
import { normalizeRecord, getPeriod } from './domain.mjs';

const db = new PGlite();
const now = new Date('2026-09-07T12:00:00Z');
const since = getPeriod('30', now).since.toISOString();
const totals = async (car = 2, start = since) =>
  normalizeRecord(
    (await db.query(driveTotalsSql, [car, start, now.toISOString()])).rows[0],
  );
before(async () => {
  await db.exec(`
    CREATE TABLE cars(id int PRIMARY KEY, efficiency numeric);
    CREATE TABLE drives(id int PRIMARY KEY,car_id int,start_date timestamp,end_date timestamp,distance numeric,start_rated_range_km numeric,end_rated_range_km numeric);
    CREATE TABLE positions(id int PRIMARY KEY,car_id int,drive_id int,date timestamp,power numeric,battery_level int,rated_battery_range_km numeric);
    INSERT INTO cars VALUES (1,0.15),(2,NULL),(3,NULL),(4,NULL);
    INSERT INTO drives SELECT i,2,'2026-09-06'::timestamp,'2026-09-06 00:00:05'::timestamp,
      CASE WHEN i=61 THEN 10 ELSE 1 END,NULL,NULL FROM generate_series(1,61) i;
    INSERT INTO positions(id,car_id,drive_id,date,power)
      SELECT i*2+j,2,i,'2026-09-06'::timestamp+j*interval '5 seconds',CASE WHEN i=61 THEN -18 ELSE 36 END
      FROM generate_series(1,61) i CROSS JOIN generate_series(0,1) j;
    INSERT INTO drives VALUES
      (62,2,'2026-09-06','2026-09-06 00:00:05',2,NULL,NULL),
      (63,2,'2026-09-06','2026-09-06 00:01:03',100,NULL,NULL),
      (64,2,'2026-09-06','2026-09-06 00:00:05',50,NULL,NULL),
      (65,2,'2026-09-06',NULL,999,NULL,NULL),
      (66,2,'2026-09-06','2026-09-06 00:00:05',0,NULL,NULL),
      (67,2,'2026-08-08 15:59:59','2026-08-08 16:00:00',999,NULL,NULL),
      (68,2,'2026-09-08','2026-09-08 00:00:05',999,NULL,NULL),
      (69,2,'2026-09-07 11:59:59','2026-09-08 00:00:05',999,NULL,NULL),
      (100,1,'2026-09-06','2026-09-06 00:00:05',10,200,190),
      (101,1,'2026-09-06','2026-09-06 00:00:05',5,NULL,NULL),
      (200,3,'2026-09-06','2026-09-06 00:00:05',7,NULL,NULL);
    INSERT INTO positions(id,car_id,drive_id,date,power) VALUES
      (124,2,62,'2026-09-06',0),(125,2,62,'2026-09-06 00:00:05',0),
      (126,2,63,'2026-09-06',36),(127,2,63,'2026-09-06 00:00:03',36),
      (128,2,63,'2026-09-06 00:01:02',36),(129,2,63,'2026-09-06 00:01:03',36),
      (130,1,64,'2026-09-06',999),(131,1,64,'2026-09-06 00:00:05',999),
      (200,1,100,'2026-09-06',999),(201,1,100,'2026-09-06 00:00:05',999),
      (202,1,101,'2026-09-06',36),(203,1,101,'2026-09-06 00:00:05',36);
  `);
});
after(() => db.close());

void test('overview integrates every eligible drive beyond page 50 and weights only complete energy by distance', async () => {
  const stats = await totals();
  assert.equal(stats.driveCount, 64);
  assert.equal(stats.distance, 222);
  assert.equal(stats.consumptionDriveCount, 62);
  assert.equal(stats.consumptionDistance, 72);
  assert.equal(stats.consumptionExcludedDriveCount, 2);
  assert.equal(stats.powerEstimatedDriveCount, 62);
  assert.ok(Math.abs(stats.consumption - (2.975 / 72) * 100) < 1e-10);
  assert.notEqual(
    stats.consumption,
    (60 * 5 - 0.25) / 62,
    'Not a mean of per-drive averages',
  );
  let energy = 0,
    distance = 0;
  for (let id = 1; id <= 64; id++) {
    const detail = await readDriveDetail(db, 2, id);
    if (detail.energy.consumptionKwh100Km !== null) {
      energy += detail.energy.netKwh;
      distance += id === 61 ? 10 : id === 62 ? 2 : 1;
    }
  }
  assert.ok(
    Math.abs(stats.consumption - (energy / distance) * 100) < 1e-10,
    'Overview and detail must share the same calculation',
  );
});

void test('rated energy stays preferred and only missing-range drives use the power fallback', async () => {
  const stats = await totals(1);
  assert.equal(stats.distance, 15);
  assert.equal(stats.consumptionDriveCount, 2);
  assert.equal(stats.powerEstimatedDriveCount, 1);
  assert.ok(Math.abs(stats.consumption - (1.55 / 15) * 100) < 1e-10);
});

void test('no usable energy is unknown, while empty driving history really has zero trips and distance', async () => {
  const missing = await totals(3);
  assert.equal(missing.driveCount, 1);
  assert.equal(missing.consumption, null);
  assert.equal(missing.consumptionExcludedDriveCount, 1);
  const empty = await totals(4);
  assert.equal(empty.driveCount, 0);
  assert.equal(empty.distance, 0);
  assert.equal(empty.consumption, null);
});

void test('fixed 30-day count and distance honor China date boundaries and exclude unfinished/future/other-car records', async () => {
  assert.equal(since, '2026-08-08T16:00:00.000Z');
  await db.exec(`INSERT INTO drives VALUES (300,4,'2026-08-08 16:00:00','2026-08-08 16:00:05',3,NULL,NULL),
    (301,4,'2026-08-08 15:59:59','2026-08-08 16:00:04',90,NULL,NULL)`);
  const read = async (car) =>
    normalizeRecord(
      (await db.query(recentDrivingSql, [car, since, now.toISOString()]))
        .rows[0],
    );
  assert.deepEqual(await read(2), { driveCount: 64, distance: 222 });
  assert.deepEqual(await read(4), { driveCount: 1, distance: 3 });
  assert.equal((await totals(4)).driveCount, 1);
});
