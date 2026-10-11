'use client';
import { useEffect, useRef, useState } from 'react';
import { agentOf, AGENTS, type Agent } from '@/lib/agents';
import { disableAlwaysOn, enableAlwaysOn } from '@/lib/always-on';
import type { Rules } from '@/lib/copy';
import { startEngine, type EngineLog } from '@/lib/engine';
import type { Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { perplClient, type Market } from '@/lib/perpl';
import { saveVault } from '@/lib/vault';
import { Button, Card, ErrorLine, Field, short } from './ui';

const DEFAULT_RULES: Rules = { ratioBps: 1000, maxNotional: 50, leverage: 2, maxLoss: 20 };
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
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          <li>• Your agent key can trade but can never withdraw.</li>
          {ALWAYS_ON && <li>• Chainlink CRE watches the leader on-chain and wakes your agent when they move.</li>}
          <li>• Rules are encrypted with your passkey and restore on any device.</li>
        </ul>
      </Card>
      {running ? (
        <Button variant="ghost" onClick={stop} busy={busy}>Stop copying</Button>
      ) : (
        <Button onClick={start} busy={busy}>{ALWAYS_ON ? 'Start copying 24/7' : 'Start copying'}</Button>
      )}
      <ErrorLine error={error} />
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
