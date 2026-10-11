'use client';
import { useEffect, useRef, useState } from 'react';
import { agentOf, AGENTS, type Agent } from '@/lib/agents';
import { disableAlwaysOn, enableAlwaysOn } from '@/lib/always-on';
import type { Rules } from '@/lib/copy';
import { backtest } from '@/lib/backtest';
import { startEngine, type EngineLog } from '@/lib/engine';
import type { Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { perplClient, type Fill, type Market } from '@/lib/perpl';
import { saveVault } from '@/lib/vault';
import { Mirror } from './Mirror';
import { Button, Card, ErrorLine, Field, short } from './ui';

// Leaders trade ~2,000 AUSD positions, so 20% is a ~400 AUSD copy against a 1,000 AUSD account.
const DEFAULT_RULES: Rules = { ratioBps: 2000, maxNotional: 500, leverage: 3, maxLoss: 150 };
const ALWAYS_ON = !!AGENTS;

type Props = { keys: Keys; apiKey: string; follower: bigint; trader: Trader; markets: Market[]; saved?: Rules };

export function CopyPanel({ keys, apiKey, follower, trader, markets, saved }: Props) {
  const [rules, setRules] = useState<Rules>(saved ?? DEFAULT_RULES);
  const [agent, setAgent] = useState<Agent>();
  const [logs, setLogs] = useState<EngineLog[]>([]);
  const [busy, setBusy] = useState<string>();
  const [inApp, setInApp] = useState(false);
  const [error, setError] = useState<string>();
  const engine = useRef<{ stop(): void }>(undefined);
  const [fills, setFills] = useState<Fill[]>([]);
  useEffect(() => void fetch(`/api/activity?leader=${trader.accountId}`).then((r) => r.json()).then((b) => setFills(b.fills ?? [])).catch(() => undefined), [trader.accountId]);

  const address = keys.account.address;
  useEffect(() => void (ALWAYS_ON && agentOf(address).then(setAgent).catch(() => undefined)), [address]);
  useEffect(() => () => engine.current?.stop(), []);

  const copyingThis = agent?.leader.toString() === trader.accountId;
  const set = (k: keyof Rules) => (v: number) => setRules((r) => ({ ...r, [k]: k === 'ratioBps' ? Math.round(v * 100) : v }));

  const act = (label: string, fn: () => Promise<void>) => async () => {
    setError(undefined);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.split('\n')[0]);
    } finally {
      setBusy(undefined);
    }
  };

  const start = act('Starting your agent', async () => {
    if (ALWAYS_ON) {
      await enableAlwaysOn(keys, follower, BigInt(trader.accountId), rules);
      setAgent(await agentOf(address));
      return;
    }
    // Fallback when the always-on registry isn't configured: copy while the app is open.
    const metas = markets
      .filter((m) => m.config.is_open && trader.markets.includes(m.id))
      .map((m) => ({ id: m.id, symbol: m.symbol, priceDecimals: m.config.price_decimals, sizeDecimals: m.config.size_decimals }));
    await saveVault(keys, { rules, leader: trader.accountId });
    engine.current = startEngine({
      perpl: perplClient(keys.perpl, apiKey), follower, leader: BigInt(trader.accountId), markets: metas, rules,
      onLog: (l) => setLogs((xs) => [l, ...xs].slice(0, 30)),
    });
    setInApp(true);
  });

  const stop = act('Stopping', async () => {
    if (inApp) {
      engine.current?.stop();
      setInApp(false);
    } else {
      await disableAlwaysOn(keys);
      setAgent(undefined);
    }
  });

  const running = inApp || copyingThis;
  const name = trader.label?.replace(/^Demo bot · /, '') ?? short(trader.address);

  return (
    <section id="copy" className="space-y-3">
      <Card title={running ? `Copying ${name}` : `Copy ${name}`}>
        {running ? (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span>
              {inApp ? 'Copying while this app is open' : 'Agent active 24/7, even with the app closed'}
              {agent?.halted && <span className="ml-1 text-amber-400">· paused: loss cap hit</span>}
            </span>
          </div>
        ) : agent && !copyingThis ? (
          <p className="mb-3 text-xs text-amber-400">Starting will replace your current agent (copying #{agent.leader.toString()}).</p>
        ) : null}
        <fieldset disabled={running || !!busy} className="disabled:opacity-60">
          <Field label="Copy size" value={rules.ratioBps / 100} onChange={set('ratioBps')} suffix="%" />
          <Field label="Max per market" value={rules.maxNotional} onChange={set('maxNotional')} suffix="AUSD" />
          <Field label="Leverage" value={rules.leverage} onChange={set('leverage')} suffix="x" />
          <Field label="Stop at loss" value={rules.maxLoss} onChange={set('maxLoss')} suffix="AUSD" />
        </fieldset>
        {!running && <WouldHaveMade fills={fills} rules={rules} markets={markets} />}
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          <li>• Your agent key can trade but can never withdraw.</li>
          {ALWAYS_ON && <li>• Runs in the cloud with the app closed, checking the leader on-chain every few seconds.</li>}
          <li>• Rules are encrypted with your passkey and restore on any device.</li>
        </ul>
      </Card>
      {running ? (
        <Button variant="ghost" onClick={stop} busy={busy}>Stop copying</Button>
      ) : (
        <Button onClick={start} busy={busy}>{ALWAYS_ON ? 'Start copying 24/7' : 'Start copying'}</Button>
      )}
      <ShareLink trader={trader} name={name} />
      <ErrorLine error={error} />
      <Mirror owner={address} follower={follower} trader={trader} markets={markets} copying={running} />
      {logs.length > 0 && (
        <Card title="Activity">
          <ul className="space-y-1 text-xs" aria-live="polite">
            {logs.map((l) => (
              <li key={`${l.at}-${l.text}`} className={l.level === 'warn' ? 'text-amber-400' : l.level === 'trade' ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>
                {new Date(l.at).toLocaleTimeString()} · {l.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/** "Copy me on Tandem": a link that opens the app with this trader preselected. */
function ShareLink({ trader, name }: { trader: Trader; name: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = `${location.origin}/?copy=${trader.accountId}`;
    const text = `Copy ${name} on Tandem: one Face ID, no seed phrase.`;
    try {
      if (navigator.share) await navigator.share({ title: 'Tandem', text, url });
      else await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch {
      /* the user closed the share sheet */
    }
  };
  return (
    <button type="button" onClick={share} className="min-h-11 w-full rounded-2xl text-sm text-[var(--muted)] hover:text-[var(--text)]" aria-live="polite">
      {done ? '✓ Link ready to share' : `↗ Share a link to copy ${name}`}
    </button>
  );
}

/** The replay of the leader's recent fills at these rules (see lib/backtest), updating as you edit. */
function WouldHaveMade({ fills, rules, markets }: { fills: Fill[]; rules: Rules; markets: Market[] }) {
  if (!fills.length) return null;
  const metas = markets.map((m) => ({ id: m.id, priceDecimals: m.config.price_decimals, sizeDecimals: m.config.size_decimals }));
  const r = backtest(fills, rules, metas);
  if (!r.trades || r.since === undefined) return null;
  const hours = Math.max(1, Math.round((Date.now() - r.since) / 3_600_000));
  return (
    <p className="mt-3 rounded-2xl bg-[var(--card-2)] px-3 py-2 text-sm">
      At these settings, copying their last {r.trades} trades ({hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`}) would have made{' '}
      <span className={`font-mono font-semibold ${r.pnl >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
        {r.pnl >= 0 ? '+' : '−'}
        {Math.abs(r.pnl).toFixed(2)} AUSD
      </span>
      <span className="block text-[11px] text-[var(--muted)]">At their fill prices, before fees and slippage. Past trades, not a promise.</span>
    </p>
  );
}
