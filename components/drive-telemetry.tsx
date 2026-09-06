'use client';

import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartErrorBoundary } from '@/components/chart-error-boundary';
import { api, type Connection } from '@/lib/api';
import { fmt, type Drive } from '@/lib/data';
import { chartTimeAxis, chartTooltipLabel } from '@/lib/chart-time';
import {
  chartSeries,
  batteryLevelDomain,
  demoDriveDetail,
  type BatteryKey,
  type DriveDetailData,
} from '@/lib/drive-detail';

const sensors: Record<BatteryKey, { label: string; color: string }> = {
  battery: { label: '电量 SOC', color: 'var(--battery-color)' },
  usableBattery: { label: '可用电量', color: 'var(--chart-color)' },
  ratedRange: { label: '额定续航', color: 'var(--chart-color)' },
  estimatedRange: { label: '预估续航', color: '#b56b22' },
  heater: { label: '电池加热', color: '#b56b22' },
};

export function BatteryChart({
  title,
  fields,
  data,
  unit,
}: {
  title: string;
  fields: BatteryKey[];
  data: DriveDetailData['battery'];
  unit: '%' | 'km' | 'state';
}) {
  const lines = fields.map((key) => ({
    key,
    points: chartSeries(data.series[key], key),
  }));
  const hasData = lines.some((line) => line.points.length > 0);
  const times = [
    ...new Set(lines.flatMap((line) => line.points.map((p) => p.time))),
  ]
    .sort((a, b) => a - b)
    .map((time) => ({ time }));
  const timeAxis = chartTimeAxis(times.map((point) => point.time));
  const levelDomain = batteryLevelDomain(
    lines.flatMap(({ key, points }) => points.map((point) => point[key])),
  );
  return (
    <div className="drive-battery-chart">
      <h4>{title}</h4>
      <ul className="drive-chart-legend" aria-label={`${title}图例`}>
        {fields.map((key, i) => (
          <li key={key}>
            <span
              style={{
                borderColor: sensors[key].color,
                borderTopStyle: i ? 'dashed' : 'solid',
              }}
              aria-hidden="true"
            />
            {sensors[key].label}
            {!data.series[key].length && ' · 未记录'}
          </li>
        ))}
      </ul>
      {hasData && unit === '%' && (
        <p className="drive-telemetry-note">
          {levelDomain[0] > 0 || levelDomain[1] < 100 ? '纵轴局部放大 · ' : ''}
          数值相同时，两条曲线会重合
        </p>
      )}
      {hasData ? (
        <ChartContainer
          className={`detail-chart${unit === 'state' ? ' heater-chart' : ''}`}
          config={sensors}
          aria-label={title}
        >
          <LineChart
            data={times}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 6" />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={timeAxis.domain}
              ticks={timeAxis.ticks}
              tickFormatter={timeAxis.formatTick}
              minTickGap={18}
              interval="preserveStartEnd"
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              width={42}
              domain={
                unit === 'km'
                  ? ['auto', 'auto']
                  : unit === '%'
                    ? levelDomain
                    : [0, 1]
              }
              allowDecimals={unit === 'km'}
              ticks={unit === 'state' ? [0, 1] : undefined}
              tickFormatter={(v) =>
                unit === 'state' ? (v ? '开' : '关') : `${v}`
              }
              axisLine={false}
              tickLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={chartTooltipLabel}
                  formatter={(value, name) => (
                    <span>
                      {sensors[name as BatteryKey]?.label}：
                      {unit === 'state'
                        ? Number(value)
                          ? '开启'
                          : '关闭'
                        : `${fmt(Number(value), 1)} ${unit}`}
                    </span>
                  )}
                />
              }
            />
            {lines.map(({ key, points }, i) => (
              <Line
                key={key}
                data={points}
                dataKey={key}
                name={key}
                type={unit === 'state' ? 'stepAfter' : 'linear'}
                stroke={sensors[key].color}
                strokeDasharray={i ? '5 4' : undefined}
                strokeWidth={i ? 2 : 3}
                fill={sensors[key].color}
                dot={({ cx, cy, index }) => {
                  if (index == null || points[index]?.[key] == null)
                    return null;
                  // Only mark segment endpoints. Dense white-filled default dots
                  // used to cover both lines, making later samples disappear.
                  const endpoint =
                    index === 0 ||
                    index === points.length - 1 ||
                    points[index - 1]?.[key] == null ||
                    points[index + 1]?.[key] == null;
                  return endpoint ? (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={2}
                      fill={sensors[key].color}
                    />
                  ) : null;
                }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="drive-telemetry-empty">这段行程没有{title}记录</p>
      )}
    </div>
  );
}

export function DriveTelemetry({
  record,
  connection,
  carId,
}: {
  record: Drive;
  connection: Connection | null;
  carId: number;
}) {
  const query = useQuery({
    queryKey: ['drive-telemetry', connection?.session, carId, record.id],
    queryFn: ({ signal }) =>
      connection
        ? api<DriveDetailData>(
            connection,
            `/cars/${carId}/drives/${record.id}/detail`,
            signal,
          )
        : Promise.resolve(demoDriveDetail(record)),
    staleTime: 60000,
    retry: false,
  });
  if (query.isPending)
    return (
      <div className="drive-telemetry-loading">
        <output>正在读取能量与电池记录…</output>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="error-message">
        能量与电池记录加载失败：{query.error.message}
        <Button variant="outline" onClick={() => query.refetch()}>
          重试
        </Button>
      </div>
    );
  const { energy, battery } = query.data;
  const netMissing =
    energy.netUnavailable === 'no-efficiency'
      ? 'TeslaMate 尚未提供车辆能耗系数'
      : '缺少行程起止额定续航记录';
  const soc = battery.series.battery;
  const coverage =
    energy.recoveryCoverage === null
      ? '覆盖率未知'
      : energy.recoveryCoverage > 0 && energy.recoveryCoverage < 0.001
        ? '覆盖行程不足 0.1%'
        : `覆盖行程 ${fmt(energy.recoveryCoverage * 100, 1)}%`;
  const downsampled = Object.keys(battery.series).some(
    (key) =>
      battery.sampleCounts[key as BatteryKey] >
      battery.series[key as BatteryKey].length,
  );
  return (
    <>
      <section className="drive-telemetry-section" aria-label="行程能量">
        <h3>
          能量<span>估算</span>
        </h3>
        <div className="drive-energy-grid">
          <div>
            <small>净耗电量</small>
            <strong>
              {fmt(energy.netKwh, 2)}
              <em>kWh</em>
            </strong>
            <p>{energy.netKwh === null ? netMissing : '按额定续航变化估算'}</p>
          </div>
          <div>
            <small>平均净能耗</small>
            <strong>
              {fmt(energy.consumptionKwh100Km, 1)}
              <em>kWh/100 km</em>
            </strong>
            <p>
              {energy.consumptionKwh100Km === null
                ? energy.netKwh === null
                  ? netMissing
                  : '缺少有效行驶里程'
                : `${fmt(energy.consumptionKwh100Km * 10, 0)} Wh/km`}
            </p>
          </div>
          <div className="drive-energy-recovery">
            <small>动能回收 · 有效片段</small>
            <strong>
              {fmt(energy.recoveredKwh, 2)}
              <em>kWh</em>
            </strong>
            <p>
              {energy.recoveredKwh === null
                ? energy.recoveryUnavailable === 'sparse-power'
                  ? '功率采样间隔过长，无法可靠估算'
                  : '未记录功率，无法估算'
                : `按连续功率片段估算 · ${coverage}`}
            </p>
          </div>
        </div>
        <p className="drive-telemetry-note">
          净耗电已经包含动能回收的影响，不要再次扣减。回收仅统计间隔不超过 1.5
          秒的有效功率片段，缺失部分不补算，不等同于整段行程的完整回收量。
        </p>
      </section>
      <section className="drive-telemetry-section" aria-label="行程电池曲线">
        <h3>电池曲线</h3>
        {soc.length > 0 && (
          <p className="drive-soc-summary">
            首条记录 <strong>{fmt(soc[0].value, 0)}%</strong>
            <span aria-hidden="true"> → </span>末条记录{' '}
            <strong>{fmt(soc.at(-1)!.value, 0)}%</strong>
          </p>
        )}
        {[
          {
            title: '电量变化（%）',
            fields: ['battery', 'usableBattery'],
            unit: '%',
          },
          {
            title: '续航变化（km）',
            fields: ['ratedRange', 'estimatedRange'],
            unit: 'km',
          },
          { title: '电池加热状态', fields: ['heater'], unit: 'state' },
        ].map(({ title, fields, unit }) => (
          <ChartErrorBoundary
            key={`${carId}-${record.id}-${title}`}
            title={title}
          >
            <BatteryChart
              title={title}
              fields={fields as BatteryKey[]}
              data={battery}
              unit={unit as '%' | 'km' | 'state'}
            />
          </ChartErrorBoundary>
        ))}
        <p className="drive-telemetry-note">
          按本次行程的历史采样绘制，不代表当前车辆状态，也不是电池健康度。
          {downsampled ? '长行程已抽样，保留各项首末记录。' : ''}超过 3
          分钟没有记录的区间留空；未上报的项目显示「未记录」。
        </p>
      </section>
    </>
  );
}
