// Run inside the deployed container. Only reports counts/status, never credentials
// or precise vehicle locations. Validates the real schema with SELECT queries.
import assert from 'node:assert/strict';
import pg from 'pg';
import { mergeStatus } from '../server/domain.mjs';
import { telemetrySql } from '../server/queries.mjs';
import { readSoftware } from '../server/software.mjs';
const base = `http://127.0.0.1:${process.env.PORT || 8787}`;
const headers = { Authorization: `Bearer ${process.env.API_KEY}` };
async function get(path) {
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}
assert.equal((await fetch(`${base}/`)).status, 200);
assert.equal((await fetch(`${base}/.env`)).status, 404);
assert.equal((await fetch(`${base}/api/cars`)).status, 401);
assert.equal(
  (await fetch(`${base}/api/cars`, { method: 'POST', headers })).status,
  405,
);
const { cars } = await get('/api/cars');
assert.ok(Array.isArray(cars));
// Exercise pairing with a disposable link. Never print the URL or session cookie.
assert.ok(process.env.WEB_ORIGIN, 'Device pairing requires WEB_ORIGIN');
const sessionHeaders = {
  Origin: process.env.WEB_ORIGIN,
  'Content-Type': 'application/json',
};
const createPair = await fetch(`${base}/api/pairings`, {
  method: 'POST',
  headers,
});
assert.equal(createPair.status, 201);
const { url: pairUrl } = await createPair.json();
const pairingToken = new URLSearchParams(new URL(pairUrl).hash.slice(1)).get(
  'pair',
);
const exchange = () =>
  fetch(`${base}/api/session`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ pairingToken }),
  });
