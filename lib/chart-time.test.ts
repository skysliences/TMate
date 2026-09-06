import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chartTimeLabel,
  chartTooltipLabel,
  chartTimeAxis,
} from './chart-time.ts';

const time = Date.parse('2026-09-06T12:34:00Z');

void test('short, long and subsecond trips have unique time labels and exact endpoints', () => {
  for (const span of [2, 500, 2500, 52000, 261275, 3600000, 90000000]) {
    const axis = chartTimeAxis([time + span, time, NaN]);
    assert.deepEqual(axis.domain, [time, time + span]);
    assert.equal(axis.ticks[0], time);
    assert.equal(axis.ticks.at(-1), time + span);
    assert.ok(axis.ticks.length <= 4);
    const labels = axis.ticks.map(axis.formatTick);
    assert.equal(new Set(labels).size, labels.length);
    assert.equal(axis.formatTick(NaN), '—');
  }
  const single = chartTimeAxis([time]);
  assert.ok(single.domain[0] < time && single.domain[1] > time);
  assert.deepEqual(single.ticks, [time]);
});

void test('chart labels use the sample time, not the translated series label', () => {
  for (const label of [
    '电量 SOC',
    '可用电量',
    '额定续航',
    '预估续航',
    '电池加热',
  ]) {
    assert.equal(
      chartTooltipLabel(label, [{ payload: { time } }]),
      '09/06 20:34',
    );
  }
  assert.equal(chartTimeLabel(time), '20:34');
  assert.equal(chartTimeLabel(String(time)), '20:34');
  assert.equal(chartTimeLabel(0, true), '01/01 08:00');
});

void test('missing, invalid and out-of-range chart times never throw', () => {
  for (const value of [
    undefined,
    null,
    '',
    ' ',
    '电量 SOC',
    {},
    [],
    true,
    NaN,
    Infinity,
    -Infinity,
    1e20,
  ]) {
    assert.equal(chartTimeLabel(value), '—');
    assert.equal(chartTimeLabel(value, true), '时间未记录');
    assert.equal(
      chartTooltipLabel('电池加热', [{ payload: { time: value } }]),
      '时间未记录',
    );
  }
  assert.equal(chartTooltipLabel(time), '时间未记录');
  assert.equal(chartTooltipLabel(time, []), '时间未记录');
  assert.equal(chartTooltipLabel(time, [{}]), '时间未记录');
  assert.equal(
    chartTooltipLabel('电量 SOC', [{}, { payload: { time } }]),
    '09/06 20:34',
  );
});
