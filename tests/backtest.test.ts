import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backtest } from '../src/lib/backtest';
import type { Fill } from '../src/lib/perpl';

// BTC-like market: price in 0.1 units, size in 1e-5 units.
const M = [{ id: 16, priceDecimals: 1, sizeDecimals: 5 }];
let seq = 0;
const f = (t: number, price: number, size: number): Fill => ({ at: { b: 0, t: ++seq * 1000, txid: String(seq) }, mkt: 16, acc: 1, t, p: price * 10, s: size });
const rules = { ratioBps: 5000, maxNotional: 1_000_000, leverage: 1, maxLoss: 100 };

// Newest-first, as Perpl returns them.
const newestFirst = (...xs: Fill[]) => xs.reverse();

test('a winning long at 50% earns half the leader PnL', () => {
  seq = 0;
  // Leader: buy 1 BTC (100,000 units) at 80,000, sell at 81,000 -> +1,000; follower half -> +500.
  const r = backtest(newestFirst(f(1, 80_000, 100_000), f(3, 81_000, 100_000)), rules, M);
  assert.equal(Math.round(r.pnl), 500);
  assert.equal(r.trades, 2);
});

test('a losing short loses, and an open position is marked at the last fill', () => {
  seq = 0;
  const r = backtest(newestFirst(f(2, 80_000, 100_000), f(2, 82_000, 100_000)), rules, M);
  // Short 0.5 @80k then 0.5 more @82k: avg 81k, marked at 82k -> -1,000.
  assert.equal(Math.round(r.pnl), -1000);
});

test('the notional cap limits size, and closes before our window are ignored', () => {
  seq = 0;
  const capped = { ...rules, maxNotional: 800 }; // 800 AUSD at 80k = 0.01 BTC
  const r = backtest(newestFirst(f(4, 79_000, 50_000), f(1, 80_000, 100_000), f(3, 81_000, 100_000)), capped, M);
  assert.equal(Math.round(r.pnl), 10); // 0.01 BTC x +1,000
  assert.equal(r.trades, 2);
});
