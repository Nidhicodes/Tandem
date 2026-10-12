'use client';
import { useEffect, useState } from 'react';
import { agentOf, AGENTS, listAgents } from '@/lib/agents';
import { capLot, plan } from '@/lib/copy';
import type { Keys } from '@/lib/keys';
import { positionsOf, type Pos } from '@/lib/onchain';
import { perplClient, type Market } from '@/lib/perpl';
import { Button, Card, ErrorLine, Field } from './ui';

const LEVERAGE = 3;
const SLIPPAGE_BPS = 100;
const IOC = 4;

type Props = { keys: Keys; apiKey: string; exchangeId: bigint; markets: Market[] };

/**
 * Lead mode: trade yourself with your own trade-only key, then share a copy link so others
 * mirror you. A 24/7 follower can't also lead (the engine would undo manual trades), so the
 * panel asks them to stop copying first.
 */
export function LeadPanel({ keys, apiKey, exchangeId, markets }: Props) {
  const open = markets.filter((m) => m.config.is_open);
  const [mkt, setMkt] = useState<number>();
  const [size, setSize] = useState(200);
  const [pos, setPos] = useState<Pos>();
  const [following, setFollowing] = useState<bigint>();
  const [followers, setFollowers] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const market = open.find((m) => m.id === mkt) ?? open[0];

  useEffect(() => {
    if (!AGENTS) return;
    void agentOf(keys.account.address).then((a) => setFollowing(a && !a.halted ? a.leader : undefined)).catch(() => undefined);
    void listAgents().then((as) => setFollowers(as.filter((a) => !a.halted && a.leader === exchangeId).length)).catch(() => undefined);
  }, [keys.account.address, exchangeId]);

  useEffect(() => {
    if (!market) return;
    let live = true;
    const read = () => positionsOf([[market.id, exchangeId]]).then(([p]) => live && setPos(p)).catch(() => undefined);
    void read();
    const t = setInterval(read, 5_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [market, exchangeId]);

  if (!market) return null;
  const meta = { id: market.id, priceDecimals: market.config.price_decimals, sizeDecimals: market.config.size_decimals };
  const lot = pos?.lot ?? 0n;
  const side = lot > 0n ? 'long' : lot < 0n ? 'short' : 'flat';

  /** Move this market to `dir` (1 long, -1 short, 0 flat) at `size` AUSD notional. */
  const trade = (dir: -1 | 0 | 1) => async () => {
    setError(undefined);
    setNote(undefined);
    setBusy(dir === 0 ? 'Closing' : dir > 0 ? 'Going long' : 'Going short');
    try {
      const [p] = await positionsOf([[market.id, exchangeId]]);
      const target = dir === 0 ? 0n : BigInt(dir) * capLot(size, p.mark, meta);
      if (dir !== 0 && target === 0n) throw new Error('Size is too small for this market.');
      const perpl = perplClient(keys.perpl, apiKey);
      const { lfr, id } = await perpl.account();
      const orders = plan(p.lot, target, market.id).map((o, i) => ({ ...o, rq: lfr + 1 + i, acc: id, p: 0, fl: IOC, lv: LEVERAGE * 100, lb: 0, ms: SLIPPAGE_BPS }));
      if (!orders.length) return setNote('Already there.');
      const statuses = await perpl.submit(orders);
      const bad = statuses.find((s) => s.code !== 0);
      if (bad) throw new Error(`Perpl refused the order (${bad.code}${bad.error ? `: ${bad.error}` : ''})`);
      setNote(followers ? `Sent. Your ${followers} follower${followers === 1 ? '' : 's'} will be copied within seconds.` : 'Sent. Share your link so others can copy you.');
      setTimeout(() => void positionsOf([[market.id, exchangeId]]).then(([q]) => setPos(q)), 2_500);
    } catch (e) {
      setError((e as Error).message.split('\n')[0]);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="space-y-3">
      <Card title="Lead: trade yourself, get copied" action={followers > 0 ? <span className="text-xs text-[var(--up)]">{followers} copying you</span> : undefined}>
        {following !== undefined ? (
          <p className="text-sm text-[var(--muted)]">
            You're copying #{following.toString()} 24/7, so your agent would undo manual trades. Stop copying to trade yourself and lead.
          </p>
        ) : (
          <>
            <div className="mb-3 flex gap-2" role="tablist" aria-label="Market">
              {open.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={m.id === market.id}
                  onClick={() => setMkt(m.id)}
                  className={`min-h-10 flex-1 rounded-xl border text-sm ${m.id === market.id ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)]'}`}
                >
                  {m.symbol}
                </button>
              ))}
            </div>
            <p className="mb-1 text-sm">
              Your {market.symbol} position: <span className={side === 'long' ? 'text-[var(--up)]' : side === 'short' ? 'text-[var(--down)]' : 'text-[var(--muted)]'}>{side}</span>
            </p>
            <Field label="Position size" value={size} onChange={setSize} suffix="AUSD" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button onClick={trade(1)} busy={busy === 'Going long' ? busy : undefined} disabled={!!busy}>Long</Button>
              <Button onClick={trade(-1)} busy={busy === 'Going short' ? busy : undefined} disabled={!!busy}>Short</Button>
              <Button variant="ghost" onClick={trade(0)} busy={busy === 'Closing' ? busy : undefined} disabled={!!busy || side === 'flat'}>Close</Button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted)]">Market order, {LEVERAGE}x, max {SLIPPAGE_BPS / 100}% slippage. Your record on the leaderboard is your on-chain PnL.</p>
            {note && <p className="mt-2 text-sm text-[var(--up)]" aria-live="polite">{note}</p>}
          </>
        )}
      </Card>
      <ErrorLine error={error} />
      {following === undefined && <ShareMe id={exchangeId} />}
    </section>
  );
}

function ShareMe({ id }: { id: bigint }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = `${location.origin}/?copy=${id}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Tandem', text: 'Copy my trades on Tandem: one Face ID, no seed phrase.', url });
      else await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch {
      /* share sheet closed */
    }
  };
  return (
    <Button variant="ghost" onClick={share}>
      {done ? '✓ Your copy link is ready' : '↗ Share my copy link'}
    </Button>
  );
}
