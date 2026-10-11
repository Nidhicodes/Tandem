import type { Fill } from './perpl';

/** lag: seconds behind the leader's matching fill. joined: you entered an already-open position (started copying later). */
export type Event = { who: 'leader' | 'you'; f: Fill; lag?: number; joined?: boolean };

/** Merge both fill streams newest-first and attach, to each of yours, the delay since the leader's matching fill. */
export function timeline(leader: Fill[], you: Fill[], limit = 8): Event[] {
  const events: Event[] = [
    ...leader.map((f) => ({ who: 'leader' as const, f })),
    ...you.map((f) => {
      const src = leader.filter((l) => l.mkt === f.mkt && l.t === f.t && l.at.t <= f.at.t).sort((a, b) => b.at.t - a.at.t)[0];
      const lag = src ? Math.round((f.at.t - src.at.t) / 1000) : undefined;
      // A real copy lands within a heartbeat or two; a long gap means you joined late.
      return lag !== undefined && lag <= 60 ? { who: 'you' as const, f, lag } : { who: 'you' as const, f, joined: lag !== undefined && lag < 6 * 3600 };
    }),
  ];
  return events.sort((a, b) => b.f.at.t - a.f.at.t).slice(0, limit);
}
