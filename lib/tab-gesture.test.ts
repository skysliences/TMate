import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabGesture } from './tab-gesture.ts';

const bounds = { left: 100, width: 320 };
const point = (x: number, y = 700, pointerId = 1) => ({
  pointerId,
  clientX: x,
  clientY: y,
  isPrimary: true,
  button: 0,
});

void test('touch capture transfer from a child tab must not cancel the drag', () => {
  const gesture = createTabGesture();
  const child = {},
    capsule = {};
  assert.equal(gesture.start(point(140), bounds), true);
  assert.equal(gesture.move(point(144)), null);
  assert.deepEqual(gesture.move(point(160)), { capture: true, position: 0.25 });
  // On touch, implicit capture belonged to the button before the capsule took it.
  assert.equal(
    gesture.captureLost({
      ...point(160),
      target: child,
      currentTarget: capsule,
    }),
    null,
  );
  assert.deepEqual(gesture.move(point(300)), { capture: false, position: 2 });
  assert.deepEqual(gesture.end(point(300)), { index: 2 });
  assert.equal(
    gesture.captureLost({
      ...point(300),
      target: capsule,
      currentTarget: capsule,
    }),
    null,
  );
  assert.equal(gesture.consumeClick(1), true); // Block compatibility click on the old button.
  assert.equal(gesture.consumeClick(1), false);
});

void test('touch dragging works in both directions and uses the final release position', () => {
  const gesture = createTabGesture();
  gesture.start(point(380), bounds);
  assert.equal(gesture.move(point(300))?.position, 2);
  assert.deepEqual(gesture.end(point(140)), { index: 0 });
  gesture.start(point(140), bounds);
  gesture.move(point(160));
  assert.deepEqual(gesture.end(point(900)), { index: 3 });
});

void test('taps, scrolling, secondary touches and pointer cancellation do not switch tabs', () => {
  const gesture = createTabGesture();
  gesture.start(point(140), bounds);
  assert.equal(gesture.end(point(143)), null);
  assert.equal(gesture.consumeClick(1), false);
  gesture.start(point(140), bounds);
  assert.equal(gesture.move(point(142, 720)), null);
  assert.equal(gesture.move(point(300, 720)), null);
  assert.equal(gesture.end(point(300)), null);
  gesture.start(point(140), bounds);
  assert.equal(
    gesture.start({ ...point(260, 700, 2), isPrimary: false }, bounds),
    false,
  );
  assert.equal(gesture.move(point(260, 700, 2)), null);
  assert.equal(gesture.end(point(260, 700, 2)), null);
  gesture.move(point(300));
  assert.deepEqual(gesture.end(point(300), true), { index: null });
  assert.equal(gesture.end(point(300)), null);
});

void test('only losing the capsule capture cancels; active drags survive leaving its bounds', () => {
  const gesture = createTabGesture();
  const capsule = {};
  gesture.start(point(140), bounds);
  gesture.move(point(180));
  gesture.leave(1);
  assert.ok(gesture.move(point(500)));
  assert.deepEqual(
    gesture.captureLost({
      ...point(500),
      target: capsule,
      currentTarget: capsule,
    }),
    { index: null },
  );
  assert.equal(gesture.move(point(260)), null);
  assert.equal(gesture.consumeClick(0), false); // Never block keyboard activation.
  gesture.start(point(300), bounds);
  assert.equal(gesture.consumeClick(1), false); // Next genuine touch remains usable.
  gesture.leave(1);
  assert.equal(gesture.move(point(500)), null);
});
