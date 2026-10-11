'use client';
/**
 * The user's encrypted settings: the Perpl API token (not re-derivable) and copy rules.
 *
 * One blob, AES-GCM encrypted under the passkey-derived vault key, stored on Monad in
 * TandemVault keyed by the user's address. A fresh device with the same passkey derives
 * the same address and key, reads the blob and decrypts it -- nothing to back up.
 * localStorage is only a fast cache.
 */
import { bytesToHex, createWalletClient, hexToBytes, http, parseAbi, type Hex } from 'viem';
import type { Rules } from './copy';
import type { Keys } from './keys';
import { chain } from './config';
import { publicClient } from './onchain';

export type VaultData = { perplApiKey?: string; agentApiKey?: string; rules?: Rules; leader?: string };

const VAULT = process.env.NEXT_PUBLIC_VAULT_ADDRESS as Hex | undefined;
const abi = parseAbi(['function save(bytes blob)', 'function load(address owner) view returns (bytes)']);
const cacheKey = (address: string) => `tandem:vault:${address.toLowerCase()}`;

async function encrypt(key: CryptoKey, data: VaultData): Promise<Hex> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  return bytesToHex(blob);
}

async function decrypt(key: CryptoKey, hex: Hex): Promise<VaultData> {
  const b = hexToBytes(hex);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** Read settings: on-chain copy first (works on any device), then the local cache. */
export async function loadVault(keys: Keys): Promise<VaultData> {
  const address = keys.account.address;
  let hex: Hex | undefined;
  if (VAULT) {
    const onchain = await publicClient.readContract({ address: VAULT, abi, functionName: 'load', args: [address] });
    if (onchain !== '0x') hex = onchain;
  }
  hex ??= (localStorage.getItem(cacheKey(address)) as Hex | null) ?? undefined;
  if (!hex) return {};
  localStorage.setItem(cacheKey(address), hex);
  return decrypt(keys.vault, hex);
}

/** Merge `patch` into the settings, cache locally, and persist on-chain (one tx). */
export async function saveVault(keys: Keys, patch: VaultData): Promise<VaultData> {
  const next = { ...(await loadVault(keys)), ...patch };
  const hex = await encrypt(keys.vault, next);
  localStorage.setItem(cacheKey(keys.account.address), hex);
  if (VAULT) {
    const wallet = createWalletClient({ account: keys.account, chain, transport: http() });
    const hash = await wallet.writeContract({ address: VAULT, abi, functionName: 'save', args: [hex], account: keys.account, chain });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  return next;
}

export const vaultOnChain = () => !!VAULT;
