import gcoord from 'gcoord';
import { coordinatesOrNull } from './domain.mjs';
export const MAP_WIDTH = 640,
  MAP_HEIGHT = 360;
export function mapCoordinate(value) {
  const point = coordinatesOrNull(value);
  if (!point || Math.abs(point.latitude) > 85) return null;
  const [longitude, latitude] = gcoord.transform(
    [point.longitude, point.latitude],
    gcoord.WGS84,
    gcoord.GCJ02,
  );
  return { longitude, latitude };
}
function project({ longitude, latitude }) {
  const sine = Math.sin((latitude * Math.PI) / 180);
  return [
    (longitude + 180) / 360,
    0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  ];
}
function unproject([x, y]) {
  return {
    longitude: x * 360 - 180,
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  };
}
export function mapFrame(points, focus = 'route', zoomDelta = 0) {
  const valid = points.map(mapCoordinate).filter(Boolean);
  if (!valid.length) return null;
  const projected = valid.map(project);
  const xs = projected.map((p) => p[0]),
    ys = projected.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const fit = Math.floor(
    Math.log2(
      Math.min(
        (MAP_WIDTH - 96) / Math.max((maxX - minX) * 256, 0.0001),
        (MAP_HEIGHT - 96) / Math.max((maxY - minY) * 256, 0.0001),
      ),
    ),
  );
  const zoom = Math.max(
    3,
    Math.min(17, (focus === 'route' ? fit : 16) + zoomDelta),
  );
  const target =
    focus === 'start'
      ? projected[0]
      : focus === 'end'
        ? projected.at(-1)
        : [(minX + maxX) / 2, (minY + maxY) / 2];
  const rawCenter = unproject(target);
  // Use precisely the same rounded center for the provider image and our overlay.
  const center = {
    longitude: Number(rawCenter.longitude.toFixed(6)),
    latitude: Number(rawCenter.latitude.toFixed(6)),
  };
  const origin = project(center),
    size = 256 * 2 ** zoom;
  const screen = projected.map((p) => [
    Number((MAP_WIDTH / 2 + (p[0] - origin[0]) * size).toFixed(2)),
    Number((MAP_HEIGHT / 2 + (p[1] - origin[1]) * size).toFixed(2)),
  ]);
  return {
    center,
    zoom,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    path: screen.map((p) => p.join(',')).join(' '),
    start: screen[0],
    end: screen.at(-1),
    pointCount: valid.length,
  };
}
