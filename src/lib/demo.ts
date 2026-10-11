/**
 * Demo leader bots (server-only). Testnet has almost no human traders, so Tandem runs a few
 * transparent, rule-based strategies that users can copy. They are always labelled "Demo"
 * on the leaderboard -- never presented as real traders.
 *
 * Leader keys are derived from SPONSOR_PRIVATE_KEY, so there is no extra secret to manage.
 */
import { createEd25519SigningSession } from '@category-labs/mera';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type Strategy = {
  name: string;
  market: string; // Perpl symbol
  blurb: string;
  /** Desired direction from recent closes (oldest first): +1 long, -1 short, 0 flat. */
  signal(closes: number[]): -1 | 0 | 1;
};

const pct = (a: number, b: number) => (b - a) / a;

export const STRATEGIES: Strategy[] = [
  {
    name: 'Trend Rider',
    market: 'BTC',
    blurb: 'Goes with the last 30 minutes of BTC momentum.',
    signal: (c) => {
      const m = pct(c[c.length - 7] ?? c[0], c[c.length - 1]);
      return m > 0.0005 ? 1 : m < -0.0005 ? -1 : 0;
    },
  },
  {
    name: 'Mean Reverter',
    market: 'ETH',
    blurb: 'Fades ETH when it stretches more than 0.3% from its 1-hour average.',
    signal: (c) => {
      const avg = c.reduce((s, x) => s + x, 0) / c.length;
      const d = pct(avg, c[c.length - 1]);
      return d > 0.003 ? -1 : d < -0.003 ? 1 : 0;
    },
  },
  {
    name: 'Breakout',
    market: 'SOL',
    blurb: 'Joins SOL when it breaks its 1-hour range; flat inside it.',
    signal: (c) => {
      const last = c[c.length - 1];
      const prior = c.slice(0, -1);
      return last > Math.max(...prior) ? 1 : last < Math.min(...prior) ? -1 : 0;
    },
  },
];

export type Leader = { strategy: Strategy; key: Hex; address: Hex; apiSeed: Uint8Array };

export function demoLeaders(sponsorKey = process.env.SPONSOR_PRIVATE_KEY): Leader[] {
  if (!sponsorKey || sponsorKey.length !== 66) return [];
  const root = new TextEncoder().encode(sponsorKey);
  const derive = (info: string) => hkdf(sha256, root, undefined, new TextEncoder().encode(info), 32);
  return STRATEGIES.map((strategy, i) => {
    const key = bytesToHex(derive(`tandem/demo-leader/${i}/evm`));
    const apiSeed = derive(`tandem/demo-leader/${i}/perpl`);
    return { strategy, key, address: privateKeyToAccount(key).address, apiSeed };
  });
}

export const apiSigner = (l: Leader) => createEd25519SigningSession({ privateKey: l.apiSeed.slice() });
