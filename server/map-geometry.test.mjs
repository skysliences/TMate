import { test } from 'node:test';
import assert from 'node:assert/strict';
import gcoord from 'gcoord';
import { mapFrame } from './map-geometry.mjs';

// Public synthetic GCJ-02 control points, independently rendered by AMap
// staticmap (640*360, scale=1) at each zoom on 2026-09-07. Provider polygon
// centroids were [158.5,100.5], [318.5,180.5], [478.5,260.5]: adjacent
// displacement [160,80], NOT [80,40]. Compare relative pixels to avoid
// baking the provider's 1–2 px rasterization offset into our GPS geometry.
const calibration = [
  {
    zoom: 14,
    gcj: [
      [116.393134, 39.902634],
      [116.4, 39.9],
      [116.406866, 39.897366],
    ],
  },
  {
    zoom: 16,
    gcj: [
      [116.398283, 39.900658],
      [116.4, 39.9],
      [116.401717, 39.899342],
    ],
  },
  {
    zoom: 17,
    gcj: [
      [116.399142, 39.900329],
      [116.4, 39.9],
      [116.400858, 39.899671],
    ],
  },
];
function gps(points) {
  return points.map((point) => {
    const [longitude, latitude] = gcoord.transform(
      point,
      gcoord.GCJ02,
      gcoord.WGS84,
    );
    return { longitude, latitude };
  });
}
const pixels = (frame) =>
  frame.path.split(' ').map((pair) => pair.split(',').map(Number));
function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 0.5,
    `${message}: ${actual} vs ${expected}`,
  );
}

for (const fixture of calibration) {
  void test(`AMap measured pixels match route/start/end at zoom ${fixture.zoom}`, () => {
    const points = gps(fixture.gcj);
    const original = structuredClone(points);
    for (const focus of ['route', 'start', 'end']) {
      const frame = mapFrame(
        points,
        focus,
        focus === 'route' ? 0 : fixture.zoom - 16,
      );
      assert.equal(
        frame.zoom,
        fixture.zoom,
        'Full-route fitting uses the provider pixel scale too',
      );
      const screen = pixels(frame);
      for (let i = 1; i < screen.length; i++) {
        near(
          screen[i][0] - screen[i - 1][0],
          160,
          'Provider horizontal displacement',
        );
        near(
          screen[i][1] - screen[i - 1][1],
          80,
          'Provider vertical displacement',
        );
      }
      const anchor = screen[focus === 'start' ? 0 : focus === 'end' ? 2 : 1];
      near(anchor[0], 320, 'Focused longitude stays centered');
      near(anchor[1], 180, 'Focused latitude stays centered');
      assert.equal(frame.start.join(','), screen[0].join(','));
      assert.equal(frame.end.join(','), screen.at(-1).join(','));
      if (focus === 'route') {
        for (const [x, y] of screen) {
          assert.ok(
            x >= 48 && x <= 592 && y >= 48 && y <= 312,
            'Full route remains inside padding',
          );
        }
      }
    }
    assert.deepEqual(points, original, 'Rendering never rewrites recorded GPS');
  });
}

void test('full-route fitting includes intermediate turns, not just endpoints', () => {
  const points = gps([
    [116.4, 39.9],
    [116.6, 40.1],
    [116.401, 39.901],
  ]);
  const frame = mapFrame(points);
  for (const [x, y] of pixels(frame)) {
    assert.ok(x >= 48 && x <= 592 && y >= 48 && y <= 312);
  }
});

void test('focused views keep offscreen endpoints at true positions without clamping', () => {
  const points = gps(calibration[0].gcj);
  const start = mapFrame(points, 'start');
  const end = mapFrame(points, 'end');
  near(start.end[0] - start.start[0], 1280, 'Zoom 16 endpoint displacement');
  near(end.end[0] - end.start[0], 1280, 'Changing focus does not change scale');
  assert.ok(start.end[0] > start.width && end.start[0] < 0);
  const enlarged = mapFrame(points, 'start', 1);
  near(
    enlarged.end[0] - enlarged.start[0],
    2 * (start.end[0] - start.start[0]),
    'One zoom step doubles pixel distance',
  );
});

void test('single and duplicate coordinates remain centered at the maximum zoom', () => {
  const points = gps([
    [116.4, 39.9],
    [116.4, 39.9],
  ]);
  for (const focus of ['route', 'start', 'end']) {
    const frame = mapFrame(points, focus, 4);
    assert.equal(frame.zoom, 17);
    near(frame.start[0], 320, 'Center x');
    near(frame.start[1], 180, 'Center y');
    assert.deepEqual(frame.start, frame.end);
  }
});
