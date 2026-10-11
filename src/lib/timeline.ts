import type { Fill } from './perpl';

/** lag: seconds behind the leader's matching fill. joined: you entered an already-open position (started copying later). */
export type Event = { who: 'leader' | 'you'; f: Fill; lag?: number; joined?: boolean; slipBps?: number };

/** Price difference vs the leader's fill, in bps; positive = you paid more (buys) or got less (sells). */
export const slippageBps = (mine: Fill, leader: Fill) => {
  const buy = mine.t === 1 || mine.t === 4; // open long, close short
  return Math.round(((buy ? mine.p - leader.p : leader.p - mine.p) / leader.p) * 10_000);
};

/** Average lag and slippage over the matched copies in a timeline. */
export function copyQuality(events: Event[]) {
  const matched = events.filter((e) => e.lag !== undefined);
  if (!matched.length) return undefined;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { copies: matched.length, lag: avg(matched.map((e) => e.lag!)), slipBps: avg(matched.map((e) => e.slipBps ?? 0)) };
}

/** Merge both fill streams newest-first and attach, to each of yours, the delay since the leader's matching fill. */
export function timeline(leader: Fill[], you: Fill[], limit = 8): Event[] {
  const events: Event[] = [
    ...leader.map((f) => ({ who: 'leader' as const, f })),
    ...you.map((f) => {
      const src = leader.filter((l) => l.mkt === f.mkt && l.t === f.t && l.at.t <= f.at.t).sort((a, b) => b.at.t - a.at.t)[0];
      const lag = src ? Math.round((f.at.t - src.at.t) / 1000) : undefined;
      // A real copy lands within a heartbeat or two; a long gap means you joined late.
      return lag !== undefined && lag <= 60 ? { who: 'you' as const, f, lag, slipBps: slippageBps(f, src!) } : { who: 'you' as const, f, joined: lag !== undefined && lag < 6 * 3600 };
    }),
  ];
  return events.sort((a, b) => b.f.at.t - a.f.at.t).slice(0, limit);
}
