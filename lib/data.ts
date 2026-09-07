export type CarInfo = { id: number; name: string; model: string; trim: string };
export type Drive = {
  id: number;
  date: string;
  start: string;
  end: string;
  distance: number;
  duration: number;
  energy: number | null;
  speedMax: number | null;
};
export type Charge = {
  id: number;
  date: string;
  location: string;
  energy: number;
  used: number | null;
  cost: number | null;
  startBattery: number | null;
  endBattery: number | null;
  duration: number;
};
export type VehicleStatus = {
  battery: number | null;
  range: number | null;
  odometer: number | null;
  insideTemp: number | null;
  outsideTemp: number | null;
  location: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  locationSource: TelemetrySource;
  locationRecordedAt: string | null;
  state: string;
  updatedAt: string | null;
  locked: boolean | null;
  sentry: boolean | null;
  version: string | null;
  versionSource?: TelemetrySource | 'cache';
  versionRecordedAt?: string | null;
  versionReceivedAt?: string | null;
  versionUnavailable?: 'permission' | 'no-record' | 'no-table' | null;
  sentrySource?: TelemetrySource | 'cache';
  sentryReceivedAt?: string | null;
  tires: (number | null)[];
  tireSources: TelemetrySource[];
  tiresRecordedAt: (string | null)[];
  live: boolean;
};
export type TelemetrySource = 'database' | 'mqtt' | 'demo' | null;
export type Dashboard = {
  car: CarInfo;
  status: VehicleStatus;
  asOf: string;
  drives: Drive[];
  charges: Charge[];
  battery: { date: string; range: number }[];
  daily?: { date: string; distance: number }[];
  recent30?: { driveCount: number; distance: number };
  totals?: {
    distance: number;
    driveCount: number;
    energy: number;
    chargeCount: number;
    cost: number;
    missingCosts: number;
    missingCostEnergy?: number;
    estimableCosts?: number;
    consumption: number | null;
    consumptionDriveCount?: number;
    consumptionDistance?: number;
    consumptionExcludedDriveCount?: number;
    powerEstimatedDriveCount?: number;
  };
  truncated?: boolean;
};
export type TrackPoint = {
  latitude: number;
  longitude: number;
  speed: number | null;
  battery: number | null;
  date: string;
};
export const fmt = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const dateLabel = (date: string, time = false) =>
  new Date(date).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Shanghai',
  });
