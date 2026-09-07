import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, unlink, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMapService, detailedAddress } from './maps.mjs';
import { mapCoordinate, mapFrame } from './map-geometry.mjs';
const key = 'b'.repeat(32);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLlMAAAAASUVORK5CYII=',
  'base64',
);
const point = { longitude: 116.397, latitude: 39.908 };
const detailed = {
  formatted_address: '北京市朝阳区示例路12号',
  addressComponent: {
    province: '北京市',
    city: '北京市',
    district: '朝阳区',
    streetNumber: { street: '示例路', number: '12号' },
  },
};
const row = () => ({ start: { point, address: { name: 'Example Road' } } });
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });

void test('detailed Chinese labels use actual street/number and distinguish nearest-road estimates', () => {
  assert.deepEqual(detailedAddress(detailed), {
    label: '北京市朝阳区示例路12号',
    road: '示例路',
    precision: 'street',
    source: 'amap',
  });
  assert.equal(
    detailedAddress({
      ...detailed,
      formatted_address: '北京市朝阳区',
      addressComponent: { ...detailed.addressComponent, streetNumber: [] },
      roads: [
        { name: '较远路', distance: '90' },
        { name: '错误路', distance: null },
        { name: '示例路', distance: '12' },
      ],
    }).label,
    '北京市朝阳区示例路（距道路约 12 米）',
  );
  assert.equal(
    detailedAddress({
      formatted_address: '某村',
      addressComponent: { streetNumber: [] },
      roads: [],
    }).road,
    null,
  );
});

void test('coordinate conversion and map geometry align overlays without mutating GPS records', () => {
  const converted = mapCoordinate(point);
  assert.ok(converted.longitude > point.longitude + 0.005);
  assert.ok(converted.latitude > point.latitude + 0.001);
  assert.deepEqual(point, { longitude: 116.397, latitude: 39.908 });
  assert.equal(mapCoordinate({ latitude: null, longitude: 100 }), null);
  assert.equal(mapFrame([]), null);
  const frame = mapFrame([point, { longitude: 116.45, latitude: 39.95 }]);
  assert.ok(frame.start[0] >= 40 && frame.end[0] <= 600);
  assert.ok(frame.start[1] <= 320 && frame.end[1] >= 40);
  assert.equal(frame.pointCount, 2);
  const focused = mapFrame([point], 'start', 4);
  assert.equal(focused.zoom, 17);
  assert.ok(Math.abs(focused.start[0] - 320) < 0.1);
  assert.ok(Math.abs(focused.start[1] - 180) < 0.1);
});

void test('address requests deduplicate, persist, and use actual endpoint coordinates instead of place centroids', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'voltlog-map-test-'));
  const calls = [];
  let service;
  try {
    service = await createMapService({
      key,
      cacheDir,
      delayMs: 0,
      requestIntervalMs: 0,
      fetcher: async (url) => {
        calls.push(url);
        return json({ status: '1', regeocode: detailed });
      },
    });
    const input = row();
    input.start.address.latitude = 1;
    input.start.address.longitude = 2;
    const results = await service.enrich([input, row()]);
    await service.idle();
    assert.equal(
      (await stat(join(cacheDir, 'amap-address-v1.json'))).mode & 0o777,
      0o600,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hostname, 'restapi.amap.com');
    assert.equal(calls[0].searchParams.get('key'), key);
    assert.match(calls[0].searchParams.get('location'), /^116\./);
    assert.equal(results[0].start, detailed.formatted_address);
    assert.equal(results[0].startAddressInfo.precision, 'street');
    const reopened = await createMapService({
      key,
      cacheDir,
      fetcher: async () => {
        throw new Error('Cache was not used');
      },
    });
    assert.equal(
      (await reopened.enrich([row()]))[0].start,
      detailed.formatted_address,
    );
    await reopened.close();
  } finally {
    if (service) await service.close();
    for (const file of await readdir(cacheDir))
      await unlink(join(cacheDir, file));
    await rmdir(cacheDir);
  }
});

void test('map requests send only center/zoom, preserve protected image output, and share cached basemaps', async () => {
  const calls = [];
  const service = await createMapService({
    key,
    delayMs: 0,
    requestIntervalMs: 0,
    fetcher: async (url) => {
      calls.push(url);
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  const frame = await service.map(
    [point, { longitude: 116.45, latitude: 39.95 }],
    'route',
    0,
  );
  await service.map(
    [point, { longitude: 116.45, latitude: 39.95 }],
    'route',
    0,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.has('paths'), false);
  assert.equal(calls[0].searchParams.has('markers'), false);
  assert.equal(calls[0].searchParams.get('scale'), '1');
  assert.equal(
    calls[0].searchParams.get('size'),
    `${frame.width}*${frame.height}`,
  );
  assert.equal(calls[0].searchParams.get('zoom'), String(frame.zoom));
  assert.equal(
    calls[0].searchParams.get('location'),
    `${frame.center.longitude.toFixed(6)},${frame.center.latitude.toFixed(6)}`,
  );
  assert.equal(frame.coordinateSystem, 'GCJ-02');
  assert.match(frame.image, /^data:image\/png;base64,/);
  assert.ok(!JSON.stringify(frame).includes(key));
  assert.ok(!JSON.stringify(frame).includes('restapi.amap.com'));
  await service.close();
});

void test('provider errors never leak keys/URLs or break vehicle history; missing keys do not send requests', async () => {
  let calls = 0;
  const service = await createMapService({
    key,
    delayMs: 0,
    requestIntervalMs: 0,
    fetcher: async () => {
      calls++;
      return json({ status: '0', infocode: '10001', info: `secret ${key}` });
    },
  });
  assert.equal((await service.enrich([row()]))[0].start, 'Example Road');
  await service.enrich([row()]);
  assert.equal(calls, 1);
  await assert.rejects(
    service.map([point], 'route', 0),
    (e) => e.code === 'AMAP_10001' && !e.message.includes(key),
  );
  await service.close();
  const disabled = await createMapService({
    fetcher: () => {
      throw new Error('Unexpected request');
    },
  });
  const original = [row()];
  assert.equal(await disabled.enrich(original), original);
  await assert.rejects(disabled.map([point]), (e) => e.status === 503);
  await disabled.close();
});

void test('rapid map views are paced and QPS errors retry once inside the same queue', async () => {
  const calls = [];
  const service = await createMapService({
    key,
    delayMs: 0,
    requestIntervalMs: 20,
    fetcher: async () => {
      calls.push(performance.now());
      if (calls.length === 1) return json({ status: '0', infocode: '10021' });
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  try {
    const points = [point, { longitude: 116.45, latitude: 39.95 }];
    const views = await Promise.all([
      service.map(points, 'route', 0),
      service.map(points, 'start', 0),
      service.map(points, 'end', 0),
    ]);
    assert.equal(views.length, 3);
    assert.equal(calls.length, 4);
    for (let i = 1; i < calls.length; i++)
      assert.ok(calls[i] - calls[i - 1] >= 15, 'Requests must be paced');
  } finally {
    await service.close();
  }
  let failures = 0;
  const limited = await createMapService({
    key,
    requestIntervalMs: 0,
    fetcher: async () => {
      failures++;
      return json({ status: '0', infocode: '10021' });
    },
  });
  await assert.rejects(
    limited.map([point], 'route', 0),
    (e) => e.code === 'AMAP_10021',
  );
  assert.equal(failures, 2, 'Rate-limit retries must be bounded');
  await limited.close();
});
