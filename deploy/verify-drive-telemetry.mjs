// Feed on stdin from the project root inside the TMate container.
// Use --database-only in a one-off new-image container before switching traffic.
// Only counts/availability are printed; never credentials, locations or values.
import assert from 'node:assert/strict';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
const { readDriveDetail } = await import(
  pathToFileURL(process.cwd() + '/server/drive-detail.mjs')
);
const databaseOnly = process.argv.includes('--database-only');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  options: '-c default_transaction_read_only=on -c statement_timeout=15000',
});
try {
  const { rows: records } = await pool.query(`SELECT d.id,d.car_id,d.distance,
    CASE WHEN c.efficiency>0 THEN (d.start_rated_range_km-d.end_rated_range_km)*c.efficiency END AS net,
    extract(epoch FROM d.end_date-d.start_date) AS duration
    FROM drives d JOIN cars c ON c.id=d.car_id WHERE d.end_date IS NOT NULL
    ORDER BY d.start_date DESC LIMIT 10`);
  const report = {
    verified: true,
    mode: databaseOnly ? 'database' : 'http',
    drives: records.length,
    netAvailable: 0,
    fullEnergyEstimates: 0,
    partialEnergyEstimates: 0,
    averageAvailable: 0,
    netMethods: {},
    recoveryAvailable: 0,
    recoveryMissing: {},
    curvesAvailable: {},
    maxRequestMs: 0,
  };
  const base = 'http://127.0.0.1:' + (process.env.PORT || 8787);
  const headers = { Authorization: 'Bearer ' + process.env.API_KEY };
  for (const record of records) {
    const began = Date.now();
    const expected = await readDriveDetail(pool, record.car_id, record.id);
    assert.ok(expected);
    if (record.net !== null)
      assert.ok(Math.abs(expected.energy.netKwh - Number(record.net)) < 1e-8);
    // Independent JS integration of raw DB samples validates the SQL, including
    // short irregular intervals, zero crossings, nulls and whole-trip coverage.
    const { rows: samples } = await pool.query(
      `SELECT extract(epoch FROM p.date-d.start_date) AS elapsed,
      to_jsonb(p)->>'power' AS power FROM positions p JOIN drives d ON d.id=p.drive_id AND d.car_id=p.car_id
      WHERE d.car_id=$1 AND d.id=$2 AND p.date BETWEEN d.start_date AND d.end_date ORDER BY p.date,p.id`,
      [record.car_id, record.id],
    );
    let net = 0,
      recovered = 0,
      seconds = 0,
      intervals = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      const dt = Number(b.elapsed) - Number(a.elapsed);
      if (a.power === null || b.power === null || dt <= 0 || dt > 5) continue;
      const p = Number(a.power),
        q = Number(b.power);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      net += ((p + q) * dt) / 7200;
      if (p <= 0 && q <= 0) recovered -= ((p + q) * dt) / 7200;
      else if (p < 0) recovered += (((p * p) / (q - p)) * dt) / 7200;
      else if (q < 0) recovered += (((q * q) / (p - q)) * dt) / 7200;
      seconds += dt;
      intervals++;
    }
    if (intervals) {
      assert.ok(
        Math.abs(expected.energy.recoveredKwh - recovered) < 1e-7,
        'Recovery integration mismatch',
      );
      if (record.net === null) {
        assert.equal(expected.energy.netMethod, 'power');
        assert.ok(
          Math.abs(expected.energy.netKwh - net) < 1e-7,
          'Net integration mismatch',
        );
        const scope =
          Number(record.duration) > 0 &&
          Math.abs(seconds - Number(record.duration)) <= 0.001
            ? 'trip'
            : 'partial';
        assert.equal(expected.energy.netScope, scope);
      }
    } else if (record.net === null) assert.equal(expected.energy.netKwh, null);
    if (expected.energy.netScope === 'partial')
      assert.equal(expected.energy.consumptionKwh100Km, null);
    if (expected.energy.netScope === 'trip' && Number(record.distance) > 0) {
      assert.ok(
        Math.abs(
          expected.energy.consumptionKwh100Km -
            (expected.energy.netKwh / Number(record.distance)) * 100,
        ) < 1e-8,
      );
    }
    if (!databaseOnly) {
      const path =
        base +
        '/api/cars/' +
        record.car_id +
        '/drives/' +
        record.id +
        '/detail';
      assert.equal((await fetch(path)).status, 401);
      const response = await fetch(path, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), expected);
    }
    report.maxRequestMs = Math.max(report.maxRequestMs, Date.now() - began);
    report.netAvailable += Number(expected.energy.netKwh !== null);
    report.fullEnergyEstimates += Number(expected.energy.netScope === 'trip');
    report.partialEnergyEstimates += Number(
      expected.energy.netScope === 'partial',
    );
    report.averageAvailable += Number(
      expected.energy.consumptionKwh100Km !== null,
    );
    const method = expected.energy.netMethod || 'unavailable';
    report.netMethods[method] = (report.netMethods[method] || 0) + 1;
    report.recoveryAvailable += Number(expected.energy.recoveredKwh !== null);
    const reason = expected.energy.recoveryUnavailable;
    if (reason)
      report.recoveryMissing[reason] =
        (report.recoveryMissing[reason] || 0) + 1;
    for (const [sensor, points] of Object.entries(expected.battery.series)) {
      assert.ok(points.length <= 1002);
      for (let i = 0; i < points.length; i++) {
        assert.ok(Number.isFinite(points[i].value));
        assert.ok(Number.isFinite(Date.parse(points[i].date)));
        if (i) assert.ok(points[i].date >= points[i - 1].date);
      }
      report.curvesAvailable[sensor] =
        (report.curvesAvailable[sensor] || 0) + Number(points.length > 0);
    }
  }
  const {
    rows: [role],
  } = await pool.query(
    "SELECT current_setting('default_transaction_read_only') AS readonly",
  );
  assert.equal(role.readonly, 'on');
  console.log(JSON.stringify(report));
} finally {
  await pool.end();
}