export const stateLabels: Record<string, string> = {
  asleep: '已休眠',
  online: '在线',
  offline: '离线',
  charging: '充电中',
  driving: '行驶中',
  suspended: '采集已暂停',
  updating: '更新中',
  unknown: '状态未知',
};
export function makeDemo(carId = 1): Dashboard {
  const anchor = new Date('2026-09-05T12:00:00+08:00');
  const drives: Drive[] = [];
  const charges: Charge[] = [];
  const battery: Dashboard['battery'] = [];
  const places = ['家', '公司', '世纪公园', '滨江步道', '上海虹桥站'];
  for (let day = 0; day < 90; day++) {
    const date = new Date(anchor.getTime() - day * 86400000).toISOString();
    if (day % 7 !== 3)
      for (let j = 0; j < 2; j++) {
        const distance =
          Math.round(
            (14 + ((day * 17 + j * 5) % 43)) * (carId === 1 ? 1 : 1.2) * 10,
          ) / 10;
        drives.push({
          id: day * 2 + j + 1,
          date: new Date(
            new Date(date).getTime() - j * 8 * 3600000,
          ).toISOString(),
          start: j ? '家' : places[(day % 4) + 1],
          end: j ? places[(day % 4) + 1] : '家',
          distance,
          duration: Math.round(distance * 1.5),
          energy: distance * (0.12 + (day % 5) * 0.012),
          speedMax: 60 + (day % 7) * 9,
        });
      }
    if (day % 4 === 1)
      charges.push({
        id: day,
        date,
        location: day % 3 ? '家 · 壁挂式充电桩' : '特斯拉超级充电站 · 前滩',
        energy: 32 + (day % 9),
        used: 36 + (day % 9),
        cost: +(
          day % 3 ? (36 + (day % 9)) * 0.38 : (36 + (day % 9)) * 1.25
        ).toFixed(2),
        startBattery: 21 + (day % 17),
        endBattery: 80,
        duration: day % 3 ? 294 : 32,
      });
    if (day % 3 === 0)
      battery.unshift({
        date: date.slice(0, 10),
        range: +(
          carId === 1
            ? 438 - (90 - day) * 0.03 + (day % 7) * 0.4
            : 505 - (90 - day) * 0.05
        ).toFixed(1),
      });
  }
  const dashboard: Dashboard = {
    car: {
      id: carId,
      name: carId === 1 ? '小白' : '小蓝',
      model: carId === 1 ? '3' : 'Y',
      trim: '长续航全轮驱动版',
    },
    status: {
      battery: 78,
      range: carId === 1 ? 342 : 390,
      odometer: 28642,
      insideTemp: 24,
      outsideTemp: 27,
      location: '家 · 上海',
      coordinates: null,
      locationSource: 'demo',
      locationRecordedAt: anchor.toISOString(),
      state: 'asleep',
      updatedAt: anchor.toISOString(),
      locked: true,
      sentry: false,
      version: '2026.26.3',
      tires: [2.9, 2.9, 2.8, 2.8],
      tireSources: ['demo', 'demo', 'demo', 'demo'],
      tiresRecordedAt: Array(4).fill(anchor.toISOString()),
      live: true,
    },
    asOf: anchor.toISOString(),
    drives: drives.sort((a, b) => b.date.localeCompare(a.date)),
    charges,
    battery,
  };
  const recent = summarize(dashboard, 30);
  dashboard.recent30 = {
    driveCount: recent.driveCount,
    distance: recent.distance,
  };
  return dashboard;
}

// Older backends can supply the existing full 30-day totals, but never infer
// a month from the visible page or from a 7/90-day total with the wrong scope.
export function recentDrivingSummary(data: Dashboard, days: number) {
  if (data.recent30) return data.recent30;
  if (days === 30 && data.totals)
    return {
      driveCount: data.totals.driveCount,
      distance: data.totals.distance,
    };
  return null;
}
export function summarize(data: Dashboard, days: number) {
  const today = new Date(new Date(data.asOf).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const since = new Date(
    new Date(`${today}T00:00:00+08:00`).getTime() - (days - 1) * 86400000,
  );
  const drives = data.drives.filter((d) => new Date(d.date) >= since);
  const charges = data.charges.filter((c) => new Date(c.date) >= since);
  const distance = drives.reduce((s, d) => s + d.distance, 0);
  const valid = drives.filter((d) => d.energy != null);
  const validDistance = valid.reduce((s, d) => s + d.distance, 0);
  const totals = data.totals ?? {
    distance,
    driveCount: drives.length,
    chargeCount: charges.length,
    energy: charges.reduce((s, c) => s + c.energy, 0),
    cost: charges.reduce((s, c) => s + (c.cost ?? 0), 0),
    missingCosts: charges.filter((c) => c.cost == null).length,
    consumption: validDistance
      ? (valid.reduce((s, d) => s + (d.energy ?? 0), 0) / validDistance) * 100
      : null,
    consumptionDriveCount: valid.length,
    consumptionDistance: validDistance,
    consumptionExcludedDriveCount: drives.length - valid.length,
    powerEstimatedDriveCount: 0,
  };
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(since.getTime() + i * 86400000 + 8 * 3600000)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      distance: data.daily
        ? (data.daily.find((d) => d.date === date)?.distance ?? 0)
        : +drives
            .filter(
              (d) =>
                new Date(new Date(d.date).getTime() + 8 * 3600000)
                  .toISOString()
                  .slice(0, 10) === date,
            )
            .reduce((s, d) => s + d.distance, 0)
            .toFixed(1),
    };
  });
  return { ...totals, since, daily };
}
