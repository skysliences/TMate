import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
export const CACHE_TTL = 30 * 86400000;
export function validStatusValue(key, value) {
  return key === 'sentry_mode' ? typeof value === 'boolean'
    : key === 'version' && typeof value === 'string' && /^[\w .+-]{1,100}$/.test(value) && !['nil', 'null'].includes(value);
}
export async function createStatusCache(directory, now = () => Date.now()) {
  const cars = new Map();
  const file = directory ? join(directory, 'vehicle-status.json') : null;
  let writing = Promise.resolve();
  let warned = false;
  const warn = () => { if (!warned) console.error('Vehicle status cache unavailable; keeping received values in memory only'); warned = true; };
  if (file) {
    try {
      const data = await readFile(file);
      if (data.length > 100000) throw new Error('cache-size');
      const parsed = JSON.parse(data.toString());
      for (const [id, fields] of Object.entries(parsed)) {
        if (!/^\d+$/.test(id) || cars.size >= 100 || !fields || typeof fields !== 'object') continue;
        const valid = {};
        for (const key of ['version', 'sentry_mode']) {
          const field = fields[key];
          if (field && validStatusValue(key, field.value) && Number.isFinite(field.receivedAt) && field.receivedAt <= now() && now() - field.receivedAt < CACHE_TTL) valid[key] = field;
        }
        if (Object.keys(valid).length) cars.set(id, valid);
      }
    } catch (error) { if (error.code !== 'ENOENT') warn(); }
  }
  return {
    get(id) {
      return Object.fromEntries(Object.entries(cars.get(String(id)) || {}).filter(([,field]) => now() - field.receivedAt < CACHE_TTL));
    },
    set(id, key, value) {
      id = String(id);
      if (!/^\d+$/.test(id) || !validStatusValue(key, value) || (!cars.has(id) && cars.size >= 100)) return;
      cars.set(id, { ...cars.get(id), [key]: { value, receivedAt: now() } });
      if (file) writing = writing.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(cars)), { mode: 0o600 });
        await chmod(`${file}.tmp`, 0o600);
        await rename(`${file}.tmp`, file);
      }).catch(warn);
    },
    flush: () => writing,
  };
}
