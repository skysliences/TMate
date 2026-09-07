// Run from the container's /app root via stdin. No credentials, GPS, addresses
// or exact vehicle readings are printed. Only read-only DB/API checks occur.
import assert from 'node:assert/strict';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
const { getPeriod, normalizeRecord } = await import(
  pathToFileURL(process.cwd() + '/server/domain.mjs')
);
const { driveTotalsSql, recentDrivingSql } = await import(
  pathToFileURL(process.cwd() + '/server/queries.mjs')
);
const { readDriveDetail } = await import(
  pathToFileURL(process.cwd() + '/server/drive-detail.mjs')
);
const databaseOnly = process.argv.includes('--database-only');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  options: '-c default_transaction_read_only=on -c statement_timeout=15000',
});
const base = 'http://127.0.0.1:' + (process.env.PORT || 8787);
const headers = { Authorization: 'Bearer ' + process.env.API_KEY };
const near = (a, b) =>
  assert.ok(
    typeof a === 'number' && Math.abs(a - b) < 1e-7,
    'Aggregate mismatch',
  );
try {
  const { rows: cars } = await pool.query('SELECT id FROM cars ORDER BY id');
  const report = [];
  const details = new Map();
  for (const car of cars) {
    for (const days of [7, 30, 90]) {
      const started = Date.now();
      let data,
        now = new Date();
      if (!databaseOnly) {
        const response = await fetch(
          `${base}/api/cars/${car.id}/dashboard?days=${days}`,
          { headers },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        data = await response.json();
        now = new Date(data.asOf);
      }
      const { since } = getPeriod(String(days), now);
      const args = [car.id, since.toISOString(), now.toISOString()];
      const { rows } = await pool.query(
        `SELECT id,distance FROM drives WHERE car_id=$1
        AND start_date >= $2 AND start_date <= $3 AND end_date IS NOT NULL AND end_date <= $3 AND distance>0`,
        args,
      );
      let net = 0,
        includedDistance = 0,
        included = 0,
        power = 0;
      for (const drive of rows) {
        const key = `${car.id}:${drive.id}`;
        if (!details.has(key))
          details.set(key, await readDriveDetail(pool, car.id, drive.id));
        const { energy } = details.get(key);
        if (energy.netScope !== 'trip' || energy.consumptionKwh100Km === null)
          continue;
        net += energy.netKwh;
        includedDistance += Number(drive.distance);
        included++;
        power += Number(energy.netMethod === 'power');
      }
      const stats =
        data?.totals ??
        normalizeRecord((await pool.query(driveTotalsSql, args)).rows[0]);
      assert.equal(stats.driveCount, rows.length);
      near(
        stats.distance,
        rows.reduce((sum, d) => sum + Number(d.distance), 0),
      );
      assert.equal(stats.consumptionDriveCount, included);
      assert.equal(stats.consumptionExcludedDriveCount, rows.length - included);
      assert.equal(stats.powerEstimatedDriveCount, power);
      near(stats.consumptionDistance, includedDistance);
      if (includedDistance)
        near(stats.consumption, (net / includedDistance) * 100);
      else assert.equal(stats.consumption, null);
      const monthArgs = [
        car.id,
        getPeriod('30', now).since.toISOString(),
        now.toISOString(),
      ];
      const {
        rows: [month],
      } = await pool.query(
        `SELECT count(*) AS count,coalesce(sum(distance),0) AS distance
        FROM drives WHERE car_id=$1 AND start_date >= $2 AND start_date <= $3
        AND end_date IS NOT NULL AND end_date <= $3 AND distance>0`,
        monthArgs,
      );
      const recent =
        data?.recent30 ??
        normalizeRecord(
          (await pool.query(recentDrivingSql, monthArgs)).rows[0],
        );
      assert.equal(recent.driveCount, Number(month.count));
      near(recent.distance, Number(month.distance));
      report.push({
        days,
        drives: stats.driveCount,
        completeEnergyDrives: included,
        excludedEnergyDrives: rows.length - included,
        averageAvailable: stats.consumption !== null,
        powerEstimatedDrives: power,
        recent30Drives: recent.driveCount,
        elapsedMs: Date.now() - started,
      });
    }
  }
  assert.equal(
    (
      await pool.query(
        "SELECT current_setting('default_transaction_read_only') AS value",
      )
    ).rows[0].value,
    'on',
  );
  console.log(
    JSON.stringify({
      verified: true,
      mode: databaseOnly ? 'database' : 'http',
      overview: report,
    }),
  );
} finally {
  await pool.end();
}
