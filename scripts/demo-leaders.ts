// Demo leader bots.
//   npm run demo:setup   fund + open Perpl accounts + enroll API keys + store sealed tokens on-chain (idempotent)
//   npm run demo:run     local runner: trade each strategy every 2 minutes (production uses /api/cron)
// Reads SPONSOR_PRIVATE_KEY from .env.local. A legacy .demo-leaders.json is migrated on-chain, then unused.
import { existsSync, readFileSync } from 'node:fs';
import { createWalletClient, formatEther, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain } from '../src/lib/config';
import { apiSigner, demoLeaders, type Leader } from '../src/lib/demo';
import { botTick, loadBotToken, storeBotToken } from '../src/lib/demo-trader';
import { balances, exchangeAccountOf, openPerplAccount, publicClient, requestAusd } from '../src/lib/onchain';
import { enrollApiKey } from '../src/lib/perpl';

const LEGACY = '.demo-leaders.json';
const legacy: Record<string, string> = existsSync(LEGACY) ? JSON.parse(readFileSync(LEGACY, 'utf8')) : {};
const log = (l: Leader, msg: string) => console.log(`${new Date().toISOString()} [${l.strategy.name}] ${msg}`);

async function setup(leaders: Leader[]) {
  const sponsor = createWalletClient({ account: privateKeyToAccount(process.env.SPONSOR_PRIVATE_KEY as Hex), chain, transport: http() });
  for (const l of leaders) {
    const account = privateKeyToAccount(l.key);
    let b = await balances(account.address);
    if (Number(b.mon) < 0.2) {
      const hash = await sponsor.sendTransaction({ to: account.address, value: parseEther('0.3') });
      await publicClient.waitForTransactionReceipt({ hash });
      log(l, 'funded 0.3 MON');
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
    if (!(await loadBotToken(l))) {
      await storeBotToken(l, legacy[account.address] ?? (await enrollApiKey(account, apiSigner(l))));
      log(l, 'stored sealed API token on-chain');
    }
    const acc = await exchangeAccountOf(account.address);
    log(l, `ready: ${account.address} account #${acc?.id} balance ${Number(acc?.balance ?? 0n) / 1e6} AUSD, ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`);
  }
}

const leaders = demoLeaders();
if (!leaders.length) throw new Error('Set SPONSOR_PRIVATE_KEY in .env.local');
const cmd = process.argv[2];
if (cmd === 'setup') await setup(leaders);
else if (cmd === 'run') {
  for (;;) {
    for (const r of await botTick()) if (r.action !== 'hold') console.log(new Date().toISOString(), `[${r.bot}]`, r.market ?? '', r.action);
    await new Promise((r) => setTimeout(r, 120_000));
  }
} else console.log('usage: demo-leaders.ts setup|run');
