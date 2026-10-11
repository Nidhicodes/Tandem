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
import { addressesOf, publicClient } from './onchain';
import { demoLabels } from './demo';

const HYPERSYNC = 'https://monad-testnet.hypersync.xyz';
const RPC_CHUNK = 100n; // public Monad RPC getLogs limit (verified 2026-10-10)
const RPC_CHUNKS = 20n;
// Fallback scan only. One HyperSync page covers ~900 blocks here (market makers flood the
// Exchange with events) and the free tier allows ~15 queries/min, so keep this to ~12 pages
// (~50 min). The deployed indexer (ENVIO_GRAPHQL_URL) is what serves the 7-day window.
const HYPERSYNC_SPAN = 10_000n;
const MM_EVENTS_PER_1K_BLOCKS = 50; // busier than this reads as a market maker, not a trader to copy
const INDEXER_MM_MAX_TRADES = 20_000; // per 7-day window; market makers here log ~100k+
const WINDOW_DAYS = 7;

export type Trader = {
  accountId: string;
  address: Hex;
  realizedPnl: number; // AUSD
  closes: number;
  winRate: number; // 0..1 over closing events
  trades: number;
  markets: number[];
  label?: string; // set for Tandem's own demo bots, which are always marked as such
};
export type Leaderboard = { traders: Trader[]; window: string; source: 'envio-indexer' | 'envio-hypersync' | 'rpc' };

type RawLog = { data: Hex; topics: [Hex, ...Hex[]] };
const topic0s = positionEvents.map((e) => encodeEventTopics({ abi: [e] })[0] as Hex);

/** POST a HyperSync query, waiting out 429s (per-minute token budget) a few times. */
async function hypersyncPost(token: string, query: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HYPERSYNC}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(query),
    });
    if (res.status !== 429 || attempt >= 3) return res;
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, (Number.isFinite(reset) && reset > 0 ? reset : 2 ** attempt * 2) * 1000));
  }
}

async function viaHyperSync(token: string, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let next = from;
  while (next < to) {
    const res = await hypersyncPost(token, {
      from_block: Number(next),
      to_block: Number(to),
      logs: [{ address: [PERPL.exchange], topics: [topic0s] }],
      field_selection: { log: ['data', 'topic0'] },
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

type Ranked = [bigint, Agg][];

const rankAndFilter = (rows: Iterable<[bigint, Agg]>, maxTrades: number, limit: number): Ranked =>
  [...rows]
    .filter(([, s]) => s.trades <= maxTrades)
    .sort(([, a], [, b]) => (b.pnl > a.pnl ? 1 : b.pnl < a.pnl ? -1 : 0))
    .slice(0, limit);

const toTraders = (ranked: Ranked, addresses: Hex[]): Trader[] => {
  const labels = demoLabels();
  return ranked.map(([id, s], i) => ({
    accountId: id.toString(),
    address: addresses[i],
    realizedPnl: Number(s.pnl) / 1e6,
    closes: s.closes,
    winRate: s.closes ? s.wins / s.closes : 0,
    trades: s.trades,
    markets: [...s.markets],
    ...(labels.has(addresses[i]?.toLowerCase()) ? { label: labels.get(addresses[i].toLowerCase()) } : {}),
  }));
};

/**
 * Preferred source: our Envio HyperIndex indexer (../indexer), which keeps per-day
 * trader rollups up to date, so this is two small GraphQL reads instead of a scan.
 */
async function viaIndexer(url: string, limit: number): Promise<Leaderboard> {
  const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), cache: 'no-store' });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`indexer -> ${res.status} ${JSON.stringify(body.errors ?? '').slice(0, 200)}`);
    return body.data as T;
  };

  const since = Math.floor(Date.now() / 1000 / 86_400) - (WINDOW_DAYS - 1);
  const { TraderDay } = await gql<{ TraderDay: { trader_id: string; realizedPnl: string; closes: number; wins: number; trades: number }[] }>(
    `query ($since: Int!) { TraderDay(where: { day: { _gte: $since } }, limit: 20000) { trader_id realizedPnl closes wins trades } }`,
    { since },
  );
  const by = new Map<bigint, Agg>();
  for (const d of TraderDay) {
    const id = BigInt(d.trader_id);
    const s = by.get(id) ?? { pnl: 0n, closes: 0, wins: 0, trades: 0, markets: new Set<number>() };
    s.pnl += BigInt(d.realizedPnl);
    s.closes += d.closes;
    s.wins += d.wins;
    s.trades += d.trades;
    by.set(id, s);
  }
  const ranked = rankAndFilter(by, INDEXER_MM_MAX_TRADES, limit);

  const { Trader } = await gql<{ Trader: { id: string; address: Hex; markets: number[] }[] }>(
    `query ($ids: [numeric!]) { Trader(where: { id: { _in: $ids } }) { id address markets } }`,
    { ids: ranked.map(([id]) => id.toString()) },
  );
  const meta = new Map(Trader.map((t) => [t.id, t]));
  for (const [id, s] of ranked) for (const m of meta.get(id.toString())?.markets ?? []) s.markets.add(m);

  return {
    traders: toTraders(ranked, ranked.map(([id]) => meta.get(id.toString())?.address ?? '0x')),
    window: `last ${WINDOW_DAYS} days`,
    source: 'envio-indexer',
  };
}

export async function leaderboard(limit = 20): Promise<Leaderboard> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;

  const indexerUrl = process.env.ENVIO_GRAPHQL_URL;
  if (indexerUrl) {
    try {
      const value = await viaIndexer(indexerUrl, limit);
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      console.error('indexer unavailable, falling back to a log scan', e);
    }
  }

  const token = process.env.ENVIO_API_TOKEN;
  const to = await publicClient.getBlockNumber();
  const span = token ? HYPERSYNC_SPAN : RPC_CHUNK * RPC_CHUNKS;
  const from = to - span + 1n;
  const logs = token ? await viaHyperSync(token, from, to) : await viaRpc(from, to);

  const ranked = rankAndFilter(aggregate(logs), (Number(span) / 1000) * MM_EVENTS_PER_1K_BLOCKS, limit);
  const value: Leaderboard = {
    traders: toTraders(ranked, await addressesOf(ranked.map(([id]) => id))),
    window: `blocks ${from}–${to}`,
    source: token ? 'envio-hypersync' : 'rpc',
  };
  cache = { at: Date.now(), value };
  return value;
}
