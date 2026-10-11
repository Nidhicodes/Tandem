/**
 * Demo-bot trading, server only. One `botTick()` runs every strategy once: read the last
 * hour of 5-minute candles, decide a direction, and trade only on a change of direction.
 *
 * Each bot's Perpl API token is not re-derivable, so setup seals it to the engine and the
 * bot stores it in TandemVault under its own address. Any server holding SPONSOR_PRIVATE_KEY
 * (Vercel, the local runner) can then trade the bots with no extra secret or file.
 */
import { createWalletClient, http, parseAbi, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { enginePublicKey, sequential, unsealForEngine } from './agent-engine';
import { chain, PERPL } from './config';
import { plan } from './copy';
import { apiSigner, demoLeaders, type Leader } from './demo';
import { exchangeAccountOf, positionsOf, publicClient } from './onchain';
import { markets, perplClient, type Market } from './perpl';
import { seal } from './seal';

export const BOT_NOTIONAL = 2_000; // AUSD per position: big enough that copies are visible
export const BOT_LEVERAGE = 3;

const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS as Hex | undefined;
const vaultAbi = parseAbi(['function save(bytes blob)', 'function load(address owner) view returns (bytes)']);

/** Seal a bot's API token to the engine and store it on-chain from the bot's own address. */
export async function storeBotToken(l: Leader, token: string) {
  if (!VAULT) throw new Error('NEXT_PUBLIC_VAULT_ADDRESS not set');
  const blob = await seal(Buffer.from(enginePublicKey().slice(2), 'hex'), new TextEncoder().encode(token));
  const account = privateKeyToAccount(l.key);
  const hash = await createWalletClient({ account, chain, transport: http() }).writeContract({ address: VAULT, abi: vaultAbi, functionName: 'save', args: [toHex(blob)] });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function loadBotToken(l: Leader): Promise<string | undefined> {
  if (!VAULT) return undefined;
  const blob = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'load', args: [l.address] });
  return blob === '0x' ? undefined : new TextDecoder().decode(await unsealForEngine(blob));
}

async function closes(m: Market): Promise<number[]> {
  const to = Date.now();
  const r = await fetch(`${PERPL.api}/v1/market-data/${m.id}/candles/300/${to - 3_600_000}-${to}`, { cache: 'no-store' });
  const body = (await r.json()) as { d: { c: number }[] };
  return body.d.map((c) => c.c / 10 ** m.config.price_decimals);
}

export type BotReport = { bot: string; market?: string; action: string };

/** One decision per bot. Idempotent: it only trades when the desired direction differs from the open one. */
export async function botTick(): Promise<BotReport[]> {
  const all = await markets();
  return sequential(
    demoLeaders().map((l) => async (): Promise<BotReport> => {
      const bot = l.strategy.name;
      try {
        const m = all.find((x) => x.symbol === l.strategy.market && x.config.is_open);
        const [token, acc] = await Promise.all([loadBotToken(l), exchangeAccountOf(l.address)]);
        if (!m || !token || !acc) return { bot, action: 'not set up (run npm run demo:setup)' };
        const c = await closes(m);
        if (c.length < 6) return { bot, market: m.symbol, action: 'waiting for candles' };
        const side = l.strategy.signal(c);
        const [pos] = await positionsOf([[m.id, acc.id]]);
        if (Math.sign(Number(pos.lot)) === side) return { bot, market: m.symbol, action: 'hold' };
        const lot = BigInt(Math.floor((BOT_NOTIONAL / c[c.length - 1]) * 10 ** m.config.size_decimals));
        const perpl = perplClient(apiSigner(l), token);
        const { lfr, id } = await perpl.account();
        const orders = plan(pos.lot, BigInt(side) * lot, m.id).map((o, i) => ({ ...o, rq: lfr + 1 + i, acc: id, p: 0, fl: 4, lv: BOT_LEVERAGE * 100, lb: 0, ms: 100 }));
        const statuses = await perpl.submit(orders);
        return { bot, market: m.symbol, action: `${side === 1 ? 'LONG' : side === -1 ? 'SHORT' : 'FLAT'} -> ${statuses.map((s) => s.code).join(',')}` };
      } catch (e) {
        return { bot, action: `error: ${(e as Error).message.split('\n')[0]}` };
      }
    }),
  );
}
