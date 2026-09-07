// Independent, parameterized read-only queries against the documented TeslaMate schema.
// Upstream schema references are listed in README.md. No Tesla account tokens are accessed.
import { drivePowerSql, ratedEnergySql } from './drive-detail.mjs';
export const carsSql = `SELECT id, coalesce(nullif(name, ''), '我的特斯拉') AS name,
  coalesce(model, '') AS model, coalesce(marketing_name, trim_badging, '') AS trim
  FROM cars ORDER BY display_priority NULLS LAST, id`;

const place = (g, a, p) =>
  `jsonb_build_object('geofence', ${g}.name, 'address', to_jsonb(${a}), 'point',
    jsonb_build_object('latitude', coalesce(${p}.latitude, (to_jsonb(${a})->>'latitude')::numeric),
      'longitude', coalesce(${p}.longitude, (to_jsonb(${a})->>'longitude')::numeric)))`;
const energy = `(d.start_rated_range_km - d.end_rated_range_km) * c.efficiency`;
export const driveBase = `SELECT d.id, d.start_date AS date, ${place('sg', 'sa', 'sp')} AS start,
  ${place('eg', 'ea', 'ep')} AS end, d.distance, d.duration_min AS duration,
  ${energy} AS energy, d.speed_max AS "speedMax"
  FROM drives d JOIN cars c ON c.id=d.car_id
  LEFT JOIN positions sp ON sp.id=(to_jsonb(d)->>'start_position_id')::bigint
  LEFT JOIN positions ep ON ep.id=(to_jsonb(d)->>'end_position_id')::bigint
  LEFT JOIN addresses sa ON sa.id=d.start_address_id LEFT JOIN addresses ea ON ea.id=d.end_address_id
  LEFT JOIN geofences sg ON sg.id=d.start_geofence_id LEFT JOIN geofences eg ON eg.id=d.end_geofence_id
  WHERE d.car_id=$1 AND d.start_date >= $2 AND d.end_date IS NOT NULL AND d.distance > 0`;
export const drivesSql = `${driveBase} ORDER BY d.start_date DESC, d.id DESC LIMIT $3 OFFSET $4`;
export const chargeBase = `SELECT cp.id, cp.start_date AS date, ${place('g', 'a', 'p')} AS location,
  cp.charge_energy_added AS energy, cp.charge_energy_used AS used, cp.cost,
  cp.start_battery_level AS "startBattery", cp.end_battery_level AS "endBattery", cp.duration_min AS duration
  FROM charging_processes cp LEFT JOIN addresses a ON a.id=cp.address_id
  LEFT JOIN positions p ON p.id=(to_jsonb(cp)->>'position_id')::bigint
  LEFT JOIN geofences g ON g.id=cp.geofence_id
  WHERE cp.car_id=$1 AND cp.start_date >= $2 AND cp.end_date IS NOT NULL`;
export const chargesSql = `${chargeBase} ORDER BY cp.start_date DESC, cp.id DESC LIMIT $3 OFFSET $4`;
// Same complete-drive estimate as the detail endpoint. A partial power sum
// must never be divided by the full trip distance or included in a period mean.
export const driveTotalsSql = `WITH estimates AS (
  SELECT d.distance, ${ratedEnergySql} AS rated_net,
    CASE WHEN extract(epoch FROM d.end_date-d.start_date)>0 AND r.intervals>0
      AND abs(extract(epoch FROM d.end_date-d.start_date)-r.seconds)<=0.001
      THEN r.power_net END AS power_net
  FROM drives d JOIN cars c ON c.id=d.car_id
  LEFT JOIN LATERAL (${drivePowerSql(true)}) r ON true
  WHERE d.car_id=$1 AND d.start_date >= $2 AND d.end_date IS NOT NULL AND d.distance > 0
    AND d.start_date <= $3 AND d.end_date <= $3
) SELECT coalesce(sum(distance),0) AS distance, count(*) AS "driveCount",
  sum(coalesce(rated_net,power_net)) / nullif(sum(distance) FILTER (WHERE coalesce(rated_net,power_net) IS NOT NULL),0) * 100 AS consumption,
  count(*) FILTER (WHERE coalesce(rated_net,power_net) IS NOT NULL) AS "consumptionDriveCount",
  coalesce(sum(distance) FILTER (WHERE coalesce(rated_net,power_net) IS NOT NULL),0) AS "consumptionDistance",
  count(*) FILTER (WHERE coalesce(rated_net,power_net) IS NULL) AS "consumptionExcludedDriveCount",
  count(*) FILTER (WHERE rated_net IS NULL AND power_net IS NOT NULL) AS "powerEstimatedDriveCount"
  FROM estimates`;
// A small independent aggregate keeps the homepage's fixed 30-day figures
// correct even when the other panels are set to 7/90 days or lists are paged.
export const recentDrivingSql = `SELECT count(*) AS "driveCount", coalesce(sum(distance),0) AS distance
  FROM drives WHERE car_id=$1 AND start_date >= $2 AND start_date <= $3
  AND end_date IS NOT NULL AND end_date <= $3 AND distance > 0`;
