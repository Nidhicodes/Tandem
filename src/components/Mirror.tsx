'use client';
/**
 * Live mirror: the leader's position next to yours in each market, plus one timeline of the
 * leader's fills and your copies with the lag between them ("copied 3s later").
 * Positions come from the Exchange contract; fills from Perpl (yours via your own read key,
 * the leader's via /api/activity for Tandem's demo bots).
 */
import { useEffect, useState } from 'react';
import { positionsOf, type Pos } from '@/lib/onchain';
import type { Trader } from '@/lib/leaderboard';
import { perplClient, type Fill, type Market } from '@/lib/perpl';
import type { Keys } from '@/lib/keys';
import { timeline, type Event } from '@/lib/timeline';
import { Card, short } from './ui';

const VERB = { 1: 'Opened long', 2: 'Opened short', 3: 'Closed long', 4: 'Closed short' } as Record<number, string>;
const scale = (v: bigint | number, d: number) => Number(v) / 10 ** d;
/** Time today, otherwise a short date too. */
const when = (ms: number) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
};
const side = (lot: bigint) => (lot > 0n ? 'LONG' : lot < 0n ? 'SHORT' : 'FLAT');

type Row = { m: Market; leader: Pos; you: Pos };
/** `keys`/`apiKey` are absent in read-only mode, where `follower` is another Tandem user and `you` labels them. */
type Props = { keys?: Keys; apiKey?: string; follower?: bigint; trader: Trader; markets: Market[]; copying: boolean; you?: string };

export function Mirror({ keys, apiKey, follower, trader, markets, copying, you: youLabel = 'You' }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<Event[]>();
  const name = trader.label?.replace(/^Demo bot · /, '') ?? short(trader.address);
  const meta = (id: number) => markets.find((m) => m.id === id);

  useEffect(() => {
    let live = true;
    const mine = keys && apiKey ? perplClient(keys.perpl, apiKey) : undefined;
    const ms = markets.filter((m) => m.config.is_open && trader.markets.includes(m.id));
    async function poll() {
      const leaderId = BigInt(trader.accountId);
      const [pos, lf, yf] = await Promise.all([
        positionsOf(ms.flatMap((m) => [[m.id, leaderId], [m.id, follower ?? leaderId]] as [number, bigint][])),
        fetch(`/api/activity?leader=${trader.accountId}`).then((r) => r.json()).then((b) => (b.fills ?? []) as Fill[]).catch(() => []),
        copying && mine ? mine.fills().catch(() => [] as Fill[]) : Promise.resolve([] as Fill[]),
      ]);
      if (!live) return;
      setRows(ms.map((m, i) => ({ m, leader: pos[2 * i], you: pos[2 * i + 1] })).filter((r) => r.leader.lot !== 0n || r.you.lot !== 0n));
      setEvents(timeline(lf, yf.filter((f) => trader.markets.includes(f.mkt))));
    }
    const tick = () => poll().catch(() => undefined);
    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [keys, apiKey, follower, trader, markets, copying]);

  return (
    <Card title={copying ? (keys ? 'Live mirror' : `Live: a Tandem user copying ${name}`) : `What ${name} is doing`}>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{name} is flat right now. {copying ? (keys ? 'Your agent will mirror their next trade.' : 'Their followers will mirror the next trade.') : ''}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ m, leader, you }) => {
            const lead = scale(leader.lot < 0n ? -leader.lot : leader.lot, m.config.size_decimals);
            const mineSize = scale(you.lot < 0n ? -you.lot : you.lot, m.config.size_decimals);
            const synced = Math.sign(Number(leader.lot)) === Math.sign(Number(you.lot));
            return (
              <li key={m.id} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2 rounded-2xl bg-[var(--card-2)] px-3 py-2 text-sm">
                <span className="font-medium">{m.symbol}</span>
                <span>
                  <span className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">{name}</span>
                  <Side lot={leader.lot} size={lead} />
                </span>
                <span>
                  <span className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">{youLabel}</span>
                  {copying ? <Side lot={you.lot} size={mineSize} /> : <span className="text-[var(--muted)]">not copying</span>}
                  {copying && <span className={`ml-1 text-[10px] ${synced ? 'text-[var(--up)]' : 'text-amber-400'}`}>{synced ? '✓ in sync' : '⟳ copying'}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {events && events.length > 0 && (
        <ol className="mt-4 space-y-2 border-l border-[var(--line)] pl-3" aria-label="Recent trades">
          {events.map(({ who, f, lag, joined }) => {
            const m = meta(f.mkt);
            return (
              <li key={`${who}-${f.at.txid}-${f.t}`} className="relative text-sm">
                <span className={`absolute -left-[17px] top-1.5 h-2 w-2 rounded-full ${who === 'you' ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]'}`} aria-hidden />
                <span className="font-medium">{who === 'you' ? youLabel : name}</span>{' '}
                <span className="text-[var(--muted)]">
                  {VERB[f.t] ?? 'Traded'} {m ? `${scale(f.s, m.config.size_decimals)} ${m.symbol} @ ${scale(f.p, m.config.price_decimals).toLocaleString()}` : `market ${f.mkt}`}
                </span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {when(f.at.t)}
                  {who === 'you' && lag !== undefined && <span className="ml-1 text-[var(--up)]">· copied {lag}s later</span>}
                  {who === 'you' && joined && <span className="ml-1">· joined their open position</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {events && events.length === 0 && trader.label === undefined && <p className="mt-3 text-xs text-[var(--muted)]">Trade history is shown for Tandem's demo bots; for other traders you see their live positions.</p>}
    </Card>
  );
}

const Side = ({ lot, size }: { lot: bigint; size: number }) =>
  lot === 0n ? (
    <span className="text-[var(--muted)]">FLAT</span>
  ) : (
    <span className={lot > 0n ? 'text-[var(--up)]' : 'text-[var(--down)]'}>
      {side(lot)} <span className="font-mono text-[var(--text)]">{size}</span>
    </span>
  );
