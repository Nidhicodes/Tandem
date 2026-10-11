/**
 * Sponsor treasury (server only). New accounts get their starter MON and AUSD from the
 * sponsor wallet instead of the public AUSD faucet, which allows ~1 claim per minute across
 * every caller and so stalls when several people sign up at once (judging, a demo).
 * The heartbeat keeps the treasury topped up by claiming the faucet whenever it's free.
 */
import { createWalletClient, erc20Abi, http, parseAbi, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AUSD, chain } from './config';
import { publicClient } from './onchain';

export const STARTER_MON = parseEther('0.1'); // a full onboarding + agent start used ~0.06 live
export const STARTER_AUSD = 1_000n * 10n ** BigInt(AUSD.decimals);
const TREASURY_TARGET = 50_000n * 10n ** BigInt(AUSD.decimals);
const faucetAbi = parseAbi(['function requestFunds(address to)']);

const sponsor = () => {
  const k = process.env.SPONSOR_PRIVATE_KEY as Hex | undefined;
  if (!k || k.length !== 66) throw new Error('sponsor not configured');
  return createWalletClient({ account: privateKeyToAccount(k), chain, transport: http() });
};

export async function treasury() {
  const w = sponsor();
  const [mon, ausd] = await Promise.all([
    publicClient.getBalance({ address: w.account.address }),
    publicClient.readContract({ address: AUSD.token, abi: erc20Abi, functionName: 'balanceOf', args: [w.account.address] }),
  ]);
  return { address: w.account.address, mon, ausd };
}

/** Send AUSD from the treasury; false if it can't cover it (the client then uses the faucet). */
export async function sendStarterAusd(to: Hex): Promise<boolean> {
  const w = sponsor();
  if ((await treasury()).ausd < STARTER_AUSD) return false;
  const hash = await w.writeContract({ address: AUSD.token, abi: erc20Abi, functionName: 'transfer', args: [to, STARTER_AUSD] });
  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}

/** Claim the faucet into the treasury if it is below target and the faucet is free right now. */
export async function refillTreasury(): Promise<string> {
  const w = sponsor();
  const t = await treasury();
  if (t.ausd >= TREASURY_TARGET) return 'full';
  try {
    await publicClient.simulateContract({ account: w.account, address: AUSD.faucet, abi: faucetAbi, functionName: 'requestFunds', args: [w.account.address] });
  } catch {
    return 'faucet busy';
  }
  const hash = await w.writeContract({ address: AUSD.faucet, abi: faucetAbi, functionName: 'requestFunds', args: [w.account.address] });
  await publicClient.waitForTransactionReceipt({ hash });
  return 'claimed';
}
