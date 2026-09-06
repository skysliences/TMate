// Run inside VoltLog: node --input-type=module < deploy/verify-https.mjs
// Connect through Docker DNS, but validate the real hostname and public CA chain.
// Logs only statuses/counts. Never log tokens, cookies, keys or precise locations.
import assert from 'node:assert/strict';
import https from 'node:https';
const origin = new URL(process.env.WEB_ORIGIN);
assert.equal(origin.protocol, 'https:');
assert.ok(process.env.API_KEY);
const authority = origin.host;
const originHeaders = { Origin: origin.origin, 'Content-Type': 'application/json' };
const bearer = { Authorization: `Bearer ${process.env.API_KEY}` };
function request(path, { method = 'GET', headers = {}, body, minVersion, maxVersion } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'https', port: 8443, servername: origin.hostname,
      method, path, minVersion, maxVersion,
      headers: { Host: authority, ...headers }, timeout: 30000,
    }, res => {
      const chunks = [];
      let size = 0;
      const protocol = res.socket.getProtocol();
      const authorized = res.socket.authorized;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) req.destroy(new Error('Unexpected large response'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, bytes, protocol, authorized, json: () => JSON.parse(bytes.toString()) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
for (const version of ['TLSv1.2', 'TLSv1.3']) {
  const result = await request('/api/health', { minVersion: version, maxVersion: version });
  assert.equal(result.status, 200);
  assert.equal(result.protocol, version);
  assert.ok(result.authorized, 'Certificate and hostname must be trusted without bypass');
}
assert.equal((await request('/')).status, 200);
for (const path of ['/.env', '/tls/key.pem', '/tls/cert.pem', '/deploy/nginx.https.conf']) {
  assert.equal((await request(path)).status, 404, `Private file not exposed: ${path}`);
}
assert.equal((await request('/api/cars')).status, 401);
assert.equal((await request('/api/cars', { headers: { ...bearer, Host: 'unrelated.example' } })).status, 421);
for (const nativeOrigin of ['https://localhost', 'capacitor://localhost']) {
  const preflight = await request('/api/cars', { method: 'OPTIONS', headers: {
    Origin: nativeOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], nativeOrigin);
  assert.equal((await request('/api/cars', { headers: { ...bearer, Origin: nativeOrigin } })).status, 200);
}
const paired = await request('/api/pairings', { method: 'POST', headers: { ...originHeaders, ...bearer } });
assert.equal(paired.status, 201);
const url = new URL(paired.json().url);
assert.equal(url.origin, origin.origin);
const pairingToken = new URLSearchParams(url.hash.slice(1)).get('pair');
const exchange = () => request('/api/session', { method: 'POST', headers: originHeaders, body: JSON.stringify({ pairingToken }) });
const session = await exchange();
assert.equal(session.status, 200);
const setCookie = session.headers['set-cookie']?.[0];
assert.ok(setCookie && /; Secure(?:;|$)/.test(setCookie));
assert.ok(setCookie.includes('; HttpOnly') && setCookie.includes('; SameSite=Strict'));
assert.equal((await exchange()).status, 401);
const deviceHeaders = { ...originHeaders, Cookie: setCookie.split(';')[0] };
assert.ok((await request('/api/session', { headers: deviceHeaders })).json().authenticated);
const cars = await request('/api/cars', { headers: deviceHeaders });
assert.equal(cars.status, 200);
assert.equal((await request('/api/cars', { headers: { ...deviceHeaders, Origin: 'https://unrelated.example' } })).status, 401);
let maps = 0;
for (const car of cars.json().cars) {
  const dashboard = await request(`/api/cars/${car.id}/dashboard?days=30`, { headers: deviceHeaders });
  assert.equal(dashboard.status, 200);
  const drive = dashboard.json().drives[0];
  if (drive && process.env.AMAP_KEY) {
    const response = await request(`/api/cars/${car.id}/drives/${drive.id}/map?focus=route&zoom=0`, { headers: deviceHeaders });
    assert.equal(response.status, 200);
    assert.ok(/^data:image\/(png|jpeg);base64,/.test(response.json().image));
    assert.ok(!response.bytes.includes(Buffer.from(process.env.AMAP_KEY)));
    maps++;
  }
}
const logout = await request('/api/session', { method: 'DELETE', headers: deviceHeaders });
assert.equal(logout.status, 200);
assert.ok(logout.headers['set-cookie']?.[0].includes('Max-Age=0'));
console.log(JSON.stringify({ https: 'passed', hostname: origin.hostname, publicCaTrusted: true, tls12: true, tls13: true, secureCookie: true, oneTimePairing: true, unauthenticatedDenied: true, crossSiteDenied: true, nativeCors: true, cars: cars.json().cars.length, maps }, null, 2));
