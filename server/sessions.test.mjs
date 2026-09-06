import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from './index.mjs';
import { createSessions } from './sessions.mjs';
const key = 'b'.repeat(48);
const origin = 'http://192.168.50.20:8787';
let app, base;
before(async () => {
  app = createApp({
    key,
    webOrigin: origin,
    origins: [origin],
    pool: {
      query: async () => ({
        rows: [{ id: 1, name: '测试车辆', model: '3', trim: '' }],
      }),
    },
  });
  await new Promise((done) => app.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => {
  await new Promise((done) => app.close(done));
});
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

void test('one-use device pairing restores real API access without disclosing the service key', async () => {
  assert.equal(
    (await (await fetch(base + '/api/session')).json()).authenticated,
    false,
  );
  assert.equal((await fetch(base + '/api/cars')).status, 401);
  assert.equal((await post('/api/pairings', {})).status, 401);
  const issued = await post(
    '/api/pairings',
    {},
    { Authorization: `Bearer ${key}` },
  );
  assert.equal(issued.status, 201);
  const { url } = await issued.json();
  assert.ok(url.startsWith(origin + '/#pair='));
  assert.ok(!url.includes(key));
  const pairingToken = new URLSearchParams(new URL(url).hash.slice(1)).get(
    'pair',
  );
  const response = await post('/api/session', { pairingToken });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.ok(!setCookie.includes(key));
  const cookie = setCookie.split(';')[0];
  const headers = { Cookie: cookie, Origin: origin };
  assert.equal((await fetch(base + '/api/cars', { headers })).status, 200);
  assert.equal(
    (await (await fetch(base + '/api/session', { headers })).json())
      .authenticated,
    true,
  );
  assert.equal((await post('/api/session', { pairingToken })).status, 401);
  const restarted = createSessions({ key, webOrigin: origin });
  assert.equal(restarted.valid({ headers: { cookie } }), true);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
  assert.equal(
    (await fetch(base + '/api/cars', { headers: { Cookie: tampered } })).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + '/api/cars', {
        headers: { ...headers, Origin: 'https://unrelated.example' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + '/api/cars', {
        headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(base + '/api/cars', { method: 'POST', headers })).status,
    405,
  );
  const logout = await fetch(base + '/api/session', {
    method: 'DELETE',
    headers,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

void test('session creation rejects cross-origin, missing origin, malformed bodies, and unauthorized secrets', async () => {
  const auth = { Authorization: `Bearer ${key}` };
  assert.equal(
    (
      await post(
        '/api/session',
        {},
        { ...auth, Origin: 'http://192.168.50.20:4000' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + '/api/session', { method: 'POST', headers: auth }))
      .status,
    403,
  );
  assert.equal((await post('/api/session', {})).status, 401);
  assert.equal(
    (
      await fetch(base + '/api/session', {
        method: 'POST',
        headers: { ...auth, Origin: origin, 'Content-Type': 'text/plain' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal((await post('/api/session', [], auth)).status, 400);
  assert.equal((await post('/api/session', {}, auth)).status, 200);
  assert.equal(
    (
      await post(
        '/api/pairings',
        {},
        { ...auth, Origin: 'https://unrelated.example' },
      )
    ).status,
    403,
  );
});

void test('pairings expire; sessions are bound to origin/key and HTTPS cookies are secure', async () => {
  let clock = Date.now();
  const webOrigin = 'https://car.example.com';
  const sessions = createSessions({ key, webOrigin, now: () => clock });
  async function call(path, body, useKey = false) {
    const req = Readable.from([JSON.stringify(body)]);
    req.method = 'POST';
    req.headers = {
      origin: webOrigin,
      'content-type': 'application/json',
      ...(useKey ? { authorization: `Bearer ${key}` } : {}),
    };
    const result = { headers: {} };
    await sessions.handle(
      req,
      {
        setHeader: (name, value) => {
          result.headers[name] = value;
        },
      },
      path,
      (_res, status, data) => Object.assign(result, { status, data }),
    );
    return result;
  }
  const issued = await call('/api/pairings', {}, true);
  const pairingToken = new URLSearchParams(
    new URL(issued.data.url).hash.slice(1),
  ).get('pair');
  clock += 16 * 60000;
  assert.equal((await call('/api/session', { pairingToken })).status, 401);
  const session = await call('/api/session', {}, true);
  assert.match(session.headers['Set-Cookie'], /; Secure/);
  const cookie = session.headers['Set-Cookie'].split(';')[0];
  assert.equal(sessions.valid({ headers: { cookie } }), true);
  assert.equal(
    createSessions({ key, webOrigin: origin, now: () => clock }).valid({
      headers: { cookie },
    }),
    false,
  );
  assert.equal(
    createSessions({ key: 'c'.repeat(48), webOrigin, now: () => clock }).valid({
      headers: { cookie },
    }),
    false,
  );
  clock += 31 * 86400000;
  assert.equal(sessions.valid({ headers: { cookie } }), false);
});
