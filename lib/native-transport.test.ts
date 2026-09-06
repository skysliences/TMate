import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Capacitor } from '@capacitor/core';
import { ANDROID_NAS_ORIGIN as configuredOrigin, nativeJsonResponse as requestNative } from './native-transport.ts';
import { normalizeBase as normalize, api } from './api.ts';
import { restoreDevice } from './device-session.ts';
const ANDROID_NAS_ORIGIN = 'http://192.168.50.20:8787';
const normalizeBase = (input: string, pageOrigin: string, android: boolean) => normalize(input, pageOrigin, android, ANDROID_NAS_ORIGIN);
const nativeJsonResponse = (...args: Parameters<typeof requestNative>) => requestNative(args[0], args[1], args[2], args[3], ANDROID_NAS_ORIGIN);

void test('Android permits only the configured NAS HTTP origin, preserving browser/iOS restrictions', () => {
  assert.equal(
    normalizeBase(ANDROID_NAS_ORIGIN, 'https://localhost', true),
    ANDROID_NAS_ORIGIN,
  );
  for (const url of [
    'http://192.168.1.11:8787',
    'http://192.168.50.20:80',
    'http://192.168.50.20:8787/path',
    'http://example.com',
  ])
    assert.throws(() => normalizeBase(url, 'https://localhost', true));
  assert.throws(() =>
    normalizeBase(ANDROID_NAS_ORIGIN, 'https://localhost', false),
  );
  assert.throws(() =>
    normalizeBase(ANDROID_NAS_ORIGIN, 'capacitor://localhost', false),
  );
});

void test('native transport uses bounded GET requests, preserves errors and prevents credential redirects', async () => {
  const url = `${ANDROID_NAS_ORIGIN}/api/cars`;
  const signal = new AbortController().signal;
  const response = await nativeJsonResponse(
    url,
    { Authorization: 'Bearer test' },
    signal,
    async (options) => {
      assert.equal(options.disableRedirects, true);
      assert.equal(options.connectTimeout, 10000);
      assert.equal(options.readTimeout, 15000);
      assert.equal(options.headers?.Authorization, 'Bearer test');
      return { status: 401, data: { error: 'invalid' }, url, headers: {} };
    },
  );
  assert.equal(response.status, 401);
  await assert.rejects(
    nativeJsonResponse(`${ANDROID_NAS_ORIGIN}/other`, {}, signal),
    /仅允许/,
  );
  await assert.rejects(
    nativeJsonResponse('http://192.168.1.11:8787/api/cars', {}, signal),
    /仅允许/,
  );
  await assert.rejects(
    nativeJsonResponse(url, {}, signal, async () => ({
      status: 302,
      data: '',
      url,
      headers: {},
    })),
  );
  await assert.rejects(
    nativeJsonResponse(url, {}, signal, async () => ({
      status: 200,
      data: {},
      url: 'https://unrelated.example',
      headers: {},
    })),
  );
});

void test('cancelled native requests never deliver late data', async () => {
  const controller = new AbortController();
  const pending = nativeJsonResponse(
    `${ANDROID_NAS_ORIGIN}/api/cars`,
    {},
    controller.signal,
    () => new Promise(() => {}),
  );
  controller.abort();
  await assert.rejects(pending, (error: Error) => error.name === 'AbortError');
});

void test('packaged Android starts at authorization settings without probing its asset server or exposing demo vehicles', async () => {
  const native = Capacitor.isNativePlatform,
    platform = Capacitor.getPlatform;
  const fetcher = globalThis.fetch;
  try {
    Capacitor.isNativePlatform = () => true;
    Capacitor.getPlatform = () => 'android';
    globalThis.fetch = () => {
      throw new Error('Unexpected browser fetch');
    };
    const state = await restoreDevice(new AbortController().signal);
    assert.equal(state.local, true);
    assert.equal(state.connection, undefined);
    assert.equal(state.pairingEnabled, false);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      api(
        { base: ANDROID_NAS_ORIGIN, key: 'test', session: 1 },
        '/cars',
        controller.signal,
      ),
    );
  } finally {
    Capacitor.isNativePlatform = native;
    Capacitor.getPlatform = platform;
    globalThis.fetch = fetcher;
  }
});

void test('Android permits no general cleartext, insecure trust anchors, mixed content or embedded service keys', async () => {
  const xml = await readFile(
    new URL(
      '../android/app/src/main/res/xml/network_security_config.xml',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(xml, /base-config cleartextTrafficPermitted="false"/);
  assert.equal((xml.match(/<domain /g) || []).length, configuredOrigin ? 1 : 0);
  if (configuredOrigin) assert.ok(xml.includes(`includeSubdomains="false">${new URL(configuredOrigin).hostname}`));
  assert.doesNotMatch(xml, /src="user"/);
  const config = await readFile(
    new URL('../capacitor.config.ts', import.meta.url),
    'utf8',
  );
  assert.match(config, /allowMixedContent: false/);
  assert.doesNotMatch(config, /cleartext: true|AMAP_KEY|API_KEY/);
});
