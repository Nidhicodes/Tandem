'use client';
import { useEffect, useState } from 'react';
import { exchangeAccountOf, positionsOf, type Pos } from '@/lib/onchain';
import type { Market } from '@/lib/perpl';
import { Card, pnlClass } from './ui';

const AUSD = (cns: bigint) => (Number(cns) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (cns: bigint) => `${cns >= 0n ? '+' : '−'}${AUSD(cns >= 0n ? cns : -cns)}`;
const scale = (v: bigint, decimals: number) => Number(v) / 10 ** decimals;

type Line = { m: Market; p: Pos };

/** Live equity and open positions, polled from the Perpl Exchange contract every 5s. */
export function Portfolio({ address, exchangeId, markets }: { address: `0x${string}`; exchangeId: bigint; markets: Market[] }) {
  const [balance, setBalance] = useState<bigint>();
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    let live = true;
    const open = markets.filter((m) => m.config.is_open);
    async function poll() {
      const [acc, ps] = await Promise.all([exchangeAccountOf(address), positionsOf(open.map((m) => [m.id, exchangeId]))]);
      if (!live) return;
      setBalance(acc?.balance);
      setLines(open.map((m, i) => ({ m, p: ps[i] })).filter((r) => r.p.lot !== 0n));
    }
    const tick = () => poll().catch(() => undefined);
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [address, exchangeId, markets]);

  const pnl = lines.reduce((s, r) => s + r.p.pnl, 0n);
  const margin = lines.reduce((s, r) => s + r.p.deposit, 0n);
  const equity = balance === undefined ? undefined : balance + margin + pnl;

  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Account value</p>
      <p className="mt-1 font-mono text-4xl font-semibold tracking-tight">
        {equity === undefined ? '…' : AUSD(equity)}
        <span className="ml-1.5 text-base font-normal text-[var(--muted)]">AUSD</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Open PnL" value={<span className={pnlClass(pnl)}>{signed(pnl)}</span>} />
        <Stat label="In positions" value={AUSD(margin)} />
        <Stat label="Free" value={balance === undefined ? '…' : AUSD(balance)} />
      </div>
      {lines.length === 0 ? (
        <p className="mt-4 text-center text-sm text-[var(--muted)]">No open positions yet. Pick a trader below to copy.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {lines.map(({ m, p }) => {
            const long = p.lot > 0n;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${long ? 'bg-[var(--up)]/15 text-[var(--up)]' : 'bg-[var(--down)]/15 text-[var(--down)]'}`}>
                    {long ? 'LONG' : 'SHORT'}
                  </span>
                  <span>
                    <span className="font-medium">{m.symbol}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {scale(long ? p.lot : -p.lot, m.config.size_decimals)} @ {scale(p.entry, m.config.price_decimals).toLocaleString()}
                    </span>
                  </span>
                </span>
                <span className={`font-mono ${pnlClass(p.pnl)}`}>{signed(p.pnl)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-2xl bg-[var(--card-2)] px-2 py-2">
    <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
    <p className="mt-0.5 font-mono text-sm">{value}</p>
  </div>
);
