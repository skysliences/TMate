import type { Drive } from './data.ts';

export type BatteryKey =
  | 'battery'
  | 'usableBattery'
  | 'ratedRange'
  | 'estimatedRange'
  | 'heater';
export type BatterySample = { date: string; value: number };
export type DriveDetailData = {
  energy: {
    netKwh: number | null;
    netUnavailable: 'no-efficiency' | 'no-range' | null;
    consumptionKwh100Km: number | null;
    recoveredKwh: number | null;
    recoveryCoverage: number | null;
    recoveryUnavailable: 'no-power' | 'sparse-power' | null;
  };
  battery: {
    series: Record<BatteryKey, BatterySample[]>;
    sampleCounts: Record<BatteryKey, number>;
  };
};

// Give short trips room to show a one-percentage-point change, without moving
// either series away from its real value. The chart labels this cropped scale.
export function batteryLevelDomain(
  values: readonly (number | null)[],
): [number, number] {
  const valid = values.filter(
    (value): value is number =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100,
  );
  if (!valid.length) return [0, 100];
  let lower = Math.max(0, Math.floor(Math.min(...valid)) - 2);
  let upper = Math.min(100, Math.ceil(Math.max(...valid)) + 2);
  if (upper - lower < 4) {
    if (lower === 0) upper = 4;
    else lower = 96;
  }
  return [lower, upper];
}

// A long missing interval must not look like a continuously observed curve.
export function chartSeries(samples: BatterySample[], key: BatteryKey) {
  const maximum = key === 'heater' ? 1 : key.endsWith('Range') ? 2000 : 100;
  const valid = samples
    .map((p) => ({ time: Date.parse(p.date), value: p.value }))
    .filter(
      (p) =>
        Number.isFinite(p.time) &&
        Number.isFinite(p.value) &&
        p.value >= 0 &&
        p.value <= maximum,
    )
    .sort((a, b) => a.time - b.time);
  const gap = 180000;
  const points: { time: number; [key: string]: number | null }[] = [];
  valid.forEach((point, i) => {
    if (i && point.time - valid[i - 1].time > gap)
      points.push({ time: valid[i - 1].time + 1, [key]: null });
    points.push({ time: point.time, [key]: point.value });
  });
  return points;
}

export function demoDriveDetail(record: Drive): DriveDetailData {
  const series = {} as DriveDetailData['battery']['series'];
  for (const key of [
    'battery',
    'usableBattery',
    'ratedRange',
    'estimatedRange',
    'heater',
  ] as const) {
    series[key] = Array.from({ length: 70 }, (_, i) => {
      const progress = i / 69;
      const soc = 84 - progress * 6;
      return {
        date: new Date(
          Date.parse(record.date) + progress * record.duration * 60000,
        ).toISOString(),
        value:
          key === 'battery'
            ? soc
            : key === 'usableBattery'
              ? soc - 1
              : key === 'ratedRange'
                ? 368 - progress * 26
                : key === 'estimatedRange'
                  ? 348 - progress * 24 + Math.sin(progress * 6) * 2
                  : i < 12
                    ? 1
                    : 0,
      };
    });
  }
  return {
    energy: {
      netKwh: record.energy,
      netUnavailable: record.energy === null ? 'no-efficiency' : null,
      consumptionKwh100Km:
        record.energy !== null && record.distance > 0
          ? (record.energy / record.distance) * 100
          : null,
      recoveredKwh: record.distance * 0.018,
      recoveryCoverage: 0.97,
      recoveryUnavailable: null,
    },
    battery: {
      series,
      sampleCounts: {
        battery: 70,
        usableBattery: 70,
        ratedRange: 70,
        estimatedRange: 70,
        heater: 70,
      },
    },
  };
}
