# Tandem: pitch, demo and judge prep

Live: https://tandem-omega-opal.vercel.app · Repo: https://github.com/Nidhicodes/Tandem · Monad testnet

Placeholders in [brackets] are for you to fill: only you can say them truthfully.

## The story in one breath

Retail traders already copy other traders: they sit in Telegram and X signal groups and
re-type every call by hand, late, at a worse price, with their keys pasted into bots they
don't trust. Tandem turns that habit into a product: pick a trader by their on-chain record,
set your limits, and an agent mirrors them into your own Perpl account within seconds, from
one Face ID passkey, with a key that can trade but never withdraw.

## 2-minute pitch (spoken, ~260 words)

**0:00 - Problem (25s)**
"Every day, thousands of retail traders copy someone else's trades by hand. A caller posts
'long BTC' in a Telegram group, and by the time you've opened your exchange, logged in and
typed the size, the price has moved. Or you give a trading bot your keys and hope.
[One sentence of your own: who you've watched do this, or why you care.]"

**0:25 - Solution (30s)**
"Tandem is copy trading for Monad. You sign up with Face ID. There's no seed phrase: a Mera
passkey is your wallet. You pick a trader from a leaderboard ranked by realized PnL from
Perpl's on-chain trades, not screenshots. You set a copy size and a loss limit. From then on
an agent mirrors that trader's positions into your own account, 24/7, with the app closed."

**0:55 - Why it's safe (25s)**
"The agent holds a separate key derived from your passkey that Perpl lets trade but never
withdraw. Your rules are encrypted with your passkey and stored on-chain, so a new phone
restores everything. If your loss limit is hit, the agent closes your positions and stops."

**1:20 - Business (20s)**
"We earn a builder fee on every copied order through Perpl's builder codes. Copy volume is
the business, and every new leader brings followers who trade every time they do. Later:
a share for leaders, so the best traders are paid to be copied."

**1:40 - Why now, why Monad (20s)**
"Copying only works if your order lands right after the leader's. Monad's speed, Perpl's
on-chain order book and passkey wallets make that practical without handing anyone custody. It's
live on testnet today: [N] people have signed up and their agents have copied [M] trades."

## 3-minute demo storyboard (record on your phone, screen-capture)

| Time | On screen | Voice-over |
|---|---|---|
| 0:00-0:12 | Open a copy link (`/?copy=1050`): "You're invited to copy Trend Rider" | "A trader shares one link in their Telegram group. This is what their followers see." |
| 0:12-0:30 | Tap **Create account with passkey**, Face ID prompt | "One Face ID. No seed phrase, no extension. Mera derives a wallet from the passkey." |
| 0:30-0:55 | One-tap setup: gas, AUSD, Perpl account, 1,000 AUSD in, trade-only key | "Tandem sponsors gas, claims test AUSD, opens a Perpl account and enrolls a trade-only key. Five steps, one tap, about 15 seconds." |
| 0:55-1:20 | Top traders list; point at ranks, PnL, the "Demo bot" tag | "Traders ranked by realized PnL from Perpl events, indexed with Envio. On testnet there are few humans, so we run three transparent strategy bots, always labelled." |
| 1:20-1:40 | Tap Trend Rider: their position, fills, and "would have made" at my settings | "Before copying you see what they hold, every trade, and what copying them at my size would have made." |
| 1:40-2:00 | Set 20% / 500 cap / loss 150, tap **Start copying 24/7**, Face ID | "My size, my cap, my loss limit. One more Face ID registers my agent on-chain." |
| 2:00-2:30 | Live mirror: leader SHORT vs You SHORT, "in sync"; lock the phone, wait, reopen | "Close the app. The agent runs in the cloud. Here's a trade it copied while the phone was locked: [lag] seconds after the leader." (Record this part after a real copy happens.) |
| 2:30-2:45 | Portfolio card: account value, open PnL | "My account, my positions. The agent can never withdraw." |
| 2:45-3:00 | Second device: sign in with the same passkey, rules restored | "New phone, same passkey: everything restores from the chain." |

Recording tips: keep the phone in dark mode and at 100% brightness, show one Face ID prompt
real-time and cut the waits, and do the copy segment during a time when a bot is about to
trade (watch the Actions log for "LONG/SHORT").

## Tough questions, honest answers

- **"Your leaders are bots."** Yes, on testnet, and they're labelled. Testnet has almost no
  human perp traders to copy; on mainnet the leaderboard is the product. The bots are
  simple, published strategies so anyone can check what they do.
- **"Who holds the agent key?"** The agent key is derived from the user's passkey, enrolled
  with Perpl as trade-only, then sealed so only the Tandem engine can open it. Worst case the
  engine misbehaves within the user's limits; it can't move funds out. Stopping deletes the
  agent from the registry.
- **"What if Tandem goes down?"** Copying stops; nothing is lost. Positions stay in the
  user's own Perpl account, and they can trade or withdraw there directly.
- **"How fast is a copy?"** A watcher streams Perpl Exchange events over a Monad WebSocket
  and wakes the engine the moment a copied leader's position changes: the first measured
  event-driven copy landed 2s after the leader (earlier polled copies took 7-15s). The app
  shows each copy's delay and price difference vs the leader. A 15s baseline beat and the
  Chainlink CRE workflow (simulated, deployment access requested) re-check drift on-chain.
- **"Why not just use Bybit or Bitget copy trading?"** Those are custodial and the track
  records live on the exchange's servers. Tandem's records are on-chain and the user keeps
  custody. [Check: confirm current CEX copy-trading offerings before saying names on stage.]
- **"Traction?"** [N sign-ups, M copied trades, from the on-chain registry and fills.]
- **"Team?"** [Your background in one honest line, and why you'll keep building.]
- **"Regulation?"** Perpl isn't available to US users; Tandem respects that and blocks US
  traffic. Leader payouts would need legal review before mainnet.

## Bounty one-liners (paste and expand in the submission form)

- **Agora Mobile Trading:** a phone-first copy-trading app where a Mera passkey is the whole
  account, AUSD is the balance and margin, and every trade executes on Perpl.
- **Mera UX:** one Face ID creates the account, setup is one tap, and no trade ever prompts.
- **Mera "One Passkey, Many Keys":** one passkey derives four keys with separate jobs: the
  Monad wallet, a Perpl trading key, a vault encryption key, and a 24/7 agent key. Settings
  restore on any device from the on-chain vault.
- **Perpl API:** signed REST enrollment and orders, order forwarding, a position-mirroring
  engine with caps, a loss stop and idempotent orders, running 24/7.
- **Perpl Analytics:** a leaderboard ranked by realized PnL from Perpl's on-chain position
  events, with market makers filtered out.
- **Envio:** a HyperIndex indexer for Perpl trader stats plus a HyperSync fallback.
- **Chainlink CRE:** a cron workflow that reads the agent registry and every leader and
  follower position on-chain, runs the same drift check as the engine, and calls the engine
  only for drifted followers (simulation output in `docs/evidence/`).
