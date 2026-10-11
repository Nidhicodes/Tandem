import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fill } from '../src/lib/perpl';
import { copyQuality, slippageBps, timeline } from '../src/lib/timeline';

const fill = (t: number, type: number, mkt = 16, txid = `${t}-${type}`): Fill => ({ at: { b: 0, t, txid }, mkt, acc: 1, t: type, p: 1, s: 1, f: '0' });

test('a copy is matched to the latest same-market, same-type leader fill before it', () => {
  const leader = [fill(10_000, 2), fill(50_000, 4)];
  const you = [fill(13_000, 2), fill(54_500, 4)];
  const ev = timeline(leader, you);
  assert.deepEqual(ev.map((e) => e.who), ['you', 'leader', 'you', 'leader']);
  assert.deepEqual(ev.filter((e) => e.who === 'you').map((e) => e.lag), [5, 3]); // 4.5s rounds to 5
});

test('late starters are marked as joining, not as a slow copy', () => {
  const ev = timeline([fill(0, 1)], [fill(1000, 2), fill(142_000, 1), fill(2000, 1, 32)]);
  const you = ev.filter((e) => e.who === 'you');
  assert.ok(you.every((e) => e.lag === undefined));
  assert.deepEqual(you.map((e) => !!e.joined), [true, false, false]);
});

test('slippage is positive when the copy filled worse than the leader', () => {
  const at = (p: number, t: number) => ({ ...fill(0, t), p });
  assert.equal(slippageBps(at(10_010, 1), at(10_000, 1)), 10); // bought 0.1% higher
  assert.equal(slippageBps(at(9_990, 2), at(10_000, 2)), 10); // sold 0.1% lower
  assert.equal(slippageBps(at(9_990, 1), at(10_000, 1)), -10); // bought cheaper: negative
});

test('copy quality averages matched copies only', () => {
  const q = copyQuality(timeline([fill(10_000, 2), fill(50_000, 4)], [fill(13_000, 2), fill(54_000, 4), fill(500_000, 1)]));
  assert.deepEqual(q, { copies: 2, lag: 3.5, slipBps: 0 });
});
