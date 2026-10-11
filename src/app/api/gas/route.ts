/**
 * Starter kit: a fresh passkey account holds 0 MON and 0 AUSD, so it can't pay for its first
 * transaction. This route sends it STARTER_MON and, while the treasury can cover it,
 * STARTER_AUSD (falling back to the public faucet client-side when it can't).
 *
 * Abuse limits (the endpoint is public by design -- anyone onboarding must reach it):
 *   - only funds addresses whose MON balance is below FLOOR (no draining by repeat calls)
 *   - AUSD only to addresses holding less than Perpl's 100 AUSD minimum
 *   - one kit per address per process lifetime; fixed amounts; a small testnet-only float
 */
import { NextResponse } from 'next/server';
import { createWalletClient, erc20Abi, http, isAddress, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AUSD, chain } from '@/lib/config';
import { publicClient } from '@/lib/onchain';
import { sendStarterAusd, STARTER_MON } from '@/lib/treasury';

const FLOOR = parseEther('0.05');
const MIN_AUSD = 100n * 10n ** BigInt(AUSD.decimals);
const served = new Set<string>();

export async function POST(req: Request) {
  const key = process.env.SPONSOR_PRIVATE_KEY as Hex | undefined;
  if (!key) return NextResponse.json({ error: 'sponsor not configured' }, { status: 503 });

  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 });

  const id = address.toLowerCase();
  if (served.has(id)) return NextResponse.json({ error: 'already funded' }, { status: 429 });
  const [mon, ausd] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: AUSD.token, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ]);
  if (mon >= FLOOR) return NextResponse.json({ funded: false });

  served.add(id);
  try {
    const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http() });
    const hash = await wallet.sendTransaction({ to: address, value: STARTER_MON });
    await publicClient.waitForTransactionReceipt({ hash });
    // Both sends come from the sponsor, so they run in order (same nonce sequence).
    const gotAusd = ausd < MIN_AUSD ? await sendStarterAusd(address).catch(() => false) : false;
    // The RPC can report the receipt before the new balance is usable, and the user's very
    // next tx then fails with "Signer had insufficient balance" (seen live; Monad validates
    // against slightly delayed state). Wait until it shows, then let a few blocks pass.
    for (let i = 0; i < 20 && (await publicClient.getBalance({ address })) < FLOOR; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 2000));
    return NextResponse.json({ funded: true, ausd: gotAusd, hash });
  } catch (e) {
    served.delete(id);
    return NextResponse.json({ error: (e as Error).message.split('\n')[0] }, { status: 502 });
  }
}
