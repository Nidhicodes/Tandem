/** Onchain actions on Monad testnet: balances, AUSD faucet, Perpl account setup, position reads. */
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseAbi, type LocalAccount } from 'viem';
import { AUSD, chain, PERPL } from './config';
import { exchangeAbi, LONG } from './exchange-abi';

export const publicClient = createPublicClient({ chain, transport: http() });

const faucetAbi = parseAbi(['function requestFunds(address to)']);

export async function balances(address: `0x${string}`) {
  const [mon, ausd] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: AUSD.token, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ]);
  return { mon: formatUnits(mon, 18), ausd: formatUnits(ausd, AUSD.decimals), ausdRaw: ausd };
}

const wallet = (account: LocalAccount) => createWalletClient({ account, chain, transport: http() });

async function send(account: LocalAccount, tx: Parameters<ReturnType<typeof wallet>['writeContract']>[0]) {
  const hash = await wallet(account).writeContract(tx);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Mint testnet AUSD from Agora's faucet (selector-verified: requestFunds(address)). */
export const requestAusd = (account: LocalAccount) =>
  send(account, { address: AUSD.faucet, abi: faucetAbi, functionName: 'requestFunds', args: [account.address], account, chain });

/**
 * Approve + createAccount on the Perpl Exchange with `amount` raw AUSD (6 decimals),
 * then allow order forwarding -- Perpl only executes API-placed orders for accounts
 * that opted in (api-docs README "Enabling Order Forwarding").
 */
export async function openPerplAccount(account: LocalAccount, amount: bigint) {
  await send(account, { address: AUSD.token, abi: erc20Abi, functionName: 'approve', args: [PERPL.exchange, amount], account, chain });
  await send(account, { address: PERPL.exchange, abi: exchangeAbi, functionName: 'createAccount', args: [amount], account, chain });
  return send(account, { address: PERPL.exchange, abi: exchangeAbi, functionName: 'allowOrderForwarding', args: [true], account, chain });
}

/** Exchange account id for a wallet, or undefined if it has none. */
export async function accountIdOf(address: `0x${string}`): Promise<bigint | undefined> {
  return (await exchangeAccountOf(address))?.id;
}

/** Exchange account id and free collateral balance (6-decimal AUSD), or undefined if none. */
export async function exchangeAccountOf(address: `0x${string}`): Promise<{ id: bigint; balance: bigint; locked: bigint } | undefined> {
  const a = await publicClient.readContract({ address: PERPL.exchange, abi: exchangeAbi, functionName: 'getAccountByAddr', args: [address] });
  return a.accountId === 0n ? undefined : { id: a.accountId, balance: a.balanceCNS, locked: a.lockedBalanceCNS };
}

export async function addressOf(accountId: bigint): Promise<`0x${string}`> {
  const a = await publicClient.readContract({ address: PERPL.exchange, abi: exchangeAbi, functionName: 'getAccountById', args: [accountId] });
  return a.accountAddr;
}

/** Many account addresses in one eth_call (Multicall3), to stay under the RPC's 15 req/s limit. */
export async function addressesOf(ids: bigint[]): Promise<`0x${string}`[]> {
  const results = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: PERPL.exchange, abi: exchangeAbi, functionName: 'getAccountById', args: [id] }) as const),
  });
  return results.map((a) => a.accountAddr);
}

/** A position as a signed lot (+long / -short, scaled) plus entry price, PnL and the market's mark price. */
export type Pos = { lot: bigint; pnl: bigint; mark: bigint; entry: bigint; deposit: bigint };

export async function positionOf(perpId: number, accountId: bigint): Promise<Pos> {
  return (await positionsOf([[perpId, accountId]]))[0];
}

/** Many positions in one eth_call (Multicall3). */
export async function positionsOf(pairs: [perpId: number, accountId: bigint][]): Promise<Pos[]> {
  const results = await publicClient.multicall({
    allowFailure: false,
    contracts: pairs.map(([perp, acc]) => ({
      address: PERPL.exchange, abi: exchangeAbi, functionName: 'getPositionV2', args: [BigInt(perp), acc],
    }) as const),
  });
  return results.map(([p, mark]) => {
    if (p.lotLNS === 0n) return { lot: 0n, pnl: 0n, mark, entry: 0n, deposit: 0n }; // no position reads back as lot 0 (verified live)
    return { lot: p.positionType === LONG ? p.lotLNS : -p.lotLNS, pnl: p.pnlCNS, mark, entry: p.pricePNS, deposit: p.depositCNS };
  });
}
