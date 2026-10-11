'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Leaderboard as Board, Trader } from '@/lib/leaderboard';
import type { Market } from '@/lib/perpl';
import { Avatar, Card, ErrorLine, pnlClass, short, Spinner } from './ui';

const SOURCE = { 'envio-indexer': 'Envio HyperIndex', 'envio-hypersync': 'Envio HyperSync', rpc: 'Monad RPC' } as const;

type Props = { onPick: (t: Trader) => void; picked?: string; markets: Market[] };

export function Leaderboard({ onPick, picked, markets }: Props) {
  const [board, setBoard] = useState<Board>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const symbol = (id: number) => markets.find((m) => m.id === id)?.symbol ?? `#${id}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await fetch('/api/leaderboard');
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `leaderboard -> ${r.status}`);
      setBoard(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <Card
      title="Top traders"
      action={
        <button type="button" onClick={load} disabled={loading} className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs text-[var(--muted)] hover:text-[var(--text)]" aria-label="Refresh leaderboard">
          {loading ? <Spinner /> : '↻'} Refresh
        </button>
      }
    >
      {!board && !error && <p className="py-6 text-center text-sm text-[var(--muted)]">Reading Perpl trades…</p>}
      <ErrorLine error={error} />
      {board && board.traders.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted)]">No trader activity in this window yet.</p>}
      <ul className="-mx-2 space-y-1">
        {board?.traders.map((t, i) => {
          const on = picked === t.accountId;
          return (
            <li key={t.accountId}>
              <button
                type="button"
                onClick={() => onPick(t)}
                aria-pressed={on}
                className={`flex min-h-16 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition motion-reduce:transition-none ${on ? 'bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/60' : 'hover:bg-[var(--card-2)]'}`}
              >
                <span className="w-5 text-center text-sm text-[var(--muted)]">{i + 1}</span>
                <Avatar address={t.address} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{t.label ? t.label.replace(/^Demo bot · /, '') : short(t.address)}</span>
                    {t.label && <span className="shrink-0 rounded-full bg-[var(--line)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Demo bot</span>}
                  </span>
                  {t.blurb && <span className="mt-0.5 block text-xs leading-snug text-[var(--text)]/80">{t.blurb}</span>}
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                    {t.closes ? `${Math.round(t.winRate * 100)}% win · ${t.closes} close${t.closes === 1 ? '' : 's'}` : `${t.trades} trade${t.trades === 1 ? '' : 's'}`} · {t.markets.slice(0, 3).map(symbol).join(' ')}
                  </span>
                </span>
                <span className={`text-right font-mono text-sm ${pnlClass(t.realizedPnl)}`}>
                  {t.realizedPnl >= 0 ? '+' : ''}
                  {t.realizedPnl.toFixed(2)}
                  <span className="block text-[10px] text-[var(--muted)]">AUSD</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {board && (
        <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
          Realized PnL, {board.window}, from Perpl on-chain events via {SOURCE[board.source]}. Market makers are excluded.
        </p>
      )}
    </Card>
  );
}
