/**
 * Trader leaderboard from Perpl's on-chain position events.
 *
 * With ENVIO_API_TOKEN set, logs come from Envio HyperSync (monad-testnet), which can
 * scan a full day in a few requests. Without it we fall back to the public RPC, which
 * caps eth_getLogs at 100 blocks, so the window shrinks to the last few minutes.
 */
import { decodeEventLog, encodeEventTopics, type Hex } from 'viem';
import { PERPL } from './config';
import { positionEvents } from './exchange-abi';
import { addressOf, publicClient } from './onchain';

const HYPERSYNC = 'https://monad-testnet.hypersync.xyz';
const RPC_CHUNK = 100n; // public Monad RPC getLogs limit (verified 2026-10-10)
const RPC_CHUNKS = 20n;
const HYPERSYNC_SPAN = 300_000n; // ~25h at Monad testnet's ~0.3s blocks (measured 2026-10-10)
const MM_EVENTS_PER_1K_BLOCKS = 50; // busier than this reads as a market maker, not a trader to copy

export type Trader = {
  accountId: string;
  address: Hex;
  realizedPnl: number; // AUSD
  closes: number;
  winRate: number; // 0..1 over closing events
  trades: number;
  markets: number[];
};
export type Leaderboard = { traders: Trader[]; fromBlock: string; toBlock: string; source: 'envio-hypersync' | 'rpc' };

type RawLog = { data: Hex; topics: [Hex, ...Hex[]] };
const topic0s = positionEvents.map((e) => encodeEventTopics({ abi: [e] })[0] as Hex);

async function viaHyperSync(token: string, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let next = from;
  while (next < to) {
    const res = await fetch(`${HYPERSYNC}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from_block: Number(next),
        to_block: Number(to),
        logs: [{ address: [PERPL.exchange], topics: [topic0s] }],
        field_selection: { log: ['data', 'topic0'] },
      }),
    });
    if (!res.ok) throw new Error(`HyperSync -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const batch of [body.data].flat()) for (const l of batch?.logs ?? []) out.push({ data: l.data, topics: [l.topic0] });
    if (!body.next_block || BigInt(body.next_block) <= next) break;
    next = BigInt(body.next_block);
  }
  return out;
}

async function viaRpc(from: bigint, to: bigint): Promise<RawLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let b = from; b <= to; b += RPC_CHUNK) ranges.push([b, b + RPC_CHUNK - 1n > to ? to : b + RPC_CHUNK - 1n]);
  const out: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += 5) {
    const batch = await Promise.all(
      ranges.slice(i, i + 5).map(([fromBlock, toBlock]) =>
        publicClient.getLogs({ address: PERPL.exchange, events: positionEvents, fromBlock, toBlock }),
      ),
    );
    for (const l of batch.flat()) out.push({ data: l.data, topics: l.topics as RawLog['topics'] });
  }
  return out;
}

type Agg = { pnl: bigint; closes: number; wins: number; trades: number; markets: Set<number> };

export function aggregate(logs: RawLog[]): Map<bigint, Agg> {
  const by = new Map<bigint, Agg>();
  for (const raw of logs) {
    let ev;
    try {
      ev = decodeEventLog({ abi: positionEvents, data: raw.data, topics: raw.topics });
    } catch {
      continue;
    }
    const a = ev.args as { perpId: bigint; accountId?: bigint; posAccountId?: bigint; deltaPnlCNS?: bigint };
    const id = a.accountId ?? a.posAccountId;
    if (id === undefined) continue;
    const s = by.get(id) ?? { pnl: 0n, closes: 0, wins: 0, trades: 0, markets: new Set<number>() };
    s.trades++;
    s.markets.add(Number(a.perpId));
    if (a.deltaPnlCNS !== undefined) {
      s.pnl += a.deltaPnlCNS;
      s.closes++;
      if (a.deltaPnlCNS > 0n) s.wins++;
    }
    by.set(id, s);
  }
  return by;
}

let cache: { at: number; value: Leaderboard } | undefined;

export async function leaderboard(limit = 20): Promise<Leaderboard> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;

  const token = process.env.ENVIO_API_TOKEN;
  const to = await publicClient.getBlockNumber();
  const span = token ? HYPERSYNC_SPAN : RPC_CHUNK * RPC_CHUNKS;
  const from = to - span + 1n;
  const logs = token ? await viaHyperSync(token, from, to) : await viaRpc(from, to);

  const maxTrades = (Number(span) / 1000) * MM_EVENTS_PER_1K_BLOCKS;
  const ranked = [...aggregate(logs)]
    .filter(([, s]) => s.trades <= maxTrades)
    .sort(([, a], [, b]) => (b.pnl > a.pnl ? 1 : b.pnl < a.pnl ? -1 : 0))
    .slice(0, limit);

  const traders = await Promise.all(
    ranked.map(async ([id, s]) => ({
      accountId: id.toString(),
      address: await addressOf(id),
      realizedPnl: Number(s.pnl) / 1e6,
      closes: s.closes,
      winRate: s.closes ? s.wins / s.closes : 0,
      trades: s.trades,
      markets: [...s.markets],
    })),
  );

  const value: Leaderboard = { traders, fromBlock: from.toString(), toBlock: to.toString(), source: token ? 'envio-hypersync' : 'rpc' };
  cache = { at: Date.now(), value };
  return value;
}
