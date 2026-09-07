import {
  readFile,
  writeFile,
  rename,
  mkdir,
  stat,
  chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { coordinatesOrNull } from './domain.mjs';
import { addressLabel } from './address-label.mjs';
import { mapCoordinate, mapFrame } from './map-geometry.mjs';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const han = (value) => /\p{Script=Han}/u.test(text(value));
const unique = (values) =>
  [...new Set(values.map(text).filter(Boolean))].join('');
export function detailedAddress(raw) {
  const component = raw?.addressComponent || {};
  const street = text(component.streetNumber?.street);
  const formatted = text(raw?.formatted_address);
  if (street && han(street)) {
    const prefix = unique([
      component.province,
      component.city,
      component.district,
      component.township,
    ]);
    const number = text(component.streetNumber?.number);
    return {
      label: formatted.includes(street)
        ? formatted
        : `${prefix}${street}${number}`,
      road: street,
      precision: 'street',
      source: 'amap',
    };
  }
  const nearest = (Array.isArray(raw?.roads) ? raw.roads : [])
    .filter(
      (r) =>
        han(r.name) &&
        text(String(r.distance)) &&
        (typeof r.distance === 'number' || typeof r.distance === 'string') &&
        Number.isFinite(Number(r.distance)) &&
        Number(r.distance) >= 0 &&
        Number(r.distance) <= 1000,
    )
    .sort((a, b) => Number(a.distance) - Number(b.distance))[0];
  if (nearest) {
    const prefix = unique([
      component.province,
      component.city,
      component.district,
      component.township,
    ]);
    const road = text(nearest.name),
      distance = Math.round(Number(nearest.distance));
    return {
      label: `${prefix}${road}（距道路约 ${distance} 米）`,
      road,
      precision: 'nearest-road',
      source: 'amap',
    };
  }
  return {
    label: formatted,
    road: null,
    precision: 'locality',
    source: 'amap',
  };
}
function mapError(code = 'UNAVAILABLE') {
  return Object.assign(new Error('地图服务暂时不可用'), {
    status: 502,
    code: `AMAP_${/^\d{5,6}$/.test(code) ? code : 'UNAVAILABLE'}`,
    publicMessage:
      '地图暂时加载失败，请稍后重试；若持续失败，请检查高德 Key 的权限或配额。',
  });
}
async function boundedBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw mapError();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw mapError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
export async function createMapService({
  key = '',
  cacheDir = '',
  fetcher = fetch,
  delayMs = 400,
  budgetMs = 1800,
  requestIntervalMs = 1100,
} = {}) {
  const enabled = /^[a-f\d]{32}$/i.test(key);
  const cache = new Map(),
    pending = new Map(),
    images = new Map(),
    imagePending = new Map(),
    requestQueues = new Map();
  let queue = Promise.resolve(),
    writes = Promise.resolve(),
    closing = false,
    imageBytes = 0;
  const file = cacheDir ? join(cacheDir, 'amap-address-v1.json') : '';
  if (enabled && file) {
    try {
      if ((await stat(file)).size <= 8_000_000) {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        for (const [k, v] of Object.entries(saved).slice(-5000)) {
          if (
            v.expires > Date.now() &&
            v.result?.source === 'amap' &&
            typeof v.result.label === 'string'
          )
            cache.set(k, v);
        }
      }
    } catch {
      /* Empty or invalid cache never blocks vehicle records. */
    }
  }
  function persist() {
    if (!file) return;
    writes = writes
      .then(async () => {
        await mkdir(cacheDir, { recursive: true, mode: 0o700 });
        const saved = Object.fromEntries(
          [...cache].filter(
            ([, value]) => value.result && value.expires > Date.now(),
          ),
        );
        await writeFile(`${file}.tmp`, JSON.stringify(saved), { mode: 0o600 });
        // NAS filesystems may inherit permissions; also constrain reused temp files.
        await chmod(`${file}.tmp`, 0o600);
        await rename(`${file}.tmp`, file);
      })
      .catch(() => {
        /* Keep serving in-memory results if disk is unavailable. */
      });
  }
  async function requestOnce(path, params, image = false) {
    const url = new URL(`https://restapi.amap.com/v3/${path}`);
    url.search = new URLSearchParams({ ...params, key });
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const body = await boundedBody(response, image ? 2_000_000 : 1_000_000);
      if (!response.ok) throw mapError();
      const type = response.headers.get('content-type')?.split(';')[0];
      if (image && ['image/png', 'image/jpeg'].includes(type)) {
        const signature =
          type === 'image/png'
            ? body
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : body[0] === 255 && body[1] === 216;
        if (!signature) throw mapError();
        return { type, body };
      }
      const data = JSON.parse(body.toString('utf8'));
      if (image || data.status !== '1') throw mapError(data.infocode);
      return data;
    } catch (error) {
      throw error?.publicMessage ? error : mapError();
    }
  }
  function request(path, params, image = false) {
    // Respect even a 1-QPS account: each service has one queue, including retries.
    // Identical requests still share the existing address/image promises and cache.
    const previous = requestQueues.get(path) || Promise.resolve();
    const run = previous.then(async () => {
      if (closing) throw mapError();
      try {
        return await requestOnce(path, params, image);
      } catch (error) {
        if (!/^AMAP_100(?:14|15|19|20|21|22|23)$/.test(error.code) || closing)
          throw error;
        if (requestIntervalMs) await pause(requestIntervalMs);
        if (closing) throw mapError();
        return requestOnce(path, params, image);
      }
    });
    const settled = run
      .catch(() => {})
      .then(async () => {
        if (requestIntervalMs) await pause(requestIntervalMs);
      });
    requestQueues.set(path, settled);
    void settled.then(() => {
      if (requestQueues.get(path) === settled) requestQueues.delete(path);
    });
    return run;
  }
  const cacheKey = (point) =>
    `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
  function cached(point) {
    const saved = cache.get(cacheKey(point));
    return saved?.expires > Date.now() ? saved : null;
  }
  function schedule(point) {
    const k = cacheKey(point);
    if (cached(point)) return Promise.resolve();
    if (pending.has(k)) return pending.get(k);
    if (pending.size >= 200 || closing) return Promise.resolve();
    const job = queue.then(async () => {
      if (closing) {
        pending.delete(k);
        return;
      }
      try {
        const converted = mapCoordinate(point);
        const data = await request('geocode/regeo', {
          location: cacheKey(converted),
          extensions: 'all',
          radius: '1000',
          roadlevel: '0',
          output: 'JSON',
        });
        const result = detailedAddress(data.regeocode);
        cache.set(k, { result, expires: Date.now() + 30 * 86400000 });
        if (cache.size > 5000) cache.delete(cache.keys().next().value);
        persist();
      } catch {
        cache.set(k, { result: null, expires: Date.now() + 300000 });
      } finally {
        pending.delete(k);
      }
      if (delayMs) await pause(delayMs);
    });
    pending.set(k, job);
    queue = job.catch(() => {});
    return job;
  }
  return {
    enabled,
    async enrich(rows) {
      if (!enabled) return rows;
      const jobs = [],
        fields = [];
      for (const row of rows)
        for (const field of ['start', 'end', 'location']) {
          const place = row[field];
          if (!place || typeof place !== 'object') continue;
          const point =
            coordinatesOrNull(place.point) || coordinatesOrNull(place.address);
          if (!point || Math.abs(point.latitude) > 85) continue;
          fields.push({ row, field, place, point });
          jobs.push(schedule(point));
        }
      if (jobs.length) {
        let timer;
        await Promise.race([
          Promise.all(jobs),
          new Promise((resolve) => {
            timer = setTimeout(resolve, budgetMs);
          }),
        ]);
        clearTimeout(timer);
      }
      for (const { row, field, place, point } of fields) {
        const result = cached(point)?.result;
        row[`${field}AddressInfo`] = result?.road
          ? result
          : { source: 'database', precision: 'unresolved', road: null };
        row[field] = result?.road
          ? text(place.geofence)
            ? `${text(place.geofence)} · ${result.label}`
            : result.label
          : addressLabel(place);
      }
      return rows;
    },
    async map(points, focus, delta) {
      if (!enabled)
        throw Object.assign(mapError(), {
          status: 503,
          publicMessage: '尚未配置高德 Web 服务 Key。',
        });
      const frame = mapFrame(points, focus, delta);
      if (!frame)
        throw Object.assign(mapError(), {
          status: 404,
          publicMessage: '这段行程没有有效定位记录。',
        });
      const k = `${cacheKey(frame.center)}:${frame.zoom}`;
      let entry = images.get(k);
      if (!entry) {
        if (imagePending.size >= 3 && !imagePending.has(k))
          throw Object.assign(mapError(), { status: 429 });
        if (!imagePending.has(k)) {
          const job = request(
            'staticmap',
            {
              location: cacheKey(frame.center),
              zoom: String(frame.zoom),
              size: `${frame.width}*${frame.height}`,
              scale: '1',
              traffic: '0',
            },
            true,
          )
            .then((result) => {
              while (
                imageBytes + result.body.length > 6_000_000 &&
                images.size
              ) {
                const first = images.keys().next().value;
                imageBytes -= images.get(first).body.length;
                images.delete(first);
              }
              images.set(k, result);
              imageBytes += result.body.length;
              return result;
            })
            .finally(() => imagePending.delete(k));
          imagePending.set(k, job);
        }
        entry = await imagePending.get(k);
      }
      return {
        ...frame,
        image: `data:${entry.type};base64,${entry.body.toString('base64')}`,
        source: '高德地图',
        coordinateSystem: 'GCJ-02',
      };
    },
    async idle() {
      await queue;
      await writes;
    },
    async close() {
      closing = true;
      await queue;
      await Promise.all(requestQueues.values());
      await writes;
    },
  };
}
