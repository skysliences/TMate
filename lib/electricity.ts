import { summarize, type Charge, type Dashboard } from './data.ts';
export function parseElectricityPrice(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/.test(text) || Number(text) > 1000) throw new Error('请输入 0–1000 之间的单价，最多 4 位小数；留空关闭估算');
  return Number(text);
}
export function chargeCost(charge: Charge, price: number | null) {
  if (charge.cost != null && Number.isFinite(charge.cost)) return { value: charge.cost, estimated: false, basis: 'recorded' as const };
  const grid = charge.used != null && Number.isFinite(charge.used) && charge.used >= 0;
  const energy = grid ? charge.used : charge.energy;
  if (price == null || !Number.isFinite(price) || price < 0 || energy == null || !Number.isFinite(energy) || energy < 0) return { value: null, estimated: false, basis: null };
  return { value: energy * price, estimated: true, basis: grid ? 'grid' as const : 'added' as const };
}
export function chargingCostSummary(data: Dashboard, days: number, price: number | null) {
  const stats = summarize(data, days);
  if (price == null) return { value: stats.cost, estimated: 0, missing: stats.missingCosts, needsServerUpdate: false };
  if (data.totals) {
    const { missingCostEnergy, estimableCosts } = data.totals;
    if (missingCostEnergy == null || estimableCosts == null) return { value: stats.cost, estimated: 0, missing: stats.missingCosts, needsServerUpdate: stats.missingCosts > 0 };
    return { value: stats.cost + missingCostEnergy * price, estimated: estimableCosts, missing: Math.max(0, stats.missingCosts - estimableCosts), needsServerUpdate: false };
  }
  const values = data.charges.filter(c => new Date(c.date) >= stats.since).map(c => chargeCost(c, price));
  return { value: values.reduce((sum, c) => sum + (c.value ?? 0), 0), estimated: values.filter(c => c.estimated).length, missing: values.filter(c => c.value == null).length, needsServerUpdate: false };
}
