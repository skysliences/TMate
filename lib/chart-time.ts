import { dateLabel } from './data.ts';

function chartDate(value: unknown): Date | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
    return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function chartTimeLabel(value: unknown, full = false): string {
  const date = chartDate(value);
  if (!date) return full ? '时间未记录' : '—';
  const label = dateLabel(date.toISOString(), true);
  return full ? label : label.split(' ').at(-1)!;
}

export function chartTimeAxis(times: readonly number[]) {
  const valid = times.filter((time) => chartDate(time)).sort((a, b) => a - b);
  const start = valid[0] ?? 0;
  const end = valid.at(-1) ?? start;
  const span = end - start;
  const domain: [number, number] = span
    ? [start, end]
    : [start - 30000, end + 30000];
  const ticks = span
    ? [
        ...new Set(
          Array.from({ length: 4 }, (_, i) =>
            Math.round(start + (span * i) / 3),
          ),
        ),
      ]
    : [start];
  const formatTick = (value: unknown) => {
    const date = chartDate(value);
    if (!date) return '—';
    if (span >= 86400000) return chartTimeLabel(value, true);
    return date.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      ...(span < 300000 ? { second: '2-digit' } : {}),
      ...(span > 0 && span < 3000
        ? { fractionalSecondDigits: 3 as const }
        : {}),
    });
  };
  return { domain, ticks, formatTick };
}

// ChartTooltipContent may replace a numeric X-axis label with the series name.
// The timestamp belongs to the underlying sample, never to that display label.
export function chartTooltipLabel(
  _label: unknown,
  payload?: readonly { payload?: { time?: unknown } }[],
): string {
  const sample = payload?.find((item) => chartDate(item.payload?.time));
  return chartTimeLabel(sample?.payload?.time, true);
}
