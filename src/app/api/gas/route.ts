/**
 * Gas sponsor: a fresh passkey account holds 0 MON, so it cannot pay for its first
 * transaction. This route tops it up with a small, fixed amount of testnet MON.
 *
 * Abuse limits (the endpoint is public by design -- anyone onboarding must reach it):
 *   - only funds addresses whose balance is below FLOOR (no draining by repeat calls)
 *   - one drip per address per process lifetime
 *   - fixed DRIP amount; the sponsor key should hold only a small testnet float
 */
import { NextResponse } from 'next/server';
import { createWalletClient, http, isAddress, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain } from '@/lib/config';
import { publicClient } from '@/lib/onchain';

const DRIP = parseEther('0.2');
const FLOOR = parseEther('0.05');
const served = new Set<string>();

export async function POST(req: Request) {
  const key = process.env.SPONSOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return NextResponse.json({ error: 'sponsor not configured' }, { status: 503 });

  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 });

  const id = address.toLowerCase();
  if (served.has(id)) return NextResponse.json({ error: 'already funded' }, { status: 429 });
  if ((await publicClient.getBalance({ address })) >= FLOOR) return NextResponse.json({ funded: false });

  served.add(id);
  try {
    const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http() });
    const hash = await wallet.sendTransaction({ to: address, value: DRIP });
    await publicClient.waitForTransactionReceipt({ hash });
    // The RPC can report the receipt before the new balance is usable, and the user's very
    // next tx then fails with "Signer had insufficient balance" (seen live; Monad validates
    // against slightly delayed state). Wait until it shows, then let a few blocks pass.
    for (let i = 0; i < 20 && (await publicClient.getBalance({ address })) < FLOOR; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 2000));
    return NextResponse.json({ funded: true, hash });
  } catch (e) {
    served.delete(id);
    return NextResponse.json({ error: (e as Error).message.split('\n')[0] }, { status: 502 });
  }
}
