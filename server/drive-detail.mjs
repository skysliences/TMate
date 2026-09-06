import { numberOrNull } from './domain.mjs';

export const driveEnergySql = `SELECT d.distance, c.efficiency AS coefficient,
  CASE WHEN c.efficiency > 0 THEN
    (d.start_rated_range_km - d.end_rated_range_km) * c.efficiency END AS net,
  extract(epoch FROM d.end_date - d.start_date) AS duration,
  r.samples, r.intervals, r.seconds, r.recovered
  FROM drives d JOIN cars c ON c.id=d.car_id
  LEFT JOIN LATERAL (
    WITH samples AS (
      SELECT p.date, p.id, (to_jsonb(p)->>'power')::numeric AS power
      FROM positions p WHERE p.drive_id=d.id AND p.car_id=d.car_id
        AND p.date BETWEEN d.start_date AND d.end_date
    ), intervals AS (
      SELECT power, lag(power) OVER w AS previous,
        extract(epoch FROM date - lag(date) OVER w) AS dt
      FROM samples WINDOW w AS (ORDER BY date,id)
    ), valid AS (
      SELECT *, dt > 0 AND dt <= 1.5 AND power IS NOT NULL AND previous IS NOT NULL AS usable
      FROM intervals
    ) SELECT count(power) AS samples, count(*) FILTER (WHERE usable) AS intervals,
      sum(dt) FILTER (WHERE usable) AS seconds,
      sum(CASE
        WHEN power <= 0 AND previous <= 0 THEN -(power + previous) * dt / 7200
        WHEN previous < 0 AND power > 0 THEN previous * previous / (power - previous) * dt / 7200
        WHEN power < 0 AND previous > 0 THEN power * power / (previous - power) * dt / 7200
        ELSE 0 END) FILTER (WHERE usable) AS recovered
    FROM valid
  ) r ON true WHERE d.car_id=$1 AND d.id=$2 AND d.end_date IS NOT NULL`;

// Sample each sensor separately, so dense SOC samples cannot erase sparse range
// or heater readings. No GPS requirement; always retain each sensor's endpoints.
export const driveBatterySql = `WITH samples AS (
  SELECT p.id, p.date, v.key, v.value FROM positions p
  JOIN drives d ON d.id=p.drive_id AND d.car_id=p.car_id
  CROSS JOIN LATERAL (VALUES
    ('battery', p.battery_level::numeric, 100),
    ('usableBattery', (to_jsonb(p)->>'usable_battery_level')::numeric, 100),
    ('ratedRange', p.rated_battery_range_km, 2000),
    ('estimatedRange', (to_jsonb(p)->>'est_battery_range_km')::numeric, 2000),
    ('heater', CASE to_jsonb(p)->>'battery_heater' WHEN 'true' THEN 1 WHEN 'false' THEN 0 END, 1)
  ) v(key,value,maximum)
  WHERE d.car_id=$1 AND d.id=$2 AND d.end_date IS NOT NULL
    AND p.date BETWEEN d.start_date AND d.end_date AND v.value BETWEEN 0 AND v.maximum
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY key ORDER BY date,id) AS n,
    count(*) OVER (PARTITION BY key) AS total FROM samples
) SELECT key, date AT TIME ZONE 'UTC' AS date, value, total FROM ranked
  WHERE n=1 OR n=total OR mod(n,greatest(1,ceil(total / 1000.0)::bigint))=0
  ORDER BY key,date,id`;

export async function readDriveDetail(pool, carId, driveId) {
  const {
    rows: [row],
  } = await pool.query(driveEnergySql, [carId, driveId]);
  if (!row) return null;
  const net = numberOrNull(row.net);
  const distance = numberOrNull(row.distance);
  const duration = numberOrNull(row.duration);
  const coveredSeconds = numberOrNull(row.seconds) ?? 0;
  const validIntervals = Number(row.intervals) || 0;
  const series = Object.fromEntries(
    ['battery', 'usableBattery', 'ratedRange', 'estimatedRange', 'heater'].map(
      (key) => [key, []],
    ),
  );
  const sampleCounts = Object.fromEntries(
    Object.keys(series).map((key) => [key, 0]),
  );
  const { rows } = await pool.query(driveBatterySql, [carId, driveId]);
  for (const point of rows) {
    const value = numberOrNull(point.value);
    const date = new Date(point.date);
    if (
      !(point.key in series) ||
      value === null ||
      !Number.isFinite(date.getTime())
    )
      continue;
    series[point.key].push({ date: date.toISOString(), value });
    sampleCounts[point.key] = Number(point.total);
  }
  return {
    energy: {
      netKwh: net,
      netUnavailable:
        net !== null
          ? null
          : numberOrNull(row.coefficient) > 0
            ? 'no-range'
            : 'no-efficiency',
      consumptionKwh100Km:
        net !== null && distance > 0 ? (net / distance) * 100 : null,
      recoveredKwh: validIntervals > 0 ? numberOrNull(row.recovered) : null,
      recoveryCoverage:
        duration > 0 ? Math.min(1, coveredSeconds / duration) : null,
      recoveryUnavailable:
        validIntervals > 0
          ? null
          : Number(row.samples)
            ? 'sparse-power'
            : 'no-power',
    },
    battery: { series, sampleCounts },
  };
}
