import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSeries, demoDriveDetail } from './drive-detail.ts';
import { makeDemo } from './data.ts';

void test('battery charts keep zeroes, order time, reject invalid samples and leave long gaps empty', () => {
  const points = chartSeries(
    [
      { date: '2026-01-01T01:00:00Z', value: 80 },
      { date: '2026-01-01T00:00:00Z', value: 0 },
      { date: 'invalid', value: 50 },
      { date: '2026-01-01T00:01:00Z', value: 101 },
      { date: '2026-01-01T00:02:00Z', value: NaN },
    ],
    'battery',
  );
  assert.equal(points.length, 3);
  assert.equal(points[0].battery, 0);
  assert.equal(points[1].battery, null);
  assert.equal(points[2].battery, 80);
  assert.deepEqual(chartSeries([], 'battery'), []);
  assert.equal(
    chartSeries([{ date: '2026-01-01', value: 350 }], 'ratedRange')[0]
      .ratedRange,
    350,
  );
  assert.equal(
    chartSeries([{ date: '2026-01-01', value: 0 }], 'heater')[0].heater,
    0,
  );
});

void test('demo drive telemetry is deterministic, typed and bounded to the selected drive', () => {
  const drive = makeDemo().drives[0];
  const data = demoDriveDetail(drive);
  assert.deepEqual(demoDriveDetail(drive), data);
  assert.equal(data.energy.netKwh, drive.energy);
  for (const points of Object.values(data.battery.series)) {
    assert.equal(points.length, 70);
    assert.equal(points[0].date, drive.date);
    assert.equal(
      Date.parse(points.at(-1)!.date),
      Date.parse(drive.date) + drive.duration * 60000,
    );
  }
  assert.equal(
    demoDriveDetail({ ...drive, energy: null }).energy.consumptionKwh100Km,
    null,
  );
});
