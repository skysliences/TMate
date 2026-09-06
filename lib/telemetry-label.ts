import type { TelemetrySource } from './data';

export function telemetryLabel(
  source?: TelemetrySource,
  recordedAt?: string | null,
) {
  if (source === 'mqtt') return 'MQTT · 测量时间未提供';
  if (!source) return '暂无有效记录';
  if (!recordedAt || !Number.isFinite(Date.parse(recordedAt)))
    return '记录时间未提供';
  const date = new Date(recordedAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
  return `${source === 'demo' ? '演示记录' : '最后记录'} · ${date}`;
}
