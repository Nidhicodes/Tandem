'use client';
import { useEffect, useState } from 'react';
import { CopyPanel } from '@/components/CopyPanel';
import { Leaderboard } from '@/components/Leaderboard';
import { Portfolio } from '@/components/Portfolio';
import { Avatar, Button, ErrorLine, short, Spinner } from '@/components/ui';
import { listAgents } from '@/lib/agents';
import { createAccount, signIn, type Keys } from '@/lib/keys';
import type { Trader } from '@/lib/leaderboard';
import { onboard, status, STEP_LABEL, type Status, type Step } from '@/lib/onboard';
import { markets as fetchMarkets, type Market } from '@/lib/perpl';

const STEPS: Step[] = ['gas', 'ausd', 'account', 'fund', 'key'];

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
      setError(
        (e as { code?: string }).code === 'PRF_UNAVAILABLE'
          ? 'This passkey provider does not support PRF, which Tandem needs to derive your keys. Use iCloud Keychain (iOS/macOS 18+) or Google Password Manager (Chrome/Android), not a third-party password manager or Windows Hello.'
          : (e as Error).message.split('\n')[0],
      );
    } finally {
      setBusy(undefined);
    }
  };

  const pick = (t: Trader) => {
    setTrader(t);
    requestAnimationFrame(() => document.getElementById('copy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if (!keys) return <Landing busy={busy} error={error} onCreate={run('Creating your passkey', async () => setKeys(await createAccount('Tandem user')))} onSignIn={run('Signing in', async () => setKeys(await signIn()))} />;

  const ready = state?.step === 'done' && state.exchangeId !== undefined && !!state.vault.perplApiKey;
  const current = STEPS.indexOf(step ?? state?.step ?? 'gas');

  return (
    <>
      <Header address={keys.account.address} />

      {!state && (
        <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Spinner /> Loading your account…
        </p>
      )}

      {state && !ready && (
        <section className="rounded-3xl border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-semibold">Set up in one tap</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Free on Monad testnet. Takes about 15 seconds.</p>
          <ol className="mt-4 space-y-2.5">
            {STEPS.map((s, i) => {
              const done = i < current;
              const active = i === current && !!busy;
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? 'bg-[var(--up)]/20 text-[var(--up)]' : active ? 'brand-gradient text-white' : 'bg-[var(--card-2)] text-[var(--muted)]'}`}
                  >
                    {done ? '✓' : active ? <Spinner /> : i + 1}
                  </span>
                  <span className={done ? 'text-[var(--muted)]' : ''}>{STEP_LABEL[s]}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4">
            <Button busy={busy} onClick={run('Setting up', async () => setState(await onboard(keys, setStep)))}>
              Get started
            </Button>
          </div>
        </section>
      )}
      <ErrorLine error={error} />

      {ready && <Portfolio address={keys.account.address} exchangeId={state.exchangeId!} markets={markets} />}
      <Leaderboard onPick={pick} picked={trader?.accountId} markets={markets} />
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
      {!ready && trader && <p className="text-center text-sm text-[var(--muted)]">Tap Get started above, then copy {trader.label ?? short(trader.address)}.</p>}

      {ready && trader && <StickyCta trader={trader} />}
    </>
  );
}

function Landing({ busy, error, onCreate, onSignIn }: { busy?: string; error?: string; onCreate: () => void; onSignIn: () => void }) {
  const [live, setLive] = useState<number>();
  useEffect(() => void listAgents().then((a) => setLive(a.filter((x) => !x.halted).length)).catch(() => undefined), []);
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <Header />
      <div className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Stop copying trades <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] bg-clip-text text-transparent">by hand</span>.
          </h1>
          <p className="mt-3 text-lg text-[var(--muted)]">
            Signal groups post the call, and by the time you open your exchange the price has moved. Tandem mirrors a trader into your account in seconds, from one Face ID.
          </p>
          {live !== undefined && live > 0 && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              {live} agent{live === 1 ? '' : 's'} copying on Monad right now
            </p>
          )}
        </div>
        <ol className="space-y-3 text-sm">
          <Point n={1} title="Face ID is your wallet" text="A Mera passkey creates your account. No seed phrase, no extension." />
          <Point n={2} title="Pick a trader by their record" text="Ranked by realized PnL from Perpl trades on-chain, not screenshots." />
          <Point n={3} title="Your agent copies them 24/7" text="Within your size and loss limits. It can trade but can never withdraw." />
        </ol>
      </div>
      <div className="space-y-3">
        <Button onClick={onCreate} busy={busy}>Create account with passkey</Button>
        <Button variant="ghost" onClick={onSignIn} disabled={!!busy}>I already have one</Button>
        <ErrorLine error={error} />
        <p className="text-center text-[11px] text-[var(--muted)]">Monad testnet · test AUSD · not financial advice</p>
      </div>
    </div>
  );
}

const Point = ({ n, title, text }: { n: number; title: string; text: string }) => (
  <li className="flex gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)]/70 p-3">
    <span className="brand-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" aria-hidden>{n}</span>
    <span>
      <span className="block font-medium">{title}</span>
      <span className="text-[var(--muted)]">{text}</span>
    </span>
  </li>
);

const Header = ({ address }: { address?: string }) => (
  <header className="flex items-center justify-between">
    <span className="flex items-center gap-2">
      <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
      <span className="text-xl font-semibold tracking-tight">Tandem</span>
    </span>
    {address && (
      <span className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] py-1 pl-1 pr-3 font-mono text-xs text-[var(--muted)]">
        <Avatar address={address} size={20} />
        {short(address)}
      </span>
    )}
  </header>
);

/** Floating shortcut back to the copy panel once a trader is picked; hidden while the panel is on screen. */
function StickyCta({ trader }: { trader: Trader }) {
  const [panelVisible, setPanelVisible] = useState(true);
  useEffect(() => {
    const el = document.getElementById('copy');
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [trader.accountId]);
  if (panelVisible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <button
        type="button"
        onClick={() => document.getElementById('copy')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="pointer-events-auto flex min-h-12 w-full items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card-2)]/95 px-3 py-2 shadow-2xl backdrop-blur"
      >
        <Avatar address={trader.address} size={28} />
        <span className="flex-1 text-left text-sm">
          <span className="block font-medium">{trader.label?.replace(/^Demo bot · /, '') ?? short(trader.address)}</span>
          <span className="text-xs text-[var(--muted)]">Review your copy settings</span>
        </span>
        <span aria-hidden>↓</span>
      </button>
    </div>
  );
}
