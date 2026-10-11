/**
 * "What you'd have made": replay a leader's fills (newest-first, as Perpl returns them) as a
 * follower at the given rules, filling at the leader's prices. Pure; no I/O.
 *
 * Deliberately simple and labelled as such in the UI: no fees, no slippage, no funding, and the
 * leader is assumed flat before the oldest fill we can see. Good enough to answer "is this
 * trader worth copying at my size?", not a performance claim.
 */
import { capLot, type MarketMeta, type Rules } from './copy';
import type { Fill } from './perpl';

const SIGN: Record<number, 1 | -1> = { 1: 1, 2: -1, 3: -1, 4: 1 }; // effect on the signed lot
const ratio = (lot: bigint, r: Rules) => (lot * BigInt(r.ratioBps)) / 10_000n;

export type Backtest = { pnl: number; trades: number; since?: number };

export function backtest(fills: Fill[], rules: Rules, markets: MarketMeta[]): Backtest {
  const byMarket = new Map<number, Fill[]>();
  for (const f of [...fills].sort((a, b) => a.at.t - b.at.t)) byMarket.set(f.mkt, [...(byMarket.get(f.mkt) ?? []), f]);

  let pnl = 0;
  let trades = 0;
  let since: number | undefined;
  for (const [mkt, fs] of byMarket) {
    const m = markets.find((x) => x.id === mkt);
    if (!m) continue;
    const toAusd = (lot: bigint, priceDelta: number) => (Number(lot) / 10 ** m.sizeDecimals) * (priceDelta / 10 ** m.priceDecimals);
    let leader = 0n; // signed lot
    let mine = 0n;
    let entry = 0; // average entry price of `mine`, scaled
    let last = 0;
    for (const f of fs) {
      const dir = SIGN[f.t];
      if (!dir) continue;
      const opening = f.t === 1 || f.t === 2;
      if (!opening && leader === 0n) continue; // closing something opened before our window
      leader += BigInt(dir) * BigInt(f.s);
      if (opening === false && Math.sign(Number(leader)) === -dir) leader = 0n; // never flip on a close
      const cap = capLot(rules.maxNotional, BigInt(f.p), m);
      const raw = ratio(leader, rules);
      const target = raw > cap ? cap : raw < -cap ? -cap : raw;
      if (target === mine) continue;
      since ??= f.at.t;
      trades++;
      // Realize PnL on whatever part of `mine` shrinks or flips; average in what grows.
      const shrinking = mine !== 0n && (target === 0n || Math.sign(Number(target)) !== Math.sign(Number(mine)) || (target > 0n ? target < mine : target > mine));
      if (shrinking) {
        const closed = Math.sign(Number(target)) === Math.sign(Number(mine)) ? mine - target : mine;
        pnl += toAusd(closed, f.p - entry);
        const rest = mine - closed;
        if (rest === 0n && target !== 0n) entry = f.p; // flipped: the new side opens here
        mine = target;
        if (mine === 0n) entry = 0;
      } else {
        const add = target - mine;
        entry = mine === 0n ? f.p : (entry * Number(mine) + f.p * Number(add)) / Number(target);
        mine = target;
      }
      last = f.p;
    }
    if (mine !== 0n) pnl += toAusd(mine, last - entry); // mark what's still open at the last fill
  }
  return { pnl, trades, since };
}