const billableEnergy = `CASE WHEN charge_energy_used >= 0 THEN charge_energy_used WHEN charge_energy_added >= 0 THEN charge_energy_added ELSE NULL END`;
export const chargeTotalsSql = `SELECT coalesce(sum(charge_energy_added),0) AS energy,
  count(*) AS "chargeCount", coalesce(sum(cost),0) AS cost,
  count(*) FILTER (WHERE cost IS NULL) AS "missingCosts",
  coalesce(sum(${billableEnergy}) FILTER (WHERE cost IS NULL),0) AS "missingCostEnergy",
  count(*) FILTER (WHERE cost IS NULL AND (${billableEnergy}) IS NOT NULL) AS "estimableCosts"
  FROM charging_processes WHERE car_id=$1 AND start_date >= $2 AND end_date IS NOT NULL`;
export const dailySql = `SELECT to_char((start_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,
  sum(distance) AS distance FROM drives WHERE car_id=$1 AND start_date >= $2
  AND end_date IS NOT NULL AND distance > 0 GROUP BY 1 ORDER BY 1`;
export const positionSql = `SELECT date, battery_level AS battery, rated_battery_range_km AS range,
  odometer, inside_temp AS "insideTemp", outside_temp AS "outsideTemp"
  FROM positions WHERE car_id=$1 ORDER BY date DESC LIMIT 1`;
// Find each field's last valid sample independently. JSON access also supports
// older TeslaMate schemas without TPMS columns, without changing their schema.
const wheels = ['fl', 'fr', 'rl', 'rr'];
export const telemetrySql = `SELECT loc.latitude, loc.longitude, loc.date AT TIME ZONE 'UTC' AS "locationDate",
  ${wheels.map((wheel) => `${wheel}.value AS tpms_pressure_${wheel}, ${wheel}.date AT TIME ZONE 'UTC' AS tpms_pressure_${wheel}_date`).join(', ')}
  FROM (SELECT 1) anchor
  LEFT JOIN LATERAL (
    SELECT latitude, longitude, date FROM positions WHERE car_id=$1
    AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    ORDER BY date DESC, id DESC LIMIT 1
  ) loc ON true
  ${wheels
    .map(
      (wheel) => `LEFT JOIN LATERAL (
    SELECT (to_jsonb(p)->>'tpms_pressure_${wheel}')::numeric AS value, p.date
    FROM positions p WHERE p.car_id=$1
    AND (to_jsonb(p)->>'tpms_pressure_${wheel}')::numeric BETWEEN 0 AND 10
    ORDER BY p.date DESC, p.id DESC LIMIT 1
  ) ${wheel} ON true`,
    )
    .join('\n')}`;
export const latestChargeSql = `SELECT ch.date, ch.battery_level AS battery, ch.rated_battery_range_km AS range
  FROM charging_processes cp JOIN LATERAL
  (SELECT date,battery_level,rated_battery_range_km FROM charges WHERE charging_process_id=cp.id ORDER BY date DESC LIMIT 1) ch ON true
  WHERE cp.id=(SELECT id FROM charging_processes WHERE car_id=$1 ORDER BY start_date DESC LIMIT 1)`;
export const stateSql = `SELECT state::text, start_date AS date FROM states WHERE car_id=$1 ORDER BY start_date DESC LIMIT 1`;
export const batterySql = `SELECT to_char((start_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,
  avg(end_rated_range_km * 100.0 / nullif(end_battery_level,0)) AS range
  FROM charging_processes WHERE car_id=$1 AND start_date >= $2 AND end_date IS NOT NULL
  AND end_battery_level >= 50 AND end_rated_range_km > 0 GROUP BY 1 ORDER BY 1`;
export const trackSql = `WITH track AS (
  SELECT p.latitude, p.longitude, p.speed, p.battery_level AS battery, p.date,
    row_number() OVER (ORDER BY p.date,p.id) AS n, count(*) OVER () AS total
  FROM positions p JOIN drives d ON d.id=p.drive_id
  WHERE d.car_id=$1 AND d.id=$2 AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
) SELECT latitude,longitude,speed,battery,date FROM track
  WHERE n=1 OR n=total OR mod(n, greatest(1,ceil(total / 2500.0)::bigint))=0 ORDER BY n`;
export const curveSql = `WITH curve AS (
  SELECT ch.date,ch.charger_power AS power,ch.battery_level AS battery,
    row_number() OVER (ORDER BY ch.date,ch.id) AS n, count(*) OVER () AS total
  FROM charges ch JOIN charging_processes cp ON cp.id=ch.charging_process_id WHERE cp.car_id=$1 AND cp.id=$2
) SELECT date,power,battery FROM curve
  WHERE n=1 OR n=total OR mod(n,greatest(1,ceil(total / 1000.0)::bigint))=0 ORDER BY n`;
