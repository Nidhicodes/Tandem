import type { Fill } from './perpl';

export type Event = { who: 'leader' | 'you'; f: Fill; lag?: number };

/** Merge both fill streams newest-first and attach, to each of yours, the delay since the leader's matching fill. */
export function timeline(leader: Fill[], you: Fill[], limit = 10): Event[] {
  const events: Event[] = [
    ...leader.map((f) => ({ who: 'leader' as const, f })),
    ...you.map((f) => {
      const src = leader.filter((l) => l.mkt === f.mkt && l.t === f.t && l.at.t <= f.at.t).sort((a, b) => b.at.t - a.at.t)[0];
      const lag = src ? Math.round((f.at.t - src.at.t) / 1000) : undefined;
      return { who: 'you' as const, f, lag: lag !== undefined && lag < 600 ? lag : undefined };
    }),
  ];
  return events.sort((a, b) => b.f.at.t - a.f.at.t).slice(0, limit);
}
