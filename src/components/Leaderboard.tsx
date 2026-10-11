'use client';
import { useEffect, useState } from 'react';
import type { Leaderboard as Board, Trader } from '@/lib/leaderboard';
import { Card, ErrorLine, short } from './ui';

export function Leaderboard({ onPick, picked }: { onPick: (t: Trader) => void; picked?: string }) {
  const [board, setBoard] = useState<Board>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    fetch('/api/leaderboard')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error))))
      .then((b) => live && setBoard(b))
      .catch((e) => live && setError(e.message));
    return () => void (live = false);
  }, []);

  return (
    <Card title="Top traders on Perpl">
      {!board && !error && <p className="text-sm text-[var(--muted)]">Scanning Perpl trades…</p>}
      <ErrorLine error={error} />
      {board && board.traders.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No trader activity in this window yet.</p>
      )}
      <ul className="divide-y divide-[var(--line)]">
        {board?.traders.map((t, i) => (
          <li key={t.accountId}>
            <button
              type="button"
              onClick={() => onPick(t)}
              aria-pressed={picked === t.accountId}
              className={`flex w-full items-center justify-between gap-3 py-3 text-left ${picked === t.accountId ? 'text-[var(--accent)]' : ''}`}
            >
              <span>
                <span className="mr-2 text-[var(--muted)]">{i + 1}</span>
                <span className="font-mono">{short(t.address)}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {t.closes ? `${t.closes} closes · ${Math.round(t.winRate * 100)}% win` : `${t.trades} trades · no closes yet`}
                </span>
              </span>
              <span className={`font-mono ${t.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {t.realizedPnl >= 0 ? '+' : ''}
                {t.realizedPnl.toFixed(2)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {board && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Realized PnL in AUSD, blocks {board.fromBlock}–{board.toBlock} via {board.source === 'rpc' ? 'Monad RPC' : 'Envio HyperSync'}.
        </p>
      )}
    </Card>
  );
}
