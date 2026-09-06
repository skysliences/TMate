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

// ChartTooltipContent may replace a numeric X-axis label with the series name.
// The timestamp belongs to the underlying sample, never to that display label.
export function chartTooltipLabel(
  _label: unknown,
  payload?: readonly { payload?: { time?: unknown } }[],
): string {
  const sample = payload?.find((item) => chartDate(item.payload?.time));
  return chartTimeLabel(sample?.payload?.time, true);
}
