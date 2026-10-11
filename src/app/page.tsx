'use client';
import { useEffect, useState } from 'react';
import { CopyPanel } from '@/components/CopyPanel';
import { Leaderboard } from '@/components/Leaderboard';
import { Portfolio } from '@/components/Portfolio';
import { Button, ErrorLine, short } from '@/components/ui';
import { createAccount, signIn, type Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { onboard, status, STEP_LABEL, type Status, type Step } from '@/lib/onboard';
import { markets as fetchMarkets, type Market } from '@/lib/perpl';

const STEPS: Step[] = ['gas', 'ausd', 'account', 'key'];

export default function Home() {
  const [keys, setKeys] = useState<Keys>();
  const [state, setState] = useState<Status>();
  const [step, setStep] = useState<Step>();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [trader, setTrader] = useState<Trader>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => void fetchMarkets().then(setMarkets).catch(() => undefined), []);
  useEffect(() => {
    if (!keys) return;
    status(keys).then(setState).catch((e) => setError(e.message));
    return () => keys.end();
  }, [keys]);

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (!keys) {
    return (
      <>
        <Header />
        <p className="text-lg text-[var(--muted)]">Trade in tandem with the best perp traders. One passkey, no seed phrase.</p>
        <Button onClick={run('Creating your passkey', async () => setKeys(await createAccount('Tandem user')))} busy={busy}>
          Create account with passkey
        </Button>
        <Button variant="ghost" onClick={run('Signing in', async () => setKeys(await signIn()))} busy={busy}>
          I already have one
        </Button>
        <ErrorLine error={error} />
      </>
    );
  }

  const ready = state?.step === 'done' && state.exchangeId !== undefined && !!state.vault.perplApiKey;

  return (
    <>
      <Header address={keys.account.address} />

      {state && !ready && (
        <>
          <ol className="space-y-2 text-sm">
            {STEPS.map((s) => {
              const doneIdx = STEPS.indexOf(step ?? state.step);
              const i = STEPS.indexOf(s);
              const mark = i < doneIdx ? '✓' : i === doneIdx && busy ? '…' : '○';
              return (
                <li key={s} className={i < doneIdx ? 'text-[var(--muted)]' : ''}>
                  {mark} {STEP_LABEL[s]}
                </li>
              );
            })}
          </ol>
          <Button busy={busy} onClick={run('Setting up', async () => setState(await onboard(keys, setStep)))}>
            Get started
          </Button>
        </>
      )}
      <ErrorLine error={error} />

      {ready && <Portfolio address={keys.account.address} exchangeId={state.exchangeId!} markets={markets} />}
      <Leaderboard onPick={setTrader} picked={trader?.accountId} />
      {ready && trader && (
        <CopyPanel
          key={trader.accountId}
          keys={keys}
          apiKey={state.vault.perplApiKey!}
          follower={state.exchangeId!}
          trader={trader}
          markets={markets}
          saved={state.vault.rules}
        />
      )}
      {!ready && trader && <p className="text-sm text-[var(--muted)]">Tap Get started above to copy this trader.</p>}
    </>
  );
}

const Header = ({ address }: { address?: string }) => (
  <header className="flex items-baseline justify-between">
    <h1 className="text-3xl font-semibold tracking-tight">Tandem</h1>
    {address && <span className="font-mono text-xs text-[var(--muted)]">{short(address)}</span>}
  </header>
);
