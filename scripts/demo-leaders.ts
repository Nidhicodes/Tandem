// Demo leader bots: one-time setup, then a trading loop.
//   npm run demo:setup   fund + open Perpl accounts + enroll API keys (idempotent)
//   npm run demo:run     trade each strategy every 2 minutes
// Reads SPONSOR_PRIVATE_KEY from .env.local. API tokens are kept in .demo-leaders.json (gitignored).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createWalletClient, formatEther, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, PERPL } from '../src/lib/config';
import { plan } from '../src/lib/copy';
import { apiSigner, demoLeaders, type Leader } from '../src/lib/demo';
import { balances, exchangeAccountOf, openPerplAccount, positionsOf, publicClient, requestAusd } from '../src/lib/onchain';
import { enrollApiKey, markets, perplClient, type Market } from '../src/lib/perpl';

const TOKENS = '.demo-leaders.json';
const NOTIONAL = 40; // AUSD per position
const LEVERAGE = 3;
const EVERY_MS = 120_000;

const tokens: Record<string, string> = existsSync(TOKENS) ? JSON.parse(readFileSync(TOKENS, 'utf8')) : {};
const saveTokens = () => writeFileSync(TOKENS, JSON.stringify(tokens, null, 2));
const log = (l: Leader, msg: string) => console.log(`${new Date().toISOString()} [${l.strategy.name}] ${msg}`);

async function setup(leaders: Leader[]) {
  const sponsor = createWalletClient({ account: privateKeyToAccount(process.env.SPONSOR_PRIVATE_KEY as Hex), chain, transport: http() });
  for (const l of leaders) {
    const account = privateKeyToAccount(l.key);
    let b = await balances(account.address);
    if (Number(b.mon) < 0.2) {
      const hash = await sponsor.sendTransaction({ to: account.address, value: parseEther('0.3') });
      await publicClient.waitForTransactionReceipt({ hash });
      log(l, `funded 0.3 MON`);
    }
    if (!(await exchangeAccountOf(account.address))) {
      for (let i = 0; i < 5 && b.ausdRaw < 100n * 10n ** 6n; i++) {
        await requestAusd(account);
        b = await balances(account.address);
        log(l, `faucet -> ${b.ausd} AUSD`);
      }
      await openPerplAccount(account, b.ausdRaw);
      log(l, `opened Perpl account with ${b.ausd} AUSD`);
    }
    if (!tokens[account.address]) {
      tokens[account.address] = await enrollApiKey(account, apiSigner(l));
      saveTokens();
      log(l, 'enrolled API key');
    }
    const acc = await exchangeAccountOf(account.address);
    log(l, `ready: ${account.address} account #${acc?.id} balance ${Number(acc?.balance ?? 0n) / 1e6} AUSD, ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`);
  }
}

async function closes(m: Market): Promise<number[]> {
  const to = Date.now();
  const r = await fetch(`${PERPL.api}/v1/market-data/${m.id}/candles/300/${to - 3_600_000}-${to}`);
  const body = (await r.json()) as { d: { c: number }[] };
  return body.d.map((c) => c.c / 10 ** m.config.price_decimals);
}

async function tick(leaders: Leader[], all: Market[]) {
  for (const l of leaders) {
    try {
      const m = all.find((x) => x.symbol === l.strategy.market && x.config.is_open);
      const token = tokens[privateKeyToAccount(l.key).address];
      const acc = await exchangeAccountOf(privateKeyToAccount(l.key).address);
      if (!m || !token || !acc) {
        log(l, 'not set up; run npm run demo:setup');
        continue;
      }
      const c = await closes(m);
      if (c.length < 6) continue;
      const side = l.strategy.signal(c);
      const [pos] = await positionsOf([[m.id, acc.id]]);
      const lot = BigInt(Math.floor((NOTIONAL / c[c.length - 1]) * 10 ** m.config.size_decimals));
      const target = BigInt(side) * lot;
      // Only act on a change of direction, not on price drift of an existing position.
      if (Math.sign(Number(pos.lot)) === side) continue;
      const perpl = perplClient(apiSigner(l), token);
      const { lfr, id } = await perpl.account();
      const orders = plan(pos.lot, target, m.id).map((o, i) => ({ ...o, rq: lfr + 1 + i, acc: id, p: 0, fl: 4, lv: LEVERAGE * 100, lb: 0, ms: 100 }));
      const statuses = await perpl.submit(orders);
      log(l, `${side === 1 ? 'LONG' : side === -1 ? 'SHORT' : 'FLAT'} ${m.symbol} -> ${statuses.map((s) => s.code).join(',')}`);
    } catch (e) {
      log(l, `error: ${(e as Error).message}`);
    }
  }
}

const leaders = demoLeaders();
if (!leaders.length) throw new Error('Set SPONSOR_PRIVATE_KEY in .env.local');
const cmd = process.argv[2];
if (cmd === 'setup') await setup(leaders);
else if (cmd === 'run') {
  const all = await markets();
  for (;;) {
    await tick(leaders, all);
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
} else console.log('usage: demo-leaders.ts setup|run');
