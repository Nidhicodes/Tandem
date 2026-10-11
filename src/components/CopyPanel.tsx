'use client';
import { useEffect, useRef, useState } from 'react';
import type { Rules } from '@/lib/copy';
import { startEngine, type EngineLog } from '@/lib/engine';
import type { Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { markets, perplClient } from '@/lib/perpl';
import { open, seal } from '@/lib/vault';
import { Button, Card, ErrorLine, Field, short } from './ui';

const DEFAULT_RULES: Rules = { ratioBps: 1000, maxNotional: 50, leverage: 2, maxLoss: 20 };

export function CopyPanel({ keys, apiKey, follower, trader }: { keys: Keys; apiKey: string; follower: bigint; trader: Trader }) {
  const address = keys.account.address;
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [logs, setLogs] = useState<EngineLog[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const engine = useRef<{ stop(): void }>(undefined);

  useEffect(() => {
    open<Rules>(keys.vault, address, 'rules').then((r) => r && setRules(r)).catch(() => undefined);
  }, [keys.vault, address]);
  useEffect(() => () => engine.current?.stop(), []);

  const set = (k: keyof Rules) => (v: number) => setRules((r) => ({ ...r, [k]: k === 'ratioBps' ? Math.round(v * 100) : v }));

  async function start() {
    setError(undefined);
    try {
      await seal(keys.vault, address, 'rules', rules);
      const all = await markets();
      const metas = all
        .filter((m) => m.config.is_open && trader.markets.includes(m.id))
        .map((m) => ({ id: m.id, priceDecimals: m.config.price_decimals, sizeDecimals: m.config.size_decimals }));
      if (!metas.length) throw new Error('This trader has no open markets to copy');
      engine.current = startEngine({
        perpl: perplClient(keys.perpl, apiKey),
        follower,
        leader: BigInt(trader.accountId),
        markets: metas,
        rules,
        onLog: (l) => setLogs((xs) => [l, ...xs].slice(0, 50)),
      });
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function stop() {
    engine.current?.stop();
    engine.current = undefined;
    setRunning(false);
  }

  return (
    <>
      <Card title={`Copy ${short(trader.address)}`}>
        <fieldset disabled={running} className="disabled:opacity-60">
          <Field label="Copy size" value={rules.ratioBps / 100} onChange={set('ratioBps')} suffix="%" />
          <Field label="Max per market" value={rules.maxNotional} onChange={set('maxNotional')} suffix="AUSD" />
          <Field label="Leverage" value={rules.leverage} onChange={set('leverage')} suffix="x" />
          <Field label="Stop at loss" value={rules.maxLoss} onChange={set('maxLoss')} suffix="AUSD" />
        </fieldset>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Your trading key can place orders but can never withdraw. Rules are encrypted with your passkey.
        </p>
      </Card>
      {running ? <Button variant="ghost" onClick={stop}>Stop copying</Button> : <Button onClick={start}>Start copying</Button>}
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
    </>
  );
}
