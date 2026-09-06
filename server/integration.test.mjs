import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  authorized,
  getPeriod,
  positiveInt,
  mergeStatus,
  normalizeRecord,
} from './domain.mjs';
import { createApp } from './index.mjs';
import * as sql from './queries.mjs';
import { createMapService } from './maps.mjs';
const db = new PGlite();
const key = 'a'.repeat(40);
let app, base, maps;
const mapCalls = [];
const query = async (text, args = []) =>
  (await db.query(text, args)).rows.map(normalizeRecord);
before(async () => {
  await db.exec(`
 CREATE TABLE cars(id int primary key,name text,model text,marketing_name text,trim_badging text,display_priority int,efficiency float);
 CREATE TABLE addresses(id int primary key,name text,city text,road text);
 CREATE TABLE geofences(id int primary key,name text);
 CREATE TABLE drives(id int primary key,car_id int,start_date timestamp,end_date timestamp,distance float,duration_min int,start_rated_range_km numeric,end_rated_range_km numeric,speed_max int,start_address_id int,end_address_id int,start_geofence_id int,end_geofence_id int);
 CREATE TABLE charging_processes(id int primary key,car_id int,start_date timestamp,end_date timestamp,charge_energy_added numeric,charge_energy_used numeric,cost numeric,start_battery_level int,end_battery_level int,duration_min int,end_rated_range_km numeric,address_id int,geofence_id int);
 CREATE TABLE positions(id int primary key,car_id int,drive_id int,date timestamp,latitude numeric,longitude numeric,speed int,battery_level int,rated_battery_range_km numeric,odometer float,inside_temp numeric,outside_temp numeric);
 CREATE TABLE charges(id int primary key,charging_process_id int,date timestamp,battery_level int,rated_battery_range_km numeric,charger_power int);
 CREATE TABLE states(car_id int,state text,start_date timestamp);
 INSERT INTO cars VALUES(1,'小白','3','长续航','LR',1,0.15),(2,'小蓝','Y','长续航','LR',2,0.17);
 INSERT INTO geofences VALUES(1,'家'),(2,'公司');
 INSERT INTO addresses VALUES(1,'','上海','世纪大道');
 INSERT INTO drives SELECT i,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - interval '1 minute' * i,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',10,20,300,290,80,1,1,1,2 FROM generate_series(1,61) i;
 INSERT INTO drives VALUES(100,2,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC',500,20,300,200,100,1,1,1,2);
 INSERT INTO drives VALUES(101,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',NULL,50,20,300,290,80,1,1,1,2);
 INSERT INTO charging_processes VALUES(1,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC'-interval '1 hour',CURRENT_TIMESTAMP AT TIME ZONE 'UTC',20,23,10,20,80,180,350,1,1),(2,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC'-interval '2 hours',CURRENT_TIMESTAMP AT TIME ZONE 'UTC',10,12,NULL,60,80,60,350,1,1),(3,2,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC',50,55,99,20,90,60,400,1,1);
 INSERT INTO positions VALUES(1,1,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC'-interval '2 hours',31.2,121.4,0,50,220,20000,25,28),(2,1,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC'-interval '1 hour',31.3,121.5,45,48,210,20010,25,28),(3,2,100,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',30.3,120.5,40,48,210,20010,25,28);
 INSERT INTO charges VALUES(1,1,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',80,350,7);
 INSERT INTO states VALUES(1,'asleep',CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),(2,'online',CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
 `);
  maps = await createMapService({
    key: 'b'.repeat(32),
    delayMs: 0,
    requestIntervalMs: 0,
    fetcher: async (url) => {
      mapCalls.push(url);
      if (url.pathname.endsWith('/staticmap'))
        return new Response(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLlMAAAAASUVORK5CYII=',
            'base64',
          ),
          { headers: { 'content-type': 'image/png' } },
        );
      return new Response(
        JSON.stringify({
          status: '1',
          regeocode: {
            formatted_address: '浙江省示例市示例路12号',
            addressComponent: {
              streetNumber: { street: '示例路', number: '12号' },
            },
          },
        }),
      );
    },
  });
  app = createApp({
    pool: db,
    key,
    maps,
    origins: ['https://car.example.com', 'capacitor://localhost'],
  });
  await new Promise((ok, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', ok);
  });
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  if (app?.listening) await new Promise((ok) => app.close(ok));
  if (maps) await maps.close();
  await db.close();
});
void test('authentication, allowed origins, and read-only methods', async () => {
  assert.equal(authorized(`Bearer ${key}`, key), true);
  assert.equal(authorized(`Bearer ${key} `, key), false);
  assert.equal((await fetch(`${base}/api/cars`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/cars`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
      })
    ).status,
    405,
  );
  const approved = await fetch(`${base}/api/cars`, {
    method: 'OPTIONS',
    headers: { Origin: 'capacitor://localhost' },
  });
  assert.equal(approved.status, 204);
  assert.equal(
    approved.headers.get('Access-Control-Allow-Origin'),
    'capacitor://localhost',
  );
  assert.equal(
    (
      await fetch(`${base}/api/cars`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://unrelated.example' },
      })
    ).status,
    403,
  );
  const cars = await (
    await fetch(`${base}/api/cars`, {
      headers: { Authorization: `Bearer ${key}` },
    })
  ).json();
  assert.equal(cars.cars.length, 2);
  assert.equal(cars.cars[0].id, 1);
});
void test('dashboard aggregates all records beyond first page and excludes unfinished trips / other cars', async () => {
  const response = await fetch(`${base}/api/cars/1/dashboard?days=7`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.drives.length, 50);
  assert.equal(data.totals.driveCount, 61);
  assert.equal(data.totals.distance, 610);
  assert.equal(data.totals.energy, 30);
  assert.equal(data.totals.cost, 10);
  assert.equal(data.totals.missingCosts, 1);
  assert.equal(data.totals.missingCostEnergy, 12);
  assert.equal(data.totals.estimableCosts, 1);
  assert.equal(data.totals.consumption, 15);
  assert.equal(data.status.battery, 80);
  assert.equal(data.status.range, 350);
  // Older schemas without TPMS columns still return the last valid location.
  assert.deepEqual(data.status.coordinates, {
    latitude: 31.3,
    longitude: 121.5,
  });
  assert.equal(data.status.locationSource, 'database');
  assert.ok(Number.isFinite(Date.parse(data.status.locationRecordedAt)));
  assert.notEqual(data.status.locationRecordedAt, data.status.updatedAt);
  assert.deepEqual(data.status.tires, Array(4).fill(null));
  assert.deepEqual(data.status.tireSources, Array(4).fill(null));
  assert.deepEqual(data.status.tiresRecordedAt, Array(4).fill(null));
  assert.equal(data.drives[0].start, '家');
  assert.equal(data.truncated, true);
  assert.equal(data.battery.length, 1);
  assert.ok(data.battery[0].range > 437 && data.battery[0].range < 438);
});
void test('pagination, parameter rejection, and car ownership of track and curve', async () => {
  const headers = { Authorization: `Bearer ${key}` };
  const page = await (
    await fetch(`${base}/api/cars/1/drives?days=7&offset=50&limit=30`, {
      headers,
    })
  ).json();
  assert.equal(page.items.length, 11);
  assert.equal(page.hasMore, false);
  assert.equal(
    (await fetch(`${base}/api/cars/1/drives?days=999`, { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/cars/1/drives?offset=-1`, { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/cars/9/dashboard`, { headers })).status,
    404,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/cars/1/drives/1/track`, { headers })
      ).json()
    ).points.length,
    2,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/cars/2/drives/1/track`, { headers })
      ).json()
    ).points.length,
    0,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/cars/1/charges/1/curve`, { headers })
      ).json()
    ).points.length,
    1,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/cars/2/charges/1/curve`, { headers })
      ).json()
    ).points.length,
    0,
  );
});
void test('China date boundaries and daily distance use the same calendar', async () => {
  const { since } = getPeriod('7', new Date('2026-09-05T00:15:00+08:00'));
  assert.equal(since.toISOString(), '2026-08-29T16:00:00.000Z');
  assert.throws(() => positiveInt('1 OR 1=1'));
  assert.throws(() => getPeriod('8'));
  await db.exec(
    `INSERT INTO drives VALUES(202,2,'2026-08-31 16:01:00','2026-08-31 16:20:00',12,20,300,290,50,1,1,1,2)`,
  );
  const rows = await query(sql.dailySql, [2, '2026-08-31T16:00:00Z']);
  assert.equal(rows.find((r) => r.date === '2026-09-01').distance, 12);
});
void test('unknown telemetry stays null and retained message receipt never masquerades as freshness', () => {
  const unknown = mergeStatus();
  assert.equal(unknown.battery, null);
  assert.equal(unknown.locked, null);
  assert.equal(unknown.live, false);
  const merged = mergeStatus(
    { date: '2026-01-01T00:00:00Z', battery: 10 },
    { date: '2026-01-01T01:00:00Z', battery: 80 },
    { state: 'asleep' },
    { connected: true, values: { battery_level: '78', locked: false } },
  );
  assert.equal(merged.battery, 78);
  assert.equal(merged.locked, false);
  assert.equal(merged.updatedAt, '2026-01-01T01:00:00Z');
});

void test('Chinese address labels are identical in overview, paginated drives, and charging records', async () => {
  // Earlier tests exercise a minimal legacy schema; modern TeslaMate also has raw JSON.
  await db.exec(`
    ALTER TABLE addresses ADD COLUMN raw jsonb;
    INSERT INTO addresses VALUES
      (2,'Example Avenue','Example City','Example Avenue','{"namedetails":{"name:zh":"示例大道"},"lat":"1","lon":"2","osm_id":123}'),
      (3,'Example Road','Example City','Example Road','{"address":{"hamlet":"示例村"}}');
    UPDATE drives SET start_address_id=2,end_address_id=3,start_geofence_id=NULL,end_geofence_id=NULL WHERE id=100;
    UPDATE charging_processes SET address_id=2,geofence_id=NULL WHERE id=3;
  `);
  const headers = { Authorization: `Bearer ${key}` };
  const data = await (
    await fetch(`${base}/api/cars/2/dashboard?days=7`, { headers })
  ).json();
  assert.equal(data.drives.find((drive) => drive.id === 100).start, '示例大道');
  assert.equal(data.drives.find((drive) => drive.id === 100).end, '示例村附近');
  assert.equal(
    data.charges.find((charge) => charge.id === 3).location,
    '示例大道',
  );
  for (const mode of ['drives', 'charges']) {
    const { items } = await (
      await fetch(`${base}/api/cars/2/${mode}?days=7`, { headers })
    ).json();
    const item = items.find((row) => row.id === (mode === 'drives' ? 100 : 3));
    assert.equal(mode === 'drives' ? item.start : item.location, '示例大道');
    assert.doesNotMatch(
      JSON.stringify(item),
      /namedetails|osm_id|Example Avenue/,
    );
  }
});

void test('map API enforces authentication, ownership and bounded parameters; detail labels use actual endpoint samples', async () => {
  const headers = { Authorization: `Bearer ${key}` };
  assert.equal((await fetch(`${base}/api/cars/1/drives/1/map`)).status, 401);
  assert.equal(
    (await fetch(`${base}/api/cars/2/drives/1/map`, { headers })).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/api/cars/1/drives/1/map?zoom=99`, { headers }))
      .status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/cars/1/drives/1/map?focus=evil`, { headers }))
      .status,
    400,
  );
  assert.equal(mapCalls.length, 0);
  const response = await fetch(
    `${base}/api/cars/1/drives/1/map?focus=route&zoom=0`,
    { headers },
  );
  const frame = await response.json();
  assert.equal(response.status, 200);
  assert.equal(frame.pointCount, 2);
  assert.equal(frame.coordinateSystem, 'GCJ-02');
  assert.match(frame.image, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(frame).includes('b'.repeat(32)), false);
  await db.exec(
    'ALTER TABLE drives ADD COLUMN start_position_id int; ALTER TABLE drives ADD COLUMN end_position_id int; UPDATE drives SET start_position_id=3,end_position_id=3 WHERE id=100;',
  );
  const { items } = await (
    await fetch(`${base}/api/cars/2/drives?days=7`, { headers })
  ).json();
  const drive = items.find((row) => row.id === 100);
  assert.equal(drive.start, '浙江省示例市示例路12号');
  assert.equal(drive.end, drive.start);
  assert.equal(drive.startAddressInfo.road, '示例路');
  assert.ok(mapCalls.at(-1).searchParams.get('location').startsWith('120.'));
});
