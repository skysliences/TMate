import { createHash, timingSafeEqual } from 'node:crypto';
import { addressLabel } from './address-label.mjs';
export function authorized(header, key) {
  if (!key || typeof header !== 'string' || header.length > 1024) return false;
  return timingSafeEqual(
    createHash('sha256').update(header).digest(),
    createHash('sha256').update(`Bearer ${key}`).digest(),
  );
}
export function positiveInt(value, max = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9]\d*$/.test(String(value)))
    throw Object.assign(new Error('参数格式无效'), { status: 400 });
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max)
    throw Object.assign(new Error('参数超出范围'), { status: 400 });
  return n;
}
export function getPeriod(days = '30', now = new Date()) {
  const n = positiveInt(days, 90);
  if (![7, 30, 90].includes(n))
    throw Object.assign(new Error('时间范围仅支持 7、30 或 90 天'), {
      status: 400,
    });
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  return {
    days: n,
    since: new Date(
      new Date(`${today}T00:00:00+08:00`).getTime() - (n - 1) * 86400000,
    ),
    now,
  };
}
export function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function normalizeRecord(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      ['start', 'end', 'location'].includes(key)
        ? addressLabel(value)
        : [
              'id',
              'distance',
              'duration',
              'energy',
              'speedMax',
              'used',
              'cost',
              'startBattery',
              'endBattery',
              'range',
              'battery',
              'odometer',
              'insideTemp',
              'outsideTemp',
              'driveCount',
              'chargeCount',
              'missingCosts',
              'missingCostEnergy',
              'estimableCosts',
              'consumption',
              'latitude',
              'longitude',
              'speed',
              'power',
            ].includes(key)
          ? numberOrNull(value)
          : value,
    ]),
  );
}
function telemetryNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return numberOrNull(value);
}
export function coordinatesOrNull(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const latitude = telemetryNumber(value.latitude);
  const longitude = telemetryNumber(value.longitude);
  return latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null;
}
export function pressureOrNull(value) {
  const pressure = telemetryNumber(value);
  return pressure !== null && pressure >= 0 && pressure <= 10 ? pressure : null;
}
function recordedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function mergeStatus(
  position = {},
  charge = {},
  state = {},
  live = null,
  telemetry = {},
  software = {},
) {
  const latest =
    new Date(charge.date ?? 0) > new Date(position.date ?? 0)
      ? charge
      : position;
  const coordinates = coordinatesOrNull(telemetry);
  const wheels = ['fl', 'fr', 'rl', 'rr'];
  const tires = wheels.map((wheel) =>
    pressureOrNull(telemetry[`tpms_pressure_${wheel}`]),
  );
  const status = {
    battery: numberOrNull(latest.battery),
    range: numberOrNull(latest.range),
    odometer: numberOrNull(position.odometer),
    insideTemp: numberOrNull(position.insideTemp),
    outsideTemp: numberOrNull(position.outsideTemp),
    location: null,
    coordinates,
    locationSource: coordinates ? 'database' : null,
    locationRecordedAt: coordinates ? recordedAt(telemetry.locationDate) : null,
    state: state.state ?? 'unknown',
    updatedAt: latest.date ?? null,
    locked: null,
    sentry: null,
    version: software.version || null,
    versionSource: software.version ? 'database' : null,
    versionRecordedAt: software.version ? recordedAt(software.recordedAt) : null,
    versionReceivedAt: null,
    versionUnavailable: software.unavailable || null,
    sentrySource: null,
    sentryReceivedAt: null,
    tires,
    tireSources: tires.map((value) => (value === null ? null : 'database')),
    tiresRecordedAt: wheels.map((wheel, i) =>
      tires[i] === null
        ? null
        : recordedAt(telemetry[`tpms_pressure_${wheel}_date`]),
    ),
    live: false,
  };
  // These two fields have different fallbacks: installed updates in PostgreSQL,
  // and a bounded cache of MQTT receipts. Receipt time is not measurement time.
  const cached = live?.status || {};
  const liveVersion = live?.connected && typeof live.values?.version === 'string' ? live.values.version : null;
  const version = liveVersion || (!status.version ? cached.version?.value : null);
  if (version) {
    status.version = version;
    status.versionSource = liveVersion ? 'mqtt' : 'cache';
    status.versionRecordedAt = null;
    status.versionReceivedAt = recordedAt(cached.version?.receivedAt);
    status.versionUnavailable = null;
  }
  const sentry = live?.connected && typeof live.values?.sentry_mode === 'boolean'
    ? live.values.sentry_mode : cached.sentry_mode?.value;
  if (typeof sentry === 'boolean') {
    status.sentry = sentry;
    status.sentrySource = live?.connected && typeof live.values?.sentry_mode === 'boolean' ? 'mqtt' : 'cache';
    status.sentryReceivedAt = recordedAt(cached.sentry_mode?.receivedAt);
  }
  if (!live?.connected) return status;
  const values = live.values || {};
  const scalar = {
    battery: 'battery_level',
    range: 'rated_battery_range_km',
    odometer: 'odometer',
    insideTemp: 'inside_temp',
    outsideTemp: 'outside_temp',
  };
  for (const [field, topic] of Object.entries(scalar)) {
    if (values[topic] !== undefined && values[topic] !== null)
      status[field] = numberOrNull(values[topic]);
  }
  for (const [field, topic] of Object.entries({
    state: 'state',
    locked: 'locked',
  })) {
    if (values[topic] !== undefined && values[topic] !== null)
      status[field] = values[topic];
  }
  const mqttCoordinates =
    coordinatesOrNull(values.location) || coordinatesOrNull(values);
  const geofence =
    typeof values.geofence === 'string' &&
    values.geofence.trim() &&
    !['nil', 'null'].includes(values.geofence.trim())
      ? values.geofence.trim()
      : null;
  if (mqttCoordinates || geofence) {
    status.coordinates = mqttCoordinates;
    status.location = geofence;
    status.locationSource = 'mqtt';
    status.locationRecordedAt = null; // Receipt time and state `since` are not measurement times.
  }
  wheels.forEach((wheel, i) => {
    const pressure = pressureOrNull(values[`tpms_pressure_${wheel}`]);
    if (pressure === null) return; // Missing/invalid MQTT values must not erase database values.
    status.tires[i] = pressure;
    status.tireSources[i] = 'mqtt';
    status.tiresRecordedAt[i] = null;
  });
  // Retained MQTT messages have no original observation time. Never call their receipt a fresh vehicle update.
  status.live = live.connected;
  return status;
}