const paired = await exchange();
assert.equal(paired.status, 200);
const setCookie = paired.headers.get('set-cookie');
assert.ok(setCookie?.includes('HttpOnly'));
const cookie = setCookie.split(';')[0];
assert.equal((await exchange()).status, 401);
const deviceHeaders = { ...sessionHeaders, Cookie: cookie };
const restored = await fetch(`${base}/api/session`, { headers: deviceHeaders });
assert.equal((await restored.json()).authenticated, true);
const deviceCars = await fetch(`${base}/api/cars`, { headers: deviceHeaders });
assert.equal(deviceCars.status, 200);
assert.equal((await deviceCars.json()).cars.length, cars.length);
assert.equal(
  (
    await fetch(`${base}/api/cars`, {
      headers: { Cookie: cookie, Origin: 'https://unrelated.example' },
    })
  ).status,
  401,
);
const logout = await fetch(`${base}/api/session`, {
  method: 'DELETE',
  headers: deviceHeaders,
});
assert.equal(logout.status, 200);
assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
const summary = [];
const statuses = new Map();
for (const car of cars) {
  for (const days of [7, 30, 90]) {
    const data = await get(`/api/cars/${car.id}/dashboard?days=${days}`);
    assert.equal(data.car.id, car.id);
    assert.ok(Array.isArray(data.daily));
    const tripLabels = data.drives.flatMap((drive) => [drive.start, drive.end]);
    assert.ok(tripLabels.every((label) => typeof label === 'string'));
    assert.ok(
      data.charges.every((charge) => typeof charge.location === 'string'),
    );
    if (days === 30) {
      statuses.set(car.id, data.status);
      summary.push({
        carId: car.id,
        days,
        drives: data.totals.driveCount,
        charges: data.totals.chargeCount,
        mqtt: data.status.live,
        softwareAvailable: !!data.status.version,
        softwareSource: data.status.versionSource,
        sentryAvailable: data.status.sentry !== null,
        sentrySource: data.status.sentrySource,
        electricityAggregates: typeof data.totals.missingCostEnergy === 'number' && typeof data.totals.estimableCosts === 'number',
        locationAvailable: !!(data.status.coordinates || data.status.location),
        locationSource: data.status.locationSource,
        locationTimeAvailable: !!data.status.locationRecordedAt,
        tiresAvailable: data.status.tires.filter((value) => value !== null)
          .length,
        tireSources: data.status.tireSources,
        tireTimesAvailable: data.status.tiresRecordedAt.filter(Boolean).length,
        tripAddressLabels: tripLabels.length,
        chineseTripLabels: tripLabels.filter((label) =>
          /\p{Script=Han}/u.test(label),
        ).length,
        approximateTripLabels: tripLabels.filter((label) =>
          label.endsWith('附近'),
        ).length,
        detailedRoadLabels: data.drives
          .flatMap((d) => [d.startAddressInfo, d.endAddressInfo])
          .filter((info) => info?.source === 'amap' && info?.road).length,
      });
    }
    for (const mode of ['drives', 'charges']) {
      const page = await get(
        `/api/cars/${car.id}/${mode}?days=${days}&limit=30&offset=0`,
      );
      assert.ok(Array.isArray(page.items));
      if (page.items[0]) {
        const kind = mode === 'drives' ? 'track' : 'curve';
        const detail = await get(
          `/api/cars/${car.id}/${mode}/${page.items[0].id}/${kind}`,
        );
        assert.ok(Array.isArray(detail.points));
        if (mode === 'drives' && days === 30 && process.env.AMAP_KEY) {
          const map = await get(
            `/api/cars/${car.id}/drives/${page.items[0].id}/map?focus=route&zoom=0`,
          );
          assert.ok(
            map.image?.startsWith('data:image/png;base64,') ||
              map.image?.startsWith('data:image/jpeg;base64,'),
          );
          assert.ok(
            !JSON.stringify(map).includes(process.env.AMAP_KEY),
            'Map response must not contain the provider key',
          );
          assert.equal(map.coordinateSystem, 'GCJ-02');
          assert.ok(map.pointCount > 0);
        }
      }
    }
  }
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 15000,
  connectionTimeoutMillis: 10000,
});
try {
  const {
    rows: [role],
  } = await pool.query(`SELECT current_user AS name,
    current_setting('default_transaction_read_only') AS readonly,
    has_table_privilege(current_user,'public.cars','UPDATE') AS can_update,
    has_table_privilege(current_user,'public.cars','DELETE') AS can_delete,
    has_table_privilege(current_user,'public.cars','INSERT') AS can_insert`);
  assert.equal(role.name, decodeURIComponent(new URL(process.env.DATABASE_URL).username));
  assert.equal(role.readonly, 'on');
  assert.equal(role.can_update, false);
  assert.equal(role.can_delete, false);
  assert.equal(role.can_insert, false);
  const { rows: permissions } = await pool.query(`SELECT has_table_privilege(current_user,'public.updates','SELECT') AS can_read_updates`);
  assert.equal(permissions[0].can_read_updates, true);
  for (const [id, status] of statuses) {
    const {
      rows: [row],
    } = await pool.query(telemetrySql, [id]);
    const expected = mergeStatus({}, {}, {}, null, row);
    const software = await readSoftware(pool, id);
    if (software.version && status.versionSource !== 'mqtt') {
      assert.ok(status.version === software.version, 'Latest completed software version fallback must match');
      assert.equal(status.versionSource, 'database');
    }
    // Deliberately avoid deepEqual here: a failure must not log private values.
    const matches = (actual, value, field) =>
      assert.ok(
        JSON.stringify(actual) === JSON.stringify(value),
        `Database fallback mismatch: ${field}`,
      );
    if (status.locationSource !== 'mqtt') {
      matches(status.coordinates, expected.coordinates, 'coordinates');
      matches(status.locationSource, expected.locationSource, 'locationSource');
      matches(
        status.locationRecordedAt,
        expected.locationRecordedAt,
        'locationRecordedAt',
      );
    } else {
      assert.equal(status.locationRecordedAt, null);
    }
    for (let i = 0; i < 4; i++) {
      if (status.tireSources[i] !== 'mqtt') {
        matches(status.tires[i], expected.tires[i], `tire ${i}`);
        matches(
          status.tireSources[i],
          expected.tireSources[i],
          `tire source ${i}`,
        );
        matches(
          status.tiresRecordedAt[i],
          expected.tiresRecordedAt[i],
          `tire time ${i}`,
        );
      } else {
        assert.equal(status.tiresRecordedAt[i], null);
      }
    }
  }
} finally {
  await pool.end();
}
console.log(
  JSON.stringify({
    verified: true,
    cars: cars.length,
    summary,
    readOnlyRole: true,
    devicePairing: true,
    telemetryFallback: true,
  }),
);
