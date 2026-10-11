import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fill } from '../src/lib/perpl';
import { timeline } from '../src/lib/timeline';

const fill = (t: number, type: number, mkt = 16, txid = `${t}-${type}`): Fill => ({ at: { b: 0, t, txid }, mkt, acc: 1, t: type, p: 1, s: 1, f: '0' });

test('a copy is matched to the latest same-market, same-type leader fill before it', () => {
  const leader = [fill(10_000, 2), fill(50_000, 4)];
  const you = [fill(13_000, 2), fill(54_500, 4)];
  const ev = timeline(leader, you);
  assert.deepEqual(ev.map((e) => e.who), ['you', 'leader', 'you', 'leader']);
  assert.deepEqual(ev.filter((e) => e.who === 'you').map((e) => e.lag), [5, 3]); // 4.5s rounds to 5
});

test('no lag for fills with no matching leader trade, or one >10 minutes old', () => {
  const ev = timeline([fill(0, 1)], [fill(1000, 2), fill(700_000, 1), fill(2000, 1, 32)]);
  assert.ok(ev.filter((e) => e.who === 'you').every((e) => e.lag === undefined));
});
