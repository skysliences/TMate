import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  authorized,
  positiveInt,
  getPeriod,
  normalizeRecord,
  mergeStatus,
} from './domain.mjs';
import { connectMqtt } from './mqtt.mjs';
import { createSessions } from './sessions.mjs';
import * as sql from './queries.mjs';
import { createMapService } from './maps.mjs';
import { validateConfig } from './config.mjs';
import { readSoftware } from './software.mjs';
import { readDriveDetail } from './drive-detail.mjs';
import appPackage from '../package.json' with { type: 'json' };

// TeslaMate timestamps are UTC timestamp-without-time-zone. Avoid server locale shifts.
pg.types.setTypeParser(
  1114,
  (value) => new Date(value.replace(' ', 'T') + 'Z'),
);
export function createApp({
  pool,
  live = { get: () => null },
  key,
  origins = [],
  webOrigin = '',
  publicDir = resolve('www'),
  maps = null,
}) {
  const buckets = new Map();
  const sessions = createSessions({ key, webOrigin });
  const query = async (text, args = []) => {
    const rows = (await pool.query(text, args)).rows;
    return (maps ? await maps.enrich(rows) : rows).map(normalizeRecord);
  };
  const json = (res, status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && origins.includes(origin) ? 204 : 403);
      res.end();
      return;
    }
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      json(res, 400, { error: '请求地址无效' });
      return;
    }
    const path = url.pathname;
    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: '只支持读取' });
        return;
      }
      try {
        const pathname = decodeURIComponent(path);
        const file = resolve(
          publicDir,
          `.${pathname === '/' ? '/index.html' : pathname}`,
        );
        if (
          !file.startsWith(resolve(publicDir) + sep) ||
          !(await stat(file)).isFile()
        ) {
          json(res, 404, { error: '页面不存在' });
          return;
        }
        const mime = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
          '.webmanifest': 'application/manifest+json',
        };
        res.writeHead(200, {
          'Content-Type': mime[extname(file)] || 'application/octet-stream',
          'Cache-Control':
            extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
        });
        res.end(req.method === 'HEAD' ? undefined : await readFile(file));
      } catch {
        json(res, 404, { error: '页面不存在，请先构建网页' });
      }
      return;
    }
    if (path === '/api/health' && req.method === 'GET') {
      json(res, 200, { service: 'voltlog', appName: 'TMate', version: appPackage.version });
      return;
    }
    const now = Date.now();
    const ip = req.socket.remoteAddress || 'local';
    if (buckets.size > 10000) buckets.clear();
    const bucket = buckets.get(ip);
    const hits =
      bucket && now - bucket.start < 60000
        ? { ...bucket, count: bucket.count + 1 }
        : { start: now, count: 1 };
    buckets.set(ip, hits);
    if (hits.count > 180) {
      res.setHeader('Retry-After', '60');
      json(res, 429, { error: '请求过于频繁，请稍后重试' });
      return;
    }
    if (await sessions.handle(req, res, path, json)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: '车辆数据仅支持读取' });
      return;
    }
    if (!authorized(req.headers.authorization, key) && !sessions.valid(req)) {
      json(res, 401, { error: '访问密钥无效或已过期' });
      return;
    }
    try {
      if (path === '/api/cars') {
        json(res, 200, { cars: await query(sql.carsSql) });
        return;
      }
      const match = path.match(
        /^\/api\/cars\/(\d+)\/(dashboard|drives|charges)(?:\/(\d+)\/(track|curve|map|detail))?$/,
      );
      if (!match) {
        json(res, 404, { error: '接口不存在' });
        return;
      }
      const id = positiveInt(match[1]);
      const mode = match[2];
      const car = (await query(sql.carsSql)).find((c) => c.id === id);
      if (!car) {
        json(res, 404, { error: '车辆不存在' });
        return;
      }
      if (match[3]) {
        const recordId = positiveInt(match[3]);
        const kind = match[4];
        if (
          (mode === 'drives' && !['track', 'map', 'detail'].includes(kind)) ||
          (mode === 'charges' && kind !== 'curve') ||
          mode === 'dashboard'
        ) {
          json(res, 404, { error: '接口不存在' });
          return;
        }
        if (kind === 'detail') {
          const detail = await readDriveDetail(pool, id, recordId);
          json(res, detail ? 200 : 404, detail || { error: '行程不存在或尚未结束' });
          return;
        }
        const points = await query(
          kind === 'curve' ? sql.curveSql : sql.trackSql,
          [id, recordId],
        );
        if (kind === 'map') {
          if (!points.length) {
            json(res, 404, { error: '这段行程没有定位记录' });
            return;
          }
          const focus = url.searchParams.get('focus') || 'route';
          const zoom = url.searchParams.get('zoom') || '0';
          if (
            !['route', 'start', 'end'].includes(focus) ||
            !/^(?:-2|-1|[0-4])$/.test(zoom)
          ) {
            json(res, 400, { error: '地图参数无效' });
            return;
          }
          if (!maps?.enabled) {
            json(res, 503, { error: '尚未配置高德 Web 服务 Key' });
            return;
          }
          json(res, 200, await maps.map(points, focus, Number(zoom)));
          return;
        }
        json(res, 200, { points });
        return;
      }
      const period = getPeriod(url.searchParams.get('days') || '30');
      const args = [id, period.since.toISOString()];
      if (mode !== 'dashboard') {
        const offsetString = url.searchParams.get('offset') || '0';
        const offset =
          offsetString === '0' ? 0 : positiveInt(offsetString, 1000000);
        const limit = positiveInt(url.searchParams.get('limit') || '50', 100);
        const rows = await query(
          mode === 'drives' ? sql.drivesSql : sql.chargesSql,
          [...args, limit + 1, offset],
        );
        json(res, 200, {
          items: rows.slice(0, limit),
          hasMore: rows.length > limit,
          nextOffset: offset + Math.min(rows.length, limit),
        });
        return;
      }
      const [
        drives,
        charges,
        driveTotals,
        chargeTotals,
        daily,
        position,
        charge,
        state,
        battery,
        telemetry,
        software,
      ] = await Promise.all([
        query(sql.drivesSql, [...args, 50, 0]),
        query(sql.chargesSql, [...args, 50, 0]),
        query(sql.driveTotalsSql, args),
        query(sql.chargeTotalsSql, args),
        query(sql.dailySql, args),
        query(sql.positionSql, [id]),
        query(sql.latestChargeSql, [id]),
        query(sql.stateSql, [id]),
        query(sql.batterySql, args),
        query(sql.telemetrySql, [id]),
        readSoftware(pool, id),
      ]);
      const totals = { ...driveTotals[0], ...chargeTotals[0] };
      json(res, 200, {
        car,
        asOf: period.now.toISOString(),
        status: mergeStatus(
          position[0],
          charge[0],
          state[0],
          live.get(id),
          telemetry[0],
          software,
        ),
        drives,
        charges,
        totals,
        daily,
        battery,
        truncated: totals.driveCount > 50 || totals.chargeCount > 50,
      });
    } catch (error) {
      const status = error.status || 503;
      if (status >= 500)
        console.error('Data request failed:', error.code || error.name);
      json(res, status, {
        error:
          status === 400
            ? error.message
            : error.publicMessage || '暂时无法读取车辆数据，请检查数据服务连接',
      });
    }
  });
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  validateConfig(process.env);
  const key = process.env.API_KEY;
  if (
    !key ||
    key.length < 32 ||
    key.includes('REPLACE_WITH') ||
    key.includes('CHANGE_ME')
  )
    throw new Error('API_KEY must contain at least 32 characters');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    options: '-c default_transaction_read_only=on -c timezone=UTC',
  });
  pool.on('error', () => console.error('Database connection unavailable'));
  const live = await connectMqtt();
  const maps = await createMapService({
    key: process.env.AMAP_KEY || '',
    cacheDir: process.env.MAP_CACHE_DIR || '',
  });
  const app = createApp({
    pool,
    live,
    maps,
    key,
    webOrigin: process.env.WEB_ORIGIN || '',
    origins: (
      process.env.ALLOWED_ORIGINS || 'capacitor://localhost,https://localhost'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicDir: resolve(process.env.PUBLIC_DIR || 'www'),
  });
  const port = Number(process.env.PORT || 8787);
  app.requestTimeout = 20000;
  app.headersTimeout = 10000;
  app.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`TMate read-only service listening on port ${port}`),
  );
  const stop = () => {
    app.close();
    void Promise.all([pool.end(), live.close(), maps.close()]).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
