import type { Dashboard } from './data';
import { summarize } from './data';
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
export function registerSummaryTool(
  getState: () => {
    data: Dashboard | null;
    days: number;
    demo: boolean;
    stale: boolean;
  },
) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (
          tool: Tool,
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const tool: Tool = {
    name: 'read_vehicle_summary',
    title: '读取车辆数据摘要',
    description:
      '读取页面当前所选车辆和日期范围的统计，包含是否为演示数据及是否过期。不返回行程地址或访问密钥。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error('不接受参数');
      const { data, days, demo, stale } = getState();
      if (!data) throw new Error('数据尚未加载');
      const s = summarize(data, days);
      return {
        demo,
        stale,
        carId: data.car.id,
        asOf: data.asOf,
        days,
        battery: data.status.battery,
        distance: s.distance,
        driveCount: s.driveCount,
        chargeEnergy: s.energy,
        chargeCost: s.cost,
      };
    },
  };
  try {
    Promise.resolve(
      context.registerTool(tool, { signal: controller.signal }),
    ).catch(() => {});
  } catch {}
  return () => controller.abort();
}
