'use client';
import { useCallback, useEffect, useState } from 'react';
import { CopyPanel } from '@/components/CopyPanel';
import { Leaderboard } from '@/components/Leaderboard';
import { Button, Card, ErrorLine, Row, short } from '@/components/ui';
import { createAccount, signIn, type Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { accountIdOf, balances, openPerplAccount, requestAusd } from '@/lib/onchain';
import { enrollApiKey } from '@/lib/perpl';
import { open, seal } from '@/lib/vault';

const MIN_PERPL_DEPOSIT = 100_000_000n; // 100 AUSD (6 decimals), Perpl's account minimum
type Bal = Awaited<ReturnType<typeof balances>>;

export default function Home() {
  const [keys, setKeys] = useState<Keys>();
  const [bal, setBal] = useState<Bal>();
  const [exchangeId, setExchangeId] = useState<bigint>();
  const [apiKey, setApiKey] = useState<string>();
  const [trader, setTrader] = useState<Trader>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!keys) return;
    const [b, id] = await Promise.all([balances(keys.account.address), accountIdOf(keys.account.address)]);
    setBal(b);
    setExchangeId(id);
  }, [keys]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (keys) open<string>(keys.vault, keys.account.address, 'perpl-api-key').then(setApiKey).catch(() => undefined);
    return () => keys?.end();
  }, [keys]);

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
      await refresh();
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
        <p className="text-[var(--muted)]">Trade in tandem with the best perp traders. One passkey, no seed phrase.</p>
        <Button onClick={run('Creating', async () => setKeys(await createAccount('Tandem user')))} busy={busy}>
          Create account with passkey
        </Button>
        <Button variant="ghost" onClick={run('Signing in', async () => setKeys(await signIn()))} busy={busy}>
          I already have one
        </Button>
        <ErrorLine error={error} />
      </>
    );
  }

  const { account, perpl } = keys;
  const hasGas = Number(bal?.mon ?? 0) >= 0.05;
  const hasAusd = (bal?.ausdRaw ?? 0n) >= MIN_PERPL_DEPOSIT;
  const ready = exchangeId !== undefined && !!apiKey;

  return (
    <>
      <Header />
      <Card>
        <Row k="Account" v={short(account.address)} />
        <Row k="MON" v={bal ? Number(bal.mon).toFixed(3) : '…'} />
        <Row k="AUSD in wallet" v={bal ? Number(bal.ausd).toFixed(2) : '…'} />
        <Row k="Perpl account" v={exchangeId !== undefined ? `#${exchangeId}` : 'not yet'} />
      </Card>

      {!ready && (
        <>
          <Step n={1} done={hasGas} label="Get gas" busy={busy}
            onClick={run('Funding gas', async () => {
              const res = await fetch('/api/gas', { method: 'POST', body: JSON.stringify({ address: account.address }) });
              if (!res.ok) throw new Error((await res.json()).error ?? `gas -> ${res.status}`);
            })} />
          <Step n={2} done={hasAusd || exchangeId !== undefined} disabled={!hasGas} label="Claim test AUSD" busy={busy}
            onClick={run('Claiming AUSD', () => requestAusd(account))} />
          <Step n={3} done={exchangeId !== undefined} disabled={!hasAusd} label="Open Perpl account (100 AUSD)" busy={busy}
            onClick={run('Opening Perpl account', () => openPerplAccount(account, MIN_PERPL_DEPOSIT))} />
          <Step n={4} done={!!apiKey} disabled={exchangeId === undefined} label="Enroll trading key" busy={busy}
            onClick={run('Enrolling key', async () => {
              const token = await enrollApiKey(account, perpl);
              await seal(keys.vault, account.address, 'perpl-api-key', token);
              setApiKey(token);
            })} />
        </>
      )}
      <ErrorLine error={error} />

      <Leaderboard onPick={setTrader} picked={trader?.accountId} />
      {ready && trader && <CopyPanel key={trader.accountId} keys={keys} apiKey={apiKey} follower={exchangeId} trader={trader} />}
      {!ready && trader && <p className="text-sm text-[var(--muted)]">Finish the steps above to start copying.</p>}
    </>
  );
}

const Header = () => <h1 className="text-3xl font-semibold tracking-tight">Tandem</h1>;

const Step = ({ n, label, done, ...rest }: { n: number; label: string; done: boolean; onClick: () => void; busy?: string; disabled?: boolean }) =>
  done ? (
    <p className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">✓ {n}. {label}</p>
  ) : (
    <Button {...rest}>{`${n}. ${label}`}</Button>
  );
