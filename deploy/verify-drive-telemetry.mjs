// Feed on stdin from the project root inside the TMate container.
// Use --database-only in a one-off new-image container before switching traffic.
// Only counts/availability are printed; never credentials, locations or values.
import assert from 'node:assert/strict';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
const { readDriveDetail } = await import(pathToFileURL(process.cwd() + '/server/drive-detail.mjs'));
const databaseOnly = process.argv.includes('--database-only');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1,
  options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
try {
  const { rows: records } = await pool.query(`SELECT d.id,d.car_id,d.distance,
    (d.start_rated_range_km-d.end_rated_range_km)*c.efficiency AS net
    FROM drives d JOIN cars c ON c.id=d.car_id WHERE d.end_date IS NOT NULL
    ORDER BY d.start_date DESC LIMIT 10`);
  const report = { verified: true, mode: databaseOnly ? 'database' : 'http', drives: records.length,
    netAvailable: 0, recoveryAvailable: 0, recoveryMissing: {}, curvesAvailable: {}, maxRequestMs: 0 };
  const base = 'http://127.0.0.1:' + (process.env.PORT || 8787);
  const headers = { Authorization: 'Bearer ' + process.env.API_KEY };
  for (const record of records) {
    const began = Date.now();
    const expected = await readDriveDetail(pool, record.car_id, record.id);
    assert.ok(expected);
    if (record.net !== null) assert.ok(Math.abs(expected.energy.netKwh - Number(record.net)) < 1e-8);
    if (!databaseOnly) {
      const path = base + '/api/cars/' + record.car_id + '/drives/' + record.id + '/detail';
      assert.equal((await fetch(path)).status, 401);
      const response = await fetch(path, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), expected);
    }
    report.maxRequestMs = Math.max(report.maxRequestMs, Date.now() - began);
    report.netAvailable += Number(expected.energy.netKwh !== null);
    report.recoveryAvailable += Number(expected.energy.recoveredKwh !== null);
    const reason = expected.energy.recoveryUnavailable;
    if (reason) report.recoveryMissing[reason] = (report.recoveryMissing[reason] || 0) + 1;
    for (const [sensor, points] of Object.entries(expected.battery.series)) {
      assert.ok(points.length <= 1002);
      for (let i = 0; i < points.length; i++) {
        assert.ok(Number.isFinite(points[i].value));
        assert.ok(Number.isFinite(Date.parse(points[i].date)));
        if (i) assert.ok(points[i].date >= points[i-1].date);
      }
      report.curvesAvailable[sensor] = (report.curvesAvailable[sensor] || 0) + Number(points.length > 0);
    }
  }
  const { rows: [role] } = await pool.query("SELECT current_setting('default_transaction_read_only') AS readonly");
  assert.equal(role.readonly, 'on');
  console.log(JSON.stringify(report));
} finally {
  await pool.end();
}
