export const tabOrder = [
  'overview',
  'drives',
  'charges',
  'battery',
  'settings',
];

export function tabDirection(from: string, to: string): 1 | -1 {
  return tabOrder.indexOf(to) >= tabOrder.indexOf(from) ? 1 : -1;
}

export function gestureIntent(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return 'pending';
  return Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll';
}

// The lens tracks the finger continuously; release snaps to the nearest tab.
export function lensPosition(
  x: number,
  left: number,
  width: number,
  count = 4,
) {
  if (width <= 0 || count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, ((x - left) / width) * count - 0.5));
}
