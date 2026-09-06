import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartTimeLabel, chartTooltipLabel } from './chart-time.ts';

const time = Date.parse('2026-09-06T12:34:00Z');

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
