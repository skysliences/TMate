'use client';
import { chargeCost } from '@/lib/electricity';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { NoData } from './data-views';
import { TripMap } from './trip-map';
import { DriveTelemetry } from './drive-telemetry';
import { DetailHelp } from './detail-help';
import { api, type Connection } from '@/lib/api';
import {
  dateLabel,
  fmt,
  type Drive,
  type Charge,
  type TrackPoint,
} from '@/lib/data';
export type Detail =
  | { type: 'drive'; record: Drive }
  | { type: 'charge'; record: Charge };
type CurvePoint = {
  date: string;
  power: number | null;
  battery: number | null;
};
function demoTrack(record: Drive): TrackPoint[] {
  return Array.from({ length: 70 }, (_, i) => ({
    latitude: 31.205 + i * 0.0005 + Math.sin(i * 0.12) * 0.001,
    longitude: 121.45 + i * 0.0007 + Math.cos(i * 0.13) * 0.002,
    speed:
      i === 0 || i === 69
        ? 0
        : Math.round(Math.max(0, Math.sin(i * 0.13) * 30 + 38)),
    battery: 84 - i * 0.08,
    date: new Date(
      new Date(record.date).getTime() + (i * record.duration * 60000) / 69,
    ).toISOString(),
  }));
}
function demoCurve(record: Charge): CurvePoint[] {
  return Array.from({ length: 40 }, (_, i) => ({
    date: new Date(
      new Date(record.date).getTime() + (i * record.duration * 60000) / 39,
    ).toISOString(),
    power:
      record.duration > 100 ? (i === 39 ? 0 : 7) : Math.round(110 - i * 2.1),
    battery:
      (record.startBattery ?? 20) +
      (((record.endBattery ?? 80) - (record.startBattery ?? 20)) * i) / 39,
  }));
}
function Track({ points }: { points: TrackPoint[] }) {
  const valid = points.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (valid.length < 2) return <NoData title="这段行程没有足够的定位记录" />;
  const lon = valid.map((p) => p.longitude),
    lat = valid.map((p) => p.latitude);
  const xMin = Math.min(...lon),
    xMax = Math.max(...lon),
    yMin = Math.min(...lat),
    yMax = Math.max(...lat);
  const ratio = Math.max(0.1, Math.cos((((yMin + yMax) / 2) * Math.PI) / 180));
  const width = (xMax - xMin) * ratio,
    height = yMax - yMin;
  const scale = Math.min(
    440 / Math.max(width, 0.00001),
    220 / Math.max(height, 0.00001),
  );
  const xy = valid.map((p) => [
    250 + (p.longitude - (xMin + xMax) / 2) * ratio * scale,
    140 - (p.latitude - (yMin + yMax) / 2) * scale,
  ]);
  return (
    <div className="track-view">
      <h3 className="detail-module-title">
        行程地图
        <DetailHelp title="行程地图">
          演示轨迹不加载外部地图。蓝点为起点、深色点为终点，北向上；这不是导航规划路线。
        </DetailHelp>
      </h3>
      <svg
        viewBox="0 0 500 280"
        aria-label="行程轨迹示意，蓝点为起点，深色点为终点"
      >
        <defs>
          <pattern
            id="track-grid"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="var(--border)"
              strokeWidth=".5"
            />
          </pattern>
        </defs>
        <rect width="500" height="280" fill="url(#track-grid)" />
        <polyline
          points={xy.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="var(--chart-color)"
          strokeOpacity={0.12}
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={xy.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="var(--chart-color)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={xy[0][0]}
          cy={xy[0][1]}
          r="6"
          fill="var(--chart-color)"
          stroke="var(--popover)"
          strokeWidth="3"
        />
        <circle
          cx={xy.at(-1)![0]}
          cy={xy.at(-1)![1]}
          r="6"
          fill="var(--foreground)"
          stroke="var(--popover)"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}
export function RecordDetail({
  detail,
  onClose,
  connection,
  carId,
  currency,
  electricityPrice,
}: {
  detail: Detail | null;
  onClose: () => void;
  connection: Connection | null;
  carId: number;
  currency: string;
  electricityPrice: number | null;
}) {
  const cost =
    detail?.type === 'charge'
      ? chargeCost(detail.record, electricityPrice)
      : null;
  const query = useQuery({
    queryKey: [
      'detail',
      connection?.session,
      carId,
      detail?.type,
      detail?.record.id,
    ],
    enabled: !!detail,
    queryFn: async ({ signal }): Promise<(TrackPoint | CurvePoint)[]> => {
      if (!detail) return [];
      if (!connection)
        return detail.type === 'drive'
          ? demoTrack(detail.record)
          : demoCurve(detail.record);
      const path =
        detail.type === 'drive'
          ? `/cars/${carId}/drives/${detail.record.id}/track`
          : `/cars/${carId}/charges/${detail.record.id}/curve`;
      return (
        await api<{ points: (TrackPoint | CurvePoint)[] }>(
          connection,
          path,
          signal,
        )
      ).points;
    },
    staleTime: 60000,
    retry: false,
  });
  const r = detail?.record;
  return (
    <Sheet open={!!detail} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="record-sheet">
        <SheetHeader>
          <SheetTitle>
            {detail?.type === 'drive' ? '行程详情' : '充电详情'}
            {!connection && (
              <span className="demo-pill detail-demo">演示数据</span>
            )}
          </SheetTitle>
          <SheetDescription>
            {r ? dateLabel(r.date, true) : ''}
          </SheetDescription>
        </SheetHeader>
        {detail && (
          <div className="sheet-body">
            {detail.type === 'drive' ? (
              <>
                <h2 className="detail-route">
                  {detail.record.start}
                  <span>→</span>
                  {detail.record.end}
                </h2>
                <div className="detail-stats drive-summary-stats">
                  <div>
                    <small>里程</small>
                    <strong>
                      {fmt(detail.record.distance)}
                      <em>km</em>
                    </strong>
                  </div>
                  <div>
                    <small>时长</small>
                    <strong>
                      {fmt(detail.record.duration, 0)}
                      <em>分钟</em>
                    </strong>
                  </div>
                  <div>
                    <small>最高车速</small>
                    <strong>
                      {fmt(detail.record.speedMax, 0)}
                      <em>km/h</em>
                    </strong>
                  </div>
                </div>
                <DriveTelemetry
                  key={`${carId}-${detail.record.id}`}
                  record={detail.record}
                  connection={connection}
                  carId={carId}
                />
              </>
            ) : (
              <>
                <h2 className="detail-route">{detail.record.location}</h2>
                <div className="detail-stats">
                  <div>
                    <small>充入电量</small>
                    <strong>
                      {fmt(detail.record.energy)}
                      <em>kWh</em>
                    </strong>
                  </div>
                  <div>
                    <small>电网用电量</small>
                    <strong>
                      {fmt(detail.record.used)}
                      <em>kWh</em>
                    </strong>
                  </div>
                  <div>
                    <small>充电费用{cost?.estimated ? ' · 估算' : ''}</small>
                    <strong>
                      {cost?.value == null
                        ? '未记录'
                        : `${currency} ${fmt(cost.value, 2)}`}
                    </strong>
                    {cost?.estimated && (
                      <small>
                        按{cost.basis === 'grid' ? '电网用电量' : '充入电量'} ×{' '}
                        {currency} {electricityPrice} / kWh
                      </small>
                    )}
                  </div>
                  <div>
                    <small>充电时长</small>
                    <strong>
                      {fmt(detail.record.duration, 0)}
                      <em>分钟</em>
                    </strong>
                  </div>
                </div>
                <p className="charge-summary">
                  电量 {fmt(detail.record.startBattery, 0)}% →{' '}
                  {fmt(detail.record.endBattery, 0)}%
                </p>
              </>
            )}
            {query.isPending ? (
              <Skeleton className="h-60 w-full" />
            ) : query.isError ? (
              <div role="alert" className="error-message">
                {query.error.message}
                <Button variant="outline" onClick={() => query.refetch()}>
                  重试
                </Button>
              </div>
            ) : query.data?.length ? (
              <>
                {detail.type === 'drive' &&
                  (connection ? (
                    <TripMap
                      key={`${carId}-${detail.record.id}`}
                      connection={connection}
                      carId={carId}
                      driveId={detail.record.id}
                    />
                  ) : (
                    <Track points={query.data as TrackPoint[]} />
                  ))}
                <h3 className="detail-chart-title detail-module-title">
                  {detail.type === 'drive' ? '车速变化' : '充电功率'}
                  {detail.type === 'drive' && (
                    <DetailHelp title="车速变化">
                      按本次行程有效定位采样中的车速绘制，不代表当前车速。长行程会抽样以控制数据量。
                    </DetailHelp>
                  )}
                </h3>
                <ChartContainer
                  className="detail-chart"
                  config={
                    detail.type === 'drive'
                      ? {
                          speed: {
                            label: '车速 km/h',
                            color: 'var(--chart-color)',
                          },
                        }
                      : {
                          power: {
                            label: '功率 kW',
                            color: 'var(--chart-color)',
                          },
                        }
                  }
                >
                  <AreaChart data={query.data}>
                    <CartesianGrid vertical={false} strokeDasharray="3 6" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) =>
                        dateLabel(v, true).split(' ')[1] || dateLabel(v, true)
                      }
                      minTickGap={40}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis axisLine={false} tickLine={false} width={35} />
                    <ChartTooltip
                      labelFormatter={(v) => dateLabel(String(v), true)}
                      content={<ChartTooltipContent />}
                    />
                    <Area
                      dataKey={detail.type === 'drive' ? 'speed' : 'power'}
                      stroke="var(--chart-color)"
                      fill="var(--chart-color)"
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
                {detail.type === 'charge' && (
                  <>
                    <h3 className="detail-chart-title">电量变化</h3>
                    <ChartContainer
                      className="detail-chart"
                      config={{
                        battery: {
                          label: '电量 %',
                          color: 'var(--battery-color)',
                        },
                      }}
                    >
                      <LineChart data={query.data}>
                        <CartesianGrid vertical={false} strokeDasharray="3 6" />
                        <XAxis dataKey="date" hide />
                        <YAxis domain={[0, 100]} width={35} />
                        <ChartTooltip
                          labelFormatter={(v) => dateLabel(String(v), true)}
                          content={<ChartTooltipContent />}
                        />
                        <Line
                          dataKey="battery"
                          stroke="var(--battery-color)"
                          dot={false}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ChartContainer>
                  </>
                )}
              </>
            ) : (
              <NoData title="该记录没有详细采样数据" />
            )}
            {detail.type === 'charge' && (
              <p className="note">
                电网用电与充入电量可能不同，差额包括充电过程中的损耗。
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
