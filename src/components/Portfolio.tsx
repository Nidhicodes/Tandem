'use client';
import { useEffect, useState } from 'react';
import { exchangeAccountOf, positionsOf, type Pos } from '@/lib/onchain';
import type { Market } from '@/lib/perpl';
import { Card, Row } from './ui';

const AUSD = (cns: bigint) => (Number(cns) / 1e6).toFixed(2);
const signed = (cns: bigint) => `${cns >= 0n ? '+' : ''}${AUSD(cns)}`;
const scale = (v: bigint, decimals: number) => Number(v) / 10 ** decimals;

type Row = { m: Market; p: Pos };

/** Live account balance and open positions, polled from the Exchange contract. */
export function Portfolio({ address, exchangeId, markets }: { address: `0x${string}`; exchangeId: bigint; markets: Market[] }) {
  const [balance, setBalance] = useState<bigint>();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let live = true;
    const open = markets.filter((m) => m.config.is_open);
    async function poll() {
      const [acc, ps] = await Promise.all([exchangeAccountOf(address), positionsOf(open.map((m) => [m.id, exchangeId]))]);
      if (!live) return;
      setBalance(acc?.balance);
      setRows(open.map((m, i) => ({ m, p: ps[i] })).filter((r) => r.p.lot !== 0n));
    }
    const tick = () => poll().catch(() => undefined);
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [address, exchangeId, markets]);

  const totalPnl = rows.reduce((s, r) => s + r.p.pnl, 0n);
  const margin = rows.reduce((s, r) => s + r.p.deposit, 0n);

  return (
    <Card title="Portfolio">
      <Row k="Free balance" v={balance === undefined ? '…' : `${AUSD(balance)} AUSD`} />
      <Row k="In positions" v={`${AUSD(margin)} AUSD`} />
      <Row k="Open PnL" v={<span className={totalPnl >= 0n ? 'text-emerald-400' : 'text-red-400'}>{signed(totalPnl)} AUSD</span>} />
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No open positions. Pick a trader below to start copying.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {rows.map(({ m, p }) => {
            const long = p.lot > 0n;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${long ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {long ? 'LONG' : 'SHORT'}
                  </span>
                  <span className="font-medium">{m.symbol}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {scale(long ? p.lot : -p.lot, m.config.size_decimals)} @ {scale(p.entry, m.config.price_decimals)} · mark {scale(p.mark, m.config.price_decimals)}
                  </span>
                </span>
                <span className={`font-mono ${p.pnl >= 0n ? 'text-emerald-400' : 'text-red-400'}`}>{signed(p.pnl)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
