// Run inside the container, or via: docker compose exec -T voltlog node
// --input-type=module < deploy/verify-amap.mjs. Never log keys or positions.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import gcoord from 'gcoord';

// Independently verify live overlays against recorded GPS and AMap's measured
// scale=1 zoom convention, without importing the implementation under test.
function mercator(longitude, latitude) {
  const radians = (latitude * Math.PI) / 180;
  return [
    (longitude + 180) / 360,
    (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2,
  ];
}
function verifyGeometry(map, points, view) {
  const projected = points
    .filter(
      (p) =>
        p.longitude !== null &&
        p.latitude !== null &&
        Number.isFinite(Number(p.longitude)) &&
        Number.isFinite(Number(p.latitude)) &&
        Math.abs(Number(p.latitude)) <= 85,
    )
    .map((p) =>
      mercator(
        ...gcoord.transform(
          [Number(p.longitude), Number(p.latitude)],
          gcoord.WGS84,
          gcoord.GCJ02,
        ),
      ),
    );
  const overlay = map.path
    .split(' ')
    .map((pair) => pair.split(',').map(Number));
  assert.ok(
    projected.length === overlay.length && projected.length === map.pointCount,
    'Track/overlay counts differ',
  );
  const center = mercator(map.center.longitude, map.center.latitude);
  const worldPixels = 2 ** (map.zoom + 9);
  for (let i = 0; i < projected.length; i++) {
    for (const axis of [0, 1]) {
      const expected =
        (axis === 0 ? map.width : map.height) / 2 +
        (projected[i][axis] - center[axis]) * worldPixels;
      assert.ok(
        Math.abs(overlay[i][axis] - expected) < 0.02,
        'Track pixel scale does not match AMap',
      );
    }
    if (view === 'focus=route&zoom=0' && map.zoom > 3) {
      const [x, y] = overlay[i];
      assert.ok(
        x >= 47.8 && x <= 592.2 && y >= 47.8 && y <= 312.2,
        'Full route exceeds map padding',
      );
    }
  }
  for (const [endpoint, expected] of [
    [map.start, overlay[0]],
    [map.end, overlay.at(-1)],
  ]) {
    assert.ok(
      endpoint.every((value, axis) => value === expected[axis]),
      'Endpoint and track differ',
    );
  }
  const focused = view.startsWith('focus=start')
    ? map.start
    : view.startsWith('focus=end')
      ? map.end
      : null;
  if (focused)
    assert.ok(
      Math.abs(focused[0] - 320) < 0.2 && Math.abs(focused[1] - 180) < 0.2,
      'Focused endpoint is not centered',
    );
}

const base = 'http://127.0.0.1:8787';
const key = process.env.AMAP_KEY;
assert.ok(key && /^[a-f\d]{32}$/i.test(key), 'AMap configuration missing');
const headers = { Authorization: `Bearer ${process.env.API_KEY}` };
async function get(path) {
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200, `HTTP check failed: ${path}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.ok(!body.includes(key), 'Provider key appeared in API output');
  return JSON.parse(body);
}
let publicFiles = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (entry.isFile()) {
      assert.ok(
        !(await readFile(file)).includes(Buffer.from(key)),
        'Provider key appeared in public assets',
      );
      publicFiles++;
    }
  }
}
await scan(process.env.PUBLIC_DIR || '/app/www');

const { cars } = await get('/api/cars');
let checkedMaps = 0,
  driveCount = 0;
const precision = {};
for (const car of cars) {
  const { items } = await get(
    `/api/cars/${car.id}/drives?days=30&limit=100&offset=0`,
  );
  driveCount += items.length;
  for (const drive of items) {
    for (const field of ['start', 'end']) {
      const info = drive[`${field}AddressInfo`];
      precision[info?.precision || 'unresolved'] =
        (precision[info?.precision || 'unresolved'] || 0) + 1;
      if (info?.road) assert.ok(drive[field].includes(info.road));
    }
    const path = `/api/cars/${car.id}/drives/${drive.id}/map`;
    const { points } = await get(
      `/api/cars/${car.id}/drives/${drive.id}/track`,
    );
    assert.equal((await fetch(base + path)).status, 401);
    const views =
      drive === items[0]
        ? [
            'focus=route&zoom=0',
            'focus=start&zoom=0',
            'focus=end&zoom=0',
            'focus=route&zoom=1',
          ]
        : ['focus=route&zoom=0'];
    for (const view of views) {
      const map = await get(`${path}?${view}`);
      assert.equal(map.coordinateSystem, 'GCJ-02');
      assert.ok(map.pointCount > 0 && map.path.length > 0);
      assert.equal(map.width, 640);
      assert.equal(map.height, 360);
      verifyGeometry(map, points, view);
      const bytes = Buffer.from(map.image.split(',')[1], 'base64');
      assert.ok(bytes.length > 1000, 'Basemap image is unexpectedly small');
      if (map.image.startsWith('data:image/png;')) {
        assert.equal(bytes.readUInt32BE(16), map.width, 'Basemap pixel width');
        assert.equal(
          bytes.readUInt32BE(20),
          map.height,
          'Basemap pixel height',
        );
      }
      checkedMaps++;
    }
  }
}
let cachedAddresses = 0;
if (process.env.MAP_CACHE_DIR) {
  const file = join(process.env.MAP_CACHE_DIR, 'amap-address-v1.json');
  assert.equal((await stat(process.env.MAP_CACHE_DIR)).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  cachedAddresses = Object.keys(
    JSON.parse(await readFile(file, 'utf8')),
  ).length;
}
console.log(
  JSON.stringify({
    verified: true,
    driveCount,
    addressPrecision: precision,
    checkedMaps,
    trackProjectionVerified: true,
    publicFilesWithoutKey: publicFiles,
    cachedAddresses,
    privateCachePermissions: true,
  }),
);
