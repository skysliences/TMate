'use client';
import { chargeCost, chargingCostSummary } from '@/lib/electricity';
import {
  ArrowUpRight,
  Battery,
  Car,
  ChartNoAxesCombined,
  CircleHelp,
  Gauge,
  MapPin,
  Moon,
  Route,
  ShieldCheck,
  Thermometer,
  Zap,
  ChevronRight,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import {
  fmt,
  summarize,
  dateLabel,
  stateLabels,
  type Dashboard,
  type Drive,
  type Charge,
} from '@/lib/data';
import { telemetryLabel } from '@/lib/telemetry-label';

export function SectionTitle({
  title,
  action,
  onClick,
}: {
  title: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && (
        <button className="text-action" onClick={onClick}>
          {action}
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  );
}
export function Metric({
  icon: Icon,
  label,
  value,
  unit,
  note,
}: {
  icon: typeof Car;
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <section className="metric panel">
      <div className="metric-label">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <p>
        {value}
        <span>{unit}</span>
      </p>
      <small>{note}</small>
    </section>
  );
}
export function NoData({
  title = '暂无记录',
  note = '这个时间范围内还没有数据。',
}: {
  title?: string;
  note?: string;
}) {
  return (
    <Empty className="empty-state">
      <Route className="faint" />
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{note}</EmptyDescription>
    </Empty>
  );
}
export function MileageChart({
  rows,
}: {
  rows: { date: string; distance: number }[];
}) {
  return (
    <ChartContainer
      config={{ distance: { label: '里程 km', color: 'var(--chart-color)' } }}
      className="mileage-chart"
    >
      <BarChart
        data={rows}
        margin={{ left: -24, right: 0, top: 12, bottom: 0 }}
      >
        <CartesianGrid
          vertical={false}
          strokeDasharray="3 6"
          stroke="var(--border)"
        />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => d.slice(5).replace('-', '/')}
          minTickGap={30}
          axisLine={false}
          tickLine={false}
          tickMargin={12}
        />
        <YAxis axisLine={false} tickLine={false} tickMargin={12} />
        <ChartTooltip
          cursor={{ fill: 'var(--accent)' }}
          content={<ChartTooltipContent />}
        />
        <Bar
          dataKey="distance"
          fill="var(--chart-color)"
          radius={[5, 5, 0, 0]}
          maxBarSize={16}
        />
      </BarChart>
    </ChartContainer>
  );
}
export function DriveRow({
  drive: d,
  onClick,
}: {
  drive: Drive;
  onClick: () => void;
}) {
  return (
    <button className="drive-row interactive-row" onClick={onClick}>
      <span className="record-icon">
        <Route size={18} />
      </span>
      <div className="record-main">
        <strong>
          {d.start}
          <span className="route-arrow">→</span>
          {d.end}
        </strong>
        <small>
          {dateLabel(d.date, true)} · {fmt(d.duration, 0)} 分钟
        </small>
      </div>
      <div className="record-number">
        {fmt(d.distance)}
        <small>km</small>
      </div>
      <ChevronRight className="faint" size={16} />
    </button>
  );
}
export function ChargeRow({
  charge: c,
  onClick,
  currency,
  electricityPrice,
}: {
  charge: Charge;
  onClick: () => void;
  currency: string;
  electricityPrice: number | null;
}) {
  const cost = chargeCost(c, electricityPrice);
  return (
    <button className="drive-row interactive-row" onClick={onClick}>
      <span className="charge-icon">
        <Zap size={18} />
      </span>
      <div className="record-main">
        <strong>{c.location}</strong>
        <small>
          {dateLabel(c.date)} · {fmt(c.startBattery, 0)}% →{' '}
          {fmt(c.endBattery, 0)}% · {fmt(c.duration, 0)} 分钟
        </small>
      </div>
      <div className="record-number">
        {fmt(c.energy)}
        <small>
          kWh ·{' '}
          {cost.value == null ? '费用未记录' : `${cost.estimated ? '估算 ' : ''}${currency} ${fmt(cost.value, 2)}`}
        </small>
      </div>
      <ChevronRight className="faint" size={16} />
    </button>
  );
}
export function Overview({
  data,
  days,
  currency,
  electricityPrice,
  onNavigate,
  onDrive,
  onCharge,
}: {
  data: Dashboard;
  days: number;
  currency: string;
  electricityPrice: number | null;
  onNavigate: (tab: string) => void;
  onDrive: (d: Drive) => void;
  onCharge: (c: Charge) => void;
}) {
  const stats = summarize(data, days);
  const s = data.status;
  const last = data.charges[0];
  const costs = chargingCostSummary(data, days, electricityPrice);
  const lastCost = last ? chargeCost(last, electricityPrice) : null;
  const StatusIcon =
    s.state === 'asleep' ? Moon : s.state === 'charging' ? Zap : Car;
  return (
    <>
      <div className="overview-grid">
        <section className="vehicle-panel">
          <div className="panel-top">
            <span className="section-kicker">已记录电量</span>
            <span className="status-pill">
              <StatusIcon size={14} />
              {stateLabels[s.state] ?? s.state}
            </span>
          </div>
          <div className="battery-number">
            {fmt(s.battery, 0)}
            <span>%</span>
          </div>
          <Progress
            value={s.battery ?? 0}
            aria-label="车辆电量"
            className="battery-progress"
          />
          <div className="range-row">
            <span>
              <strong>{fmt(s.range, 0)}</strong> km <small>额定续航</small>
            </span>
            <Battery size={25} />
          </div>
          <div className="vehicle-divider" />
          <div className="vehicle-meta">
            <div className="vehicle-location">
              <span>
                <MapPin size={16} />
                {s.location || (s.coordinates ? '已记录位置' : '暂无位置')}
              </span>
              {s.coordinates && (
                <p className="location-coordinates">
                  纬度 {s.coordinates.latitude.toFixed(5)}°<br />
                  经度 {s.coordinates.longitude.toFixed(5)}°
                </p>
              )}
              <small className="telemetry-time">
                {telemetryLabel(s.locationSource, s.locationRecordedAt)}
              </small>
            </div>
            <span>
              <ShieldCheck size={16} />
              {s.locked == null ? '锁车 · —' : s.locked ? '已锁车' : '未锁车'}
            </span>
          </div>
          <div className="vehicle-bottom">
            <span>
              <Thermometer size={15} />
              车内 {fmt(s.insideTemp, 0)}°C
            </span>
            <span>车外 {fmt(s.outsideTemp, 0)}°C</span>
          </div>
        </section>
        <section className="journey-panel panel">
          <div className="panel-top">
            <div>
              <p className="section-kicker">驾驶里程</p>
              <div className="chart-headline">
                {fmt(stats.distance)}
                <span>km</span>
              </div>
            </div>
            <span className="muted-badge">最近 {days} 天</span>
          </div>
          {stats.driveCount ? <MileageChart rows={stats.daily} /> : <NoData />}
          <div className="chart-footer">
            <span>
              <i className="legend-dot" />
              每日行驶里程
            </span>
            <span>{stats.driveCount} 次行程</span>
          </div>
        </section>
      </div>
      <div className="metrics-grid">
        <Metric
          icon={Gauge}
          label="平均能耗 · 估算"
          value={fmt(stats.consumption)}
          unit="kWh/100 km"
          note="按额定续航变化估算"
        />
        <Metric
          icon={Zap}
          label="充入电量"
          value={fmt(stats.energy)}
          unit="kWh"
          note={`${stats.chargeCount} 次充电记录`}
        />
        <Metric
          icon={ChartNoAxesCombined}
          label="充电费用"
          value={`${currency} ${fmt(costs.value, 2)}`}
          note={
            costs.needsServerUpdate ? '数据服务需升级，暂不合计估算费用' :
            [costs.estimated ? `含 ${costs.estimated} 次估算` : '已记录费用合计', costs.missing ? `${costs.missing} 次费用未记录` : ''].filter(Boolean).join(' · ')
          }
        />
        <Metric
          icon={Route}
          label="累计里程"
          value={fmt(s.odometer, 0)}
          unit="km"
          note="车辆里程表读数"
        />
      </div>
      <div className="lower-grid">
        <section className="panel">
          <SectionTitle
            title="最近行程"
            action="全部行程"
            onClick={() => onNavigate('drives')}
          />
          {data.drives.length ? (
            data.drives
              .slice(0, 3)
              .map((d) => (
                <DriveRow key={d.id} drive={d} onClick={() => onDrive(d)} />
              ))
          ) : (
            <NoData />
          )}
        </section>
        <section className="panel last-charge">
          <SectionTitle
            title="最近充电"
            action={last ? '查看详情' : undefined}
            onClick={() => last && onCharge(last)}
          />
          {last ? (
            <>
              <div className="charge-place">
                <span className="charge-icon">
                  <Zap size={23} />
                </span>
                <div>
                  <strong>{last.location}</strong>
                  <p className="subtle">
                    {fmt(last.duration, 0)} 分钟 · {dateLabel(last.date)}
                  </p>
                </div>
              </div>
              <div className="charge-level">
                <span>{fmt(last.startBattery, 0)}%</span>
                <Progress
                  value={last.endBattery ?? 0}
                  aria-label="充电结束电量"
                  className="charge-meter"
                />
                <strong>{fmt(last.endBattery, 0)}%</strong>
              </div>
              <div className="charge-bottom">
                <div>
                  <small>充入电量</small>
                  <strong>
                    {fmt(last.energy)} <span>kWh</span>
                  </strong>
                </div>
                <div>
                  <small>本次费用{lastCost?.estimated ? ' · 估算' : ''}</small>
                  <strong>
                    {lastCost?.value == null
                      ? '未记录'
                      : `${currency} ${fmt(lastCost.value, 2)}`}
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <NoData />
          )}
        </section>
      </div>
    </>
  );
}
export function BatteryView({ data, days }: { data: Dashboard; days: number }) {
  const since = summarize(data, days).since;
  const history = data.battery.filter(
    (b) => new Date(b.date + 'T23:59:59+08:00') >= since,
  );
  return (
    <>
      <div className="metrics-grid battery-metrics">
        <Metric
          icon={Battery}
          label="已记录电量"
          value={fmt(data.status.battery, 0)}
          unit="%"
          note="车辆最后一次记录"
        />
        <Metric
          icon={Route}
          label="额定续航"
          value={fmt(data.status.range, 0)}
          unit="km"
          note="当前电量下的额定续航"
        />
        <Metric
          icon={Gauge}
          label="满电续航 · 估算"
          value={fmt(history.at(-1)?.range, 0)}
          unit="km"
          note="最近充电记录按比例换算"
        />
      </div>
      <section className="panel">
        <SectionTitle title="满电额定续航趋势" />
        <p className="subtle">
          使用充电结束电量 ≥ 50% 的记录，按电量比例换算。
        </p>
        {history.length ? (
          <ChartContainer
            config={{
              range: { label: '满电额定续航 km', color: 'var(--chart-color)' },
            }}
            className="battery-chart"
          >
            <AreaChart data={history}>
              <CartesianGrid vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => d.slice(5)}
                minTickGap={30}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={['dataMin - 10', 'dataMax + 10']}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => String(Math.round(v))}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="range"
                stroke="var(--chart-color)"
                fill="var(--chart-color)"
                fillOpacity={0.12}
                strokeWidth={2}
                dot={history.length === 1}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <NoData title="还没有足够的充电记录" />
        )}
        <p className="note">
          <CircleHelp size={16} />
          这不是电池健康检测结果。温度、BMS
          校准和充电时的电量都会影响估算，短期波动不能直接判断电池衰减。
        </p>
      </section>
      <section className="panel vehicle-details">
        <SectionTitle title="车辆状态" />
        <div className="detail-stats">
          {['左前胎压', '右前胎压', '左后胎压', '右后胎压'].map((label, i) => (
            <div key={label}>
              <small>{label}</small>
              <strong>
                {fmt(data.status.tires[i], 1)} <em>bar</em>
              </strong>
              <small className="telemetry-time">
                {telemetryLabel(
                  data.status.tireSources?.[i],
                  data.status.tiresRecordedAt?.[i],
                )}
              </small>
            </div>
          ))}
        </div>
        <div className="detail-stats">
          <div><small>车辆软件版本</small><strong>{data.status.version || '暂无记录'}</strong>
            <small className="telemetry-time">{data.status.versionSource === 'database'
              ? `TeslaMate 升级记录${data.status.versionRecordedAt ? ` · ${dateLabel(data.status.versionRecordedAt, true)}` : ''}`
              : data.status.version ? `${data.status.versionSource === 'cache' ? '缓存的' : ''}MQTT 版本${data.status.versionReceivedAt ? ` · 收到于 ${dateLabel(data.status.versionReceivedAt, true)}` : ''}`
              : data.status.versionUnavailable === 'permission' ? '只读账号需要增加 updates 表的 SELECT 权限'
              : '尚无已完成升级记录，也未收到 MQTT 版本'}</small>
          </div>
          <div><small>哨兵模式 · 最近已知状态</small><strong>{data.status.sentry == null ? '尚未收到' : data.status.sentry ? '已开启' : '已关闭'}</strong>
            <small className="telemetry-time">{data.status.sentry == null
              ? '等待 TeslaMate MQTT 上报；此项没有数据库历史记录'
              : `${data.status.sentrySource === 'cache' ? '使用缓存 · ' : ''}${data.status.sentryReceivedAt ? `收到于 ${dateLabel(data.status.sentryReceivedAt, true)} · ` : ''}非实时确认，车辆休眠时可能不更新`}</small>
          </div>
        </div>
      </section>
    </>
  );
}
