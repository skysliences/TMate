// Read-only. Run with: docker compose exec -T voltlog node --input-type=module < deploy/diagnose-telemetry.mjs
// Never output actual coordinates, vehicle names, telemetry values or credentials.
import pg from 'pg';
import mqtt from 'mqtt';
const report = {
  checkedAt: new Date().toISOString(),
  vehicles: [],
  mqtt: {
    configured: !!process.env.MQTT_URL,
    connected: false,
    subscriptions: [],
    topics: [],
  },
};
const headers = { Authorization: `Bearer ${process.env.API_KEY}` };
const response = await fetch('http://127.0.0.1:8787/api/cars', {
  headers,
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`Vehicle list HTTP ${response.status}`);
const { cars } = await response.json();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 15000,
  connectionTimeoutMillis: 10000,
});
try {
  const { rows: columns } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='positions' AND (column_name LIKE 'tpms%' OR column_name IN ('latitude','longitude')) ORDER BY column_name",
  );
  report.positionColumns = columns.map((row) => row.column_name);
  const tires = ['fl', 'fr', 'rl', 'rr']
    .map((suffix) => 'tpms_pressure_' + suffix)
    .filter((name) => report.positionColumns.includes(name));
  for (const car of cars) {
    const result = await fetch(
      `http://127.0.0.1:8787/api/cars/${car.id}/dashboard?days=30`,
      { headers, signal: AbortSignal.timeout(20000) },
    );
    if (!result.ok) throw new Error(`Dashboard HTTP ${result.status}`);
    const { status } = await result.json();
    const fields = tires.map((name) => `${name} IS NOT NULL AS ${name}`);
    const { rows } = await pool.query(
      `SELECT date, latitude IS NOT NULL AND longitude IS NOT NULL AS has_coordinates ${fields.length ? ', ' + fields.join(', ') : ''} FROM positions WHERE car_id=$1 ORDER BY date DESC LIMIT 1`,
      [car.id],
    );
    report.vehicles.push({
      id: car.id,
      api: {
        live: status.live,
        hasLocation: !!(status.coordinates || status.location),
        locationSource: status.locationSource,
        locationTimeAvailable: !!status.locationRecordedAt,
        tiresAvailable: status.tires.filter((value) => value !== null).length,
        tireSources: status.tireSources,
        tireTimesAvailable: status.tiresRecordedAt?.filter(Boolean).length,
      },
      latestDatabaseSample: rows[0] || null,
    });
  }
} finally {
  await pool.end();
}
if (process.env.MQTT_URL) {
  const prefix = process.env.MQTT_PREFIX || 'teslamate';
  const client = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 0,
    connectTimeout: 8000,
    clean: true,
  });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 15000);
    client.on('connect', () => {
      report.mqtt.connected = true;
      client.subscribe(
        [`${prefix}/cars/+/+`, 'teslamate/+/cars/+/+'],
        (error, grants) => {
          report.mqtt.subscriptions = error
            ? ['failed']
            : grants.map((grant) => ({ pattern: grant.topic, qos: grant.qos }));
        },
      );
    });
    const seen = new Set();
    client.on('message', (topic, _payload, packet) => {
      // Only retain field names and namespace-match flags, not their values.
      const field = topic.split('/').at(-1);
      if (!/^[a-z_]+$/.test(field) || seen.has(topic) || seen.size >= 250)
        return;
      seen.add(topic);
      report.mqtt.topics.push({
        field,
        configuredPrefix: topic.startsWith(`${prefix}/cars/`),
        retained: packet.retain,
      });
    });
    client.on('error', () => {
      report.mqtt.error = 'connection-error';
      clearTimeout(timer);
      resolve();
    });
  });
  await client.endAsync(true);
}
console.log(JSON.stringify(report));
