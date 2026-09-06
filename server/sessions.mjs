import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { authorized } from './domain.mjs';
const COOKIE = 'voltlog_device';
const DAYS = 30;
const MAX_AGE = DAYS * 86400;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw fail(415, '请求必须使用 JSON');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 2048) throw fail(413, '请求过大');
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw fail(400, '请求格式无效');
  }
}
// Personal NAS device authorization, not a public account/login system.
// The bearer key is never placed in browser storage or a cookie.
export function createSessions({ key, webOrigin = '', now = Date.now }) {
  const pairings = new Map();
  if (webOrigin) {
    const url = new URL(webOrigin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== webOrigin)
      throw new Error('WEB_ORIGIN must be an exact HTTP(S) origin');
  }
  const sign = (payload) =>
    createHmac('sha256', key)
      .update(`voltlog-device-v1\0${webOrigin}\0${payload}`)
      .digest('base64url');
  function sameSite(req) {
    return (
      !!webOrigin &&
      (!req.headers.origin || req.headers.origin === webOrigin) &&
      (!req.headers['sec-fetch-site'] ||
        ['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
    );
  }
  function valid(req) {
    if (!sameSite(req)) return false;
    const value = req.headers.cookie
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const match = value?.match(
      /^(\d{13})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/,
    );
    if (
      !match ||
      Number(match[1]) <= now() ||
      Number(match[1]) > now() + MAX_AGE * 1000
    )
      return false;
    return timingSafeEqual(
      Buffer.from(match[3]),
      Buffer.from(sign(`${match[1]}.${match[2]}`)),
    );
  }
  function cookie(value, maxAge = MAX_AGE) {
    return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${webOrigin.startsWith('https:') ? '; Secure' : ''}`;
  }
  return {
    valid,
    async handle(req, res, path, json) {
      if (!['/api/session', '/api/pairings'].includes(path)) return false;
      try {
        if (path === '/api/session' && req.method === 'GET') {
          json(res, 200, {
            service: 'voltlog',
            authenticated: valid(req),
            pairingEnabled: !!webOrigin,
            sessionDays: DAYS,
          });
          return true;
        }
        if (!webOrigin) throw fail(503, '此服务尚未开启设备配对');
        if (path === '/api/pairings') {
          if (req.method !== 'POST') throw fail(405, '只支持创建配对链接');
          if (!authorized(req.headers.authorization, key))
            throw fail(401, '需要服务访问密钥');
          if (!sameSite(req)) throw fail(403, '不允许跨站创建配对链接');
          for (const [token, expires] of pairings)
            if (expires <= now()) pairings.delete(token);
          if (pairings.size >= 100) throw fail(429, '配对请求过多，请稍后再试');
          const token = randomBytes(32).toString('base64url');
          const expiresAt = now() + 15 * 60000;
          pairings.set(hash(token), expiresAt);
          json(res, 201, {
            url: `${webOrigin}/#pair=${token}`,
            expiresAt: new Date(expiresAt).toISOString(),
          });
          return true;
        }
        if (req.headers.origin !== webOrigin || !sameSite(req))
          throw fail(403, '请在本服务网页中进行设备连接');
        if (req.method === 'DELETE') {
          res.setHeader('Set-Cookie', cookie('', 0));
          json(res, 200, { authenticated: false });
          return true;
        }
        if (req.method !== 'POST') throw fail(405, '不支持此请求');
        const body = await readBody(req);
        let permitted = authorized(req.headers.authorization, key);
        if (
          !permitted &&
          typeof body.pairingToken === 'string' &&
          /^[A-Za-z0-9_-]{43}$/.test(body.pairingToken)
        ) {
          const id = hash(body.pairingToken);
          const expires = pairings.get(id);
          permitted = !!expires && expires > now();
          pairings.delete(id); // Consume before issuing a session, including concurrent exchanges.
        }
        if (!permitted)
          throw fail(401, '配对链接已失效或密钥无效，请使用访问密钥连接');
        const expiresAt = now() + MAX_AGE * 1000;
        const payload = `${expiresAt}.${randomBytes(24).toString('base64url')}`;
        res.setHeader('Set-Cookie', cookie(`${payload}.${sign(payload)}`));
        json(res, 200, {
          authenticated: true,
          expiresAt: new Date(expiresAt).toISOString(),
        });
      } catch (error) {
        json(res, error.status || 400, {
          error: error.status ? error.message : '设备连接失败',
        });
      }
      return true;
    },
  };
}
