# Tandem

**Trade in tandem with the best perp traders. One passkey, no seed phrase.**

Tandem is a mobile-first copy-trading app on Monad. Pick a trader from a live leaderboard of
Perpl perpetuals traders, set your size and risk limits, and an agent you control mirrors their
positions into your own account. Sign in with Face ID; there is no seed phrase, no extension and
no wallet popup per trade.

**Try it on your phone: [tandem-omega-opal.vercel.app](https://tandem-omega-opal.vercel.app)** (Monad testnet)

## Who it's for

Retail traders who follow signal callers on Telegram and X and copy trades by hand, late and at
worse prices. Tandem replaces screenshots and manual entry with an on-chain track record you can
verify and a copy engine that acts in seconds, within limits you set.

## How it works

1. **One passkey, many keys** ([Mera](https://mera.category.xyz)). A single WebAuthn ceremony
   yields 32 PRF bytes. Tandem derives three independent keys from them, each in its own HKDF
   namespace:
   - the **Monad account** (secp256k1) that owns your funds;
   - a **trade-only Perpl API key** (Ed25519). It can place orders but, by Perpl's design, can
     never withdraw;
   - a **vault key** (AES-GCM) that encrypts your settings.
   The same passkey on a fresh device re-derives all three. Nothing secret is stored anywhere.
2. **One-tap onboarding.** *Get started* sponsors a little gas, claims test **AUSD**, opens a
   **Perpl** account with order forwarding enabled, and enrolls the trade-only key. Each step
   checks live state first, so it resumes after a refresh or on another device.
3. **Encrypted settings on-chain.** Your Perpl API token and copy rules are AES-GCM encrypted
   under the vault key and stored in [`TandemVault`](contracts/TandemVault.sol) on Monad. A
   new phone with the same passkey restores everything with no backup step.
4. **Leaderboard** ([Envio](https://envio.dev)). An Envio HyperIndex indexer
   ([`indexer/`](indexer)) turns Perpl's position events into per-trader, per-day realized PnL,
   win rate and liquidations. Market makers are filtered out. Tandem's own demo bots are always
   labelled as such.
5. **Copy engine.** It reads the leader's and your positions on-chain and moves you toward
   `leader size × your ratio`, capped per market, at your leverage, with a loss limit that
   flattens everything and pauses. It mirrors *positions*, not fills, so missed events,
   restarts and partial fills correct themselves on the next pass. The sizing logic
   ([`src/lib/copy.ts`](src/lib/copy.ts)) is pure and unit-tested.
6. **Always-on agent + Chainlink CRE.** *Start copying 24/7* derives a fourth key from the
   passkey, a dedicated agent key, and enrolls it with Perpl as its own trade-only API key
   (revocable on its own). Its seed is sealed to the Tandem engine's X25519 key and registered
   with your rules in [`TandemAgents`](contracts/TandemAgents.sol). The
   [CRE workflow](cre/tandem-copy/main.ts) runs every 30s on a Chainlink DON: it reads the
   registry and every agent's leader/follower positions from the Perpl Exchange (consensus-verified
   EVM reads), runs the same drift check as the engine, and wakes the engine
   (`POST /api/engine/tick`) only for followers that need an order. CRE decides *when* to act from
   on-chain truth; the engine only signs. Request ids are seeded from Perpl's last accepted id, so
   duplicate wake-ups execute at most once.

   Until the CRE deployment is approved (simulation output: [docs/evidence](docs/evidence/cre-simulation.txt)),
   a [GitHub Actions heartbeat](.github/workflows/heartbeat.yml) calls `POST /api/cron` every 15s:
   one copy pass for every agent, and a decision for each demo bot every 2 minutes. Nothing runs
   on a laptop. Perpl is not available to US users, and the app passes that restriction through.

## Live on Monad testnet

| | Address |
|---|---|
| Perpl Exchange | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| TandemVault | `0x17735db444888e001a3c056bf5112960bed643d1` |
| TandemAgents | `0xf250a10986b3ce974d5d042fd53bbe2de6bbd770` |

## Business model

Perpl **builder codes**: each copy-follower's key is enrolled bound to Tandem's builder id with a
fee ceiling the user signs for, and every copied order carries a small builder fee (for example
1 bp). Revenue scales with copied volume, and both the follower and Perpl see it on-chain.
(Wired in [`src/lib/perpl.ts`](src/lib/perpl.ts); switched on by `NEXT_PUBLIC_PERPL_BUILDER_ID`
once Perpl issues the id.)

## Stack

Next.js PWA · TypeScript · viem · `@category-labs/mera` · Perpl REST API (signed Ed25519
requests through a same-origin relay) · Envio HyperIndex + HyperSync · Solidity (`TandemVault`)

## Run it

```bash
npm install
cp .env.example .env.local     # fill in SPONSOR_PRIVATE_KEY, ENVIO_API_TOKEN
npm run deploy:vault           # once; add NEXT_PUBLIC_VAULT_ADDRESS to .env.local
npm run deploy:agents          # once; add NEXT_PUBLIC_AGENTS_ADDRESS to .env.local
npm run demo:setup             # once; funds + onboards the demo bots
npm run demo:run               # keep running: the demo bots trade every 2 minutes
npm run engine                 # keep running locally, or let the CRE workflow call /api/engine/tick
npm run dev                    # open on a phone or a passkey-capable browser
npm test                       # planner, drift, sealing and demo-strategy tests
cd indexer && npm install && npm test   # indexer tests against simulated and real Monad blocks

# Chainlink CRE (needs a free CRE account: cre login)
cd cre/tandem-copy && npm install && npm run compile    # builds wasm/workflow.wasm
echo "ENGINE_TICK_TOKEN=$(cd ../.. && npm run -s engine:token)" > ../.env
npm run simulate
```

## Security notes

- The trade-only API key cannot withdraw, under any scope (Perpl API docs).
- `/api/perpl` relays only the Perpl paths the app uses; signatures are made in the browser.
- `/api/gas` is public so onboarding works; it only tops up near-empty accounts, once each, with a
  small fixed amount from a testnet-only key.
- `TandemVault` stores ciphertext only; each address can write only its own slot.

Testnet only. Not financial advice.
