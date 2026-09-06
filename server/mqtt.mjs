import mqtt from 'mqtt';
import { coordinatesOrNull } from './domain.mjs';
import { createStatusCache, validStatusValue } from './mqtt-cache.mjs';
const allowed = new Set([
  'battery_level',
  'rated_battery_range_km',
  'odometer',
  'inside_temp',
  'outside_temp',
  'geofence',
  'location',
  'latitude',
  'longitude',
  'state',
  'since',
  'locked',
  'sentry_mode',
  'version',
  'tpms_pressure_fl',
  'tpms_pressure_fr',
  'tpms_pressure_rl',
  'tpms_pressure_rr',
]);
export function decodeMqttValue(key, payload) {
  const text = payload.toString('utf8');
  if (text === 'nil' || text === 'null' || text === '') return null;
  if (key === 'location') {
    try {
      return coordinatesOrNull(JSON.parse(text)) || undefined;
    } catch {
      return undefined;
    }
  }
  if (['locked', 'sentry_mode'].includes(key))
    return text === 'true' ? true : text === 'false' ? false : null;
  return text;
}
export async function connectMqtt(env = process.env) {
  const cache = new Map();
  const statusCache = await createStatusCache(env.MAP_CACHE_DIR || '');
  let connected = false;
  if (!env.MQTT_URL) return { get: id => ({ connected: false, status: statusCache.get(id) }), close: async () => {} };
  const prefix = env.MQTT_PREFIX || 'teslamate';
  const client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_USERNAME || undefined,
    password: env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
    subscribeBatchSize: 1,
  });
  client.on('connect', () => {
    client.subscribe(`${prefix}/cars/+/+`, { qos: 0 }, (error, grants) => {
      connected = !error && !!grants?.length && grants.every(grant => grant.qos !== 128);
    });
  });
  client.on('offline', () => {
    connected = false;
  });
  client.on('close', () => {
    connected = false;
  });
  client.on('error', () => {
    connected = false;
  });
  client.on('message', (topic, payload) => {
    if (payload.length > 1024 || !topic.startsWith(`${prefix}/cars/`)) return;
    const parts = topic.slice(`${prefix}/cars/`.length).split('/');
    const [id, key] = parts;
    if (parts.length !== 2 || !/^\d+$/.test(id) || !allowed.has(key)) return;
    if (!cache.has(id) && cache.size >= 100) return;
    const value = decodeMqttValue(key, payload);
    if (value === undefined) return;
    if (['version', 'sentry_mode'].includes(key)) {
      if (!validStatusValue(key, value)) return;
      statusCache.set(id, key, value);
    }
    const current = cache.get(id) || {};
    current[key] = value;
    cache.set(id, current);
  });
  return {
    get: (id) =>
      ({ values: cache.get(String(id)) || {}, connected: connected && cache.has(String(id)), status: statusCache.get(id) }),
    close: async () => { await client.endAsync(); await statusCache.flush(); },
  };
}
