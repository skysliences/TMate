import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryLabel } from './telemetry-label.ts';

void test('field labels show historical record time in China time, not a fabricated live timestamp', () => {
  const label = telemetryLabel('database', '2026-09-01T00:15:00.000Z');
  assert.match(label, /^最后记录 · /);
  assert.match(label, /2026[/-]09[/-]01/);
  assert.match(label, /08:15/);
  assert.equal(
    telemetryLabel('mqtt', '2026-09-05T00:00:00Z'),
    'MQTT · 测量时间未提供',
  );
  assert.equal(telemetryLabel(null, null), '暂无有效记录');
  assert.equal(telemetryLabel(), '暂无有效记录');
  assert.equal(telemetryLabel('database', 'invalid'), '记录时间未提供');
  assert.equal(telemetryLabel('database', null), '记录时间未提供');
  assert.match(telemetryLabel('demo', '2026-09-01T00:00:00Z'), /^演示记录 · /);
});
