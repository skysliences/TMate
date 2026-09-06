import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeCost, chargingCostSummary, parseElectricityPrice } from './electricity.ts';
import { makeDemo } from './data.ts';
void test('electricity price permits zero, blanks and four decimal places, rejects unsafe values', () => {
  assert.equal(parseElectricityPrice(' '), null);
  assert.equal(parseElectricityPrice('0'), 0);
  assert.equal(parseElectricityPrice('0.5678'), 0.5678);
  for (const value of ['-1', 'NaN', 'Infinity', '1e2', '0.12345', '1001', '1,2']) assert.throws(() => parseElectricityPrice(value));
});
void test('recorded cost including zero always wins; estimates use grid energy then added energy', () => {
  const charge = { ...makeDemo().charges[0], cost: null, used: 40, energy: 35 };
  assert.deepEqual(chargeCost(charge, 0.5), { value: 20, estimated: true, basis: 'grid' });
  assert.equal(chargeCost({ ...charge, cost: 0 }, 0.5).value, 0);
  assert.equal(chargeCost({ ...charge, cost: 9 }, 0.5).value, 9);
  assert.equal(chargeCost({ ...charge, used: null }, 0.5).value, 17.5);
  assert.equal(chargeCost({ ...charge, used: 0 }, 0.5).value, 0);
  assert.equal(chargeCost(charge, 0).value, 0);
  assert.equal(chargeCost(charge, null).value, null);
  assert.equal(chargeCost({ ...charge, used: -1, energy: NaN }, 0.5).value, null);
  assert.equal(chargeCost(charge, NaN).value, null);
});
void test('cost totals use full server aggregates, not the limited first page; older servers are explicit', () => {
  const data = makeDemo();
  data.totals = { distance: 0, driveCount: 0, energy: 3500, chargeCount: 100, cost: 100, missingCosts: 90, missingCostEnergy: 3600, estimableCosts: 90, consumption: null };
  assert.deepEqual(chargingCostSummary(data, 30, 0.5), { value: 1900, estimated: 90, missing: 0, needsServerUpdate: false });
  delete data.totals.estimableCosts;
  assert.deepEqual(chargingCostSummary(data, 30, 0.5), { value: 100, estimated: 0, missing: 90, needsServerUpdate: true });
  assert.equal(chargingCostSummary(makeDemo(), 30, 0.5).estimated, 0);
});
