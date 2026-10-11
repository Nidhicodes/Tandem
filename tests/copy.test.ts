// Planner tests. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capLot, lossBreached, plan, significant, targetLot, type Rules } from '../src/lib/copy';

// BTC on Perpl testnet: price_decimals 1, size_decimals 5.
const BTC = { id: 16, priceDecimals: 1, sizeDecimals: 5 };
const mark = 1_000_000n; // $100,000.0
const rules: Rules = { ratioBps: 1000, maxNotional: 50, leverage: 2, maxLoss: 20 };

test('capLot converts an AUSD cap into a lot at the mark price', () => {
  // $50 at $100k = 0.0005 BTC = 50 lots at 5 decimals
  assert.equal(capLot(50, mark, BTC), 50n);
  assert.equal(capLot(50, 0n, BTC), 0n);
});

test('targetLot scales by ratio and keeps the leader side', () => {
  assert.equal(targetLot(300n, mark, rules, BTC), 30n); // 10% of a 300-lot long
  assert.equal(targetLot(-300n, mark, rules, BTC), -30n);
});

test('targetLot clamps to the notional cap on both sides', () => {
  assert.equal(targetLot(10_000n, mark, rules, BTC), 50n);
  assert.equal(targetLot(-10_000n, mark, rules, BTC), -50n);
});

test('plan opens, grows, trims and closes', () => {
  assert.deepEqual(plan(0n, 30n, 16), [{ mkt: 16, t: 1, s: 30 }]);
  assert.deepEqual(plan(0n, -30n, 16), [{ mkt: 16, t: 2, s: 30 }]);
  assert.deepEqual(plan(10n, 30n, 16), [{ mkt: 16, t: 1, s: 20 }]);
  assert.deepEqual(plan(30n, 10n, 16), [{ mkt: 16, t: 3, s: 20 }]);
  assert.deepEqual(plan(-30n, 0n, 16), [{ mkt: 16, t: 4, s: 30 }]);
  assert.deepEqual(plan(30n, 30n, 16), []);
});

test('plan flips by closing first, then opening the other side', () => {
  assert.deepEqual(plan(30n, -20n, 16), [
    { mkt: 16, t: 3, s: 30 },
    { mkt: 16, t: 2, s: 20 },
  ]);
  assert.deepEqual(plan(-30n, 20n, 16), [
    { mkt: 16, t: 4, s: 30 },
    { mkt: 16, t: 1, s: 20 },
  ]);
});

test('significant ignores dust drift but not real moves', () => {
  assert.equal(significant(1000n, 1001n), false); // 0.1%
  assert.equal(significant(1000n, 1100n), true); // 10%
  assert.equal(significant(0n, 1n), true); // opening is always significant
  assert.equal(significant(5n, 5n), false);
});

test('lossBreached compares 6-decimal AUSD PnL with the cap', () => {
  assert.equal(lossBreached(-19_000_000n, rules), false);
  assert.equal(lossBreached(-20_000_001n, rules), true);
});
