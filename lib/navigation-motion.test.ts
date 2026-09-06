import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gestureIntent,
  lensPosition,
  tabDirection,
} from './navigation-motion.ts';

void test('navigation dragging ignores taps and preserves vertical scrolling', () => {
  assert.equal(gestureIntent(0, 0), 'pending');
  assert.equal(gestureIntent(5, -4), 'pending');
  assert.equal(gestureIntent(6, 0), 'drag');
  assert.equal(gestureIntent(-12, 3), 'drag');
  assert.equal(gestureIntent(4, -12), 'scroll');
  assert.equal(gestureIntent(9, 9), 'scroll');
});

void test('the drag lens follows continuously and snaps within the four vehicle tabs', () => {
  assert.equal(lensPosition(140, 100, 320), 0);
  assert.equal(lensPosition(260, 100, 320), 1.5);
  assert.equal(Math.round(lensPosition(300, 100, 320)), 2);
  assert.equal(lensPosition(-999, 100, 320), 0);
  assert.equal(lensPosition(999, 100, 320), 3);
  assert.equal(lensPosition(100, 100, 0), 0);
});

void test('page transition direction follows navigation order in both directions', () => {
  assert.equal(tabDirection('overview', 'charges'), 1);
  assert.equal(tabDirection('battery', 'drives'), -1);
  assert.equal(tabDirection('settings', 'overview'), -1);
  assert.equal(tabDirection('battery', 'settings'), 1);
});
