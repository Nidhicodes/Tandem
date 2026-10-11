'use client';
import { useEffect, useState } from 'react';
import { CopyPanel } from '@/components/CopyPanel';
import { Leaderboard } from '@/components/Leaderboard';
import { Mirror } from '@/components/Mirror';
import { Portfolio } from '@/components/Portfolio';
import { Avatar, Button, ErrorLine, short, Spinner } from '@/components/ui';
import { listAgents, type Agent } from '@/lib/agents';
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
  const [region, setRegion] = useState<{ country: string; restricted: boolean }>();
  const [watching, setWatching] = useState(false);
  const [invite, setInvite] = useState<Trader>();

  useEffect(() => void fetchMarkets().then(setMarkets).catch(() => undefined), []);
  useEffect(() => void fetch('/api/region').then((r) => r.json()).then(setRegion).catch(() => undefined), []);
  // Copy links: /?copy=<Perpl account id> preselects that trader after sign-in.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('copy');
    if (id) void fetch(`/api/trader?id=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : undefined)).then(setInvite).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (invite && !trader && state?.step === 'done') pick(invite);
  }, [invite, state]); // eslint-disable-line react-hooks/exhaustive-deps
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

  if (!keys && watching) return <Watch markets={markets} restricted={!!region?.restricted} initial={invite} onBack={() => setWatching(false)} />;
  if (!keys)
    return (
      <Landing
        busy={busy}
        error={error}
        restricted={!!region?.restricted}
        invite={invite}
        onWatch={() => setWatching(true)}
        onCreate={run('Creating your passkey', async () => setKeys(await createAccount('Tandem user')))}
        onSignIn={run('Signing in', async () => setKeys(await signIn()))}
      />
    );

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

type LandingProps = { busy?: string; error?: string; restricted: boolean; invite?: Trader; onCreate: () => void; onSignIn: () => void; onWatch: () => void };

function Landing({ busy, error, restricted, invite, onCreate, onSignIn, onWatch }: LandingProps) {
  const [live, setLive] = useState<number>();
  const [noPrf, setNoPrf] = useState(false);
  useEffect(() => void listAgents().then((a) => setLive(a.filter((x) => !x.halted).length)).catch(() => undefined), []);
  useEffect(() => void prfSupport().then((ok) => setNoPrf(ok === false)), []);
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <Header />
      <div className="flex flex-1 flex-col justify-center gap-6 py-8">
        {invite && (
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-sm">
            <Avatar address={invite.address} size={32} />
            <span>
              <span className="block font-medium">You're invited to copy {traderName(invite)}</span>
              <span className="text-[var(--muted)]">
                {invite.blurb ?? 'Sign up below, and their trades are mirrored into your account.'}
                {!!invite.followers && ` ${invite.followers} already copying.`}
              </span>
            </span>
          </div>
        )}
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
        {restricted ? (
          <>
            <p role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              Perpl, the exchange Tandem trades on, isn't available in the US, so accounts can't be opened from here. You can still watch Tandem copy trades live.
            </p>
            <Button onClick={onWatch}>Watch Tandem live</Button>
          </>
        ) : (
          <>
            {noPrf && (
              <p role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                This browser says it can't derive keys from a passkey (WebAuthn PRF), so sign-up will likely fail here. Use Safari on iOS 18+ with iCloud Keychain, or Chrome with Google Password Manager.
              </p>
            )}
            <Button onClick={onCreate} busy={busy}>Create account with passkey</Button>
            <Button variant="ghost" onClick={onSignIn} disabled={!!busy}>I already have one</Button>
            <button type="button" onClick={onWatch} className="min-h-11 w-full text-sm text-[var(--muted)] underline-offset-4 hover:text-[var(--text)] hover:underline">
              Just looking? Watch it live, no sign-up
            </button>
          </>
        )}
        <ErrorLine error={error} />
        <p className="text-center text-[11px] text-[var(--muted)]">
          Monad testnet · test AUSD · not financial advice
          <br />
          Passkeys: iCloud Keychain (iOS 18+) or Google Password Manager
        </p>
      </div>
    </div>
  );
}

/** true / false when the browser can say whether passkeys support PRF; undefined when it can't. */
async function prfSupport(): Promise<boolean | undefined> {
  const pkc = (globalThis as { PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean>> } }).PublicKeyCredential;
  const caps = await pkc?.getClientCapabilities?.().catch(() => undefined);
  return caps?.['extension:prf'];
}

/** Read-only: the live leaderboard and a real follower mirroring the picked trader. No account. */
function Watch({ markets, restricted, initial, onBack }: { markets: Market[]; restricted: boolean; initial?: Trader; onBack: () => void }) {
  const [trader, setTrader] = useState<Trader | undefined>(initial);
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => void listAgents().then(setAgents).catch(() => undefined), []);
  const follower = trader && agents.find((a) => !a.halted && a.leader.toString() === trader.accountId);
  const pick = (t: Trader) => {
    setTrader(t);
    requestAnimationFrame(() => document.getElementById('watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <>
      <Header />
      <section className="rounded-3xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm">
        <p className="font-medium">Read-only view</p>
        <p className="mt-1 text-[var(--muted)]">
          {restricted ? 'Trading is unavailable in your region. ' : ''}Tap a trader to see their positions and trades, and a Tandem user's agent copying them, live from Monad.
        </p>
        <button type="button" onClick={onBack} className="mt-2 min-h-9 text-[var(--accent)]">← Back</button>
      </section>
      <Leaderboard onPick={pick} picked={trader?.accountId} markets={markets} />
      {trader && (
        <div id="watch">
          <Mirror key={trader.accountId} trader={trader} markets={markets} owner={follower?.owner} follower={follower?.follower} copying={!!follower} mine={false} you={`Follower #${follower?.follower ?? ''}`} />
        </div>
      )}
    </>
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

const traderName = (t: Trader) => t.label?.replace(/^Demo bot · /, '') ?? short(t.address);

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
