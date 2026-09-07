import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, recentDrivingSummary, summarize } from './data.ts';

void test('fixed 30-day summary never changes with the selected panel period or paginated records', () => {
  const demo = makeDemo();
  assert.equal(demo.recent30?.driveCount, summarize(demo, 30).driveCount);
  assert.equal(demo.recent30?.distance, summarize(demo, 30).distance);
  const paged = {
    ...demo,
    drives: demo.drives.slice(0, 2),
    truncated: true,
    recent30: { driveCount: 128, distance: 3456.7 },
  };
  for (const days of [7, 30, 90])
    assert.deepEqual(recentDrivingSummary(paged, days), {
      driveCount: 128,
      distance: 3456.7,
    });
});

void test('older backend uses full 30-day totals only, never presents a 7/90-day result as a month', () => {
  const demo = makeDemo();
  const data = {
    ...demo,
    recent30: undefined,
    truncated: true,
    totals: {
      distance: 1500,
      driveCount: 100,
      energy: 0,
      chargeCount: 0,
      cost: 0,
      missingCosts: 0,
      consumption: null,
    },
  };
  assert.deepEqual(recentDrivingSummary(data, 30), {
    driveCount: 100,
    distance: 1500,
  });
  assert.equal(recentDrivingSummary(data, 7), null);
  assert.equal(recentDrivingSummary(data, 90), null);
  assert.equal(recentDrivingSummary({ ...data, totals: undefined }, 30), null);
  assert.deepEqual(
    recentDrivingSummary(
      { ...data, recent30: { driveCount: 0, distance: 0 } },
      7,
    ),
    { driveCount: 0, distance: 0 },
  );
});
