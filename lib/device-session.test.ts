import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDevice } from './device-session.ts';
import { api } from './api.ts';

void test('NAS startup waits for authorization; a pairing link is scrubbed and uses cookies without an API key', async () => {
  const originalFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const location = {
    origin: 'http://192.168.50.20:8787',
    protocol: 'http:',
    hostname: '192.168.50.20',
    pathname: '/',
    search: '',
    hash: '',
  };
  let replaced = '';
  let paired = false;
  const calls: { url: string; options?: RequestInit }[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location,
      history: {
        replaceState: (_state: unknown, _title: string, url: string) => {
          replaced = url;
          location.hash = '';
        },
      },
    },
  });
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  globalThis.fetch = async (url, options) => {
    const address =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: address, options });
    if (address === '/api/session' && options?.method === 'POST') {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(new Headers(options.headers).has('Authorization'), false);
      assert.equal(
        JSON.parse(typeof options.body === 'string' ? options.body : '')
          .pairingToken,
        'x'.repeat(43),
      );
      paired = true;
      return json({ authenticated: true });
    }
    if (address === '/api/session')
      return json({
        service: 'voltlog',
        pairingEnabled: true,
        authenticated: paired,
      });
    assert.equal(address, location.origin + '/api/cars');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    return json({ cars: [{ id: 7, name: '真实车辆', model: '3', trim: '' }] });
  };
  try {
    const initial = await restoreDevice(new AbortController().signal);
    assert.equal(initial.local, true);
    assert.equal(initial.connection, undefined);
    assert.equal(initial.cars, undefined);
    location.hash = '#pair=' + 'x'.repeat(43);
    const connected = await restoreDevice(new AbortController().signal);
    assert.equal(replaced, '/');
    assert.equal(connected.connection?.auth, 'cookie');
    assert.equal(connected.connection?.key, '');
    assert.equal(connected.cars?.[0].id, 7);
    const restored = await restoreDevice(new AbortController().signal);
    assert.equal(restored.connection?.auth, 'cookie');
    assert.equal(
      calls.filter((call) => call.options?.method === 'POST').length,
      1,
    );
    await assert.rejects(
      () =>
        api(
          {
            base: 'https://unrelated.example',
            auth: 'cookie',
            key: '',
            session: 1,
          },
          '/cars',
        ),
      /当前网页/,
    );
    paired = false;
    globalThis.fetch = async () => json({ error: 'unavailable' }, 503);
    const offline = await restoreDevice(new AbortController().signal);
    assert.equal(offline.local, true);
    assert.equal(offline.connection, undefined);
    assert.ok(offline.error);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
