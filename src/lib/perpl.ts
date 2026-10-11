/**
 * Minimal Perpl REST client. Requests are signed with an Ed25519 API key per
 * docs.perpl.xyz/resources/for-developers/api/authentication.
 *
 * In the browser every call goes through our same-origin relay (/api/perpl), since
 * Perpl rejects non-allowlisted browser Origins. Signatures are always made here,
 * client-side; the relay only forwards them.
 */
import type { Ed25519SigningSession } from '@category-labs/mera';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hashTypedData, hexToBytes, toHex, type LocalAccount, type TypedDataDefinition } from 'viem';
import { PERPL } from './config';

const base = () => (typeof window === 'undefined' ? PERPL.api : '/api/perpl');
const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nonce = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

/** One order of a batch (api-docs types.md#orderspec). */
export type OrderSpec = {
  rq: number; // request id, strictly increasing per account
  mkt: number;
  acc: number;
  t: number; // 1 OpenLong, 2 OpenShort, 3 CloseLong, 4 CloseShort
  p: number; // 0 = market
  s: number; // scaled size
  fl: number; // 4 = ImmediateOrCancel
  lv: number; // leverage, hundredths
  lb: number; // 0 = market's max execution window
  ms?: number; // max market slippage, bps
};
export type Status = { code: number; error?: string };
export type ExchangeAccount = { id: number; lfr: number; fw: boolean };

export type PerplClient = ReturnType<typeof perplClient>;

export function perplClient(signer: Ed25519SigningSession, apiKey: string) {
  async function request<T>(method: 'GET' | 'POST', target: string, body?: unknown): Promise<T> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = Date.now().toString();
    const n = nonce();
    const canonical = [PERPL.chainId, method, target, ts, n, bytesToHex(sha256(enc.encode(raw))).slice(2)].join('\n');
    const sig = await signer.signMessage(enc.encode(canonical));
    const res = await fetch(`${base()}${target}`, {
      method,
      headers: {
        'X-API-Key': apiKey,
        'X-API-Timestamp': ts,
        'X-API-Nonce': n,
        'X-API-Signature': b64url(sig),
        ...(raw ? { 'Content-Type': 'application/json' } : {}),
      },
      body: raw || undefined,
    });
    if (!res.ok) throw new Error(`Perpl ${method} ${target} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  return {
    /** The wallet's exchange account: id, last accepted request id, order-forwarding flag. */
    async account(): Promise<ExchangeAccount> {
      const w = await request<{ as?: ExchangeAccount[] }>('GET', '/v1/trading/wallet');
      const acc = w.as?.[0];
      if (!acc) throw new Error('wallet holds no Perpl exchange account');
      return acc;
    },
    /** Submit up to 100 orders. A 0 code means forwarded, not filled. */
    async submit(orders: OrderSpec[]): Promise<Status[]> {
      const r = await request<{ status?: Status; statuses?: Status[] }>('POST', '/v1/trading/orders', { d: orders });
      if (r.status?.code) throw new Error(`batch refused: ${r.status.code} ${r.status.error ?? ''}`);
      return r.statuses ?? [];
    },
  };
}

/** Public market context (no auth): market ids, decimals, instance limits. */
export type Market = { id: number; symbol: string; config: { price_decimals: number; size_decimals: number; is_open: boolean } };
export const markets = async (): Promise<Market[]> =>
  (await (await fetch(`${base()}/v1/pub/context`)).json()).markets;

/**
 * Enroll the passkey-derived Ed25519 key for this wallet. Requires an on-chain
 * exchange account (else 404). Scope 3 = read|trade. API keys can never withdraw.
 */
export async function enrollApiKey(account: LocalAccount, signer: Ed25519SigningSession): Promise<string> {
  const post = (path: string, body: unknown) =>
    fetch(`${base()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const payload = await post('/v1/api-key/payload', {
    chain_id: PERPL.chainId,
    address: account.address,
    public_key: toHex(signer.publicKey),
    scope_mask: 3,
    label: 'Tandem copy agent',
  });
  if (!payload.ok) throw new Error(`Perpl key payload -> ${payload.status}`);
  const { typed_data, mac } = await payload.json();

  // Perpl returns domain.chainId as hex; viem wants a number.
  const { EIP712Domain: _, ...types } = typed_data.types;
  const def = {
    domain: { ...typed_data.domain, chainId: Number(typed_data.domain.chainId) },
    types,
    primaryType: typed_data.primaryType,
    message: typed_data.message,
  } as TypedDataDefinition;

  const signature = await account.signTypedData(def);
  const pop = await signer.signMessage(hexToBytes(hashTypedData(def)));

  const enroll = await post('/v1/api-key/enroll', {
    chain_id: PERPL.chainId,
    address: account.address,
    typed_data,
    mac,
    signature,
    pop_signature: toHex(pop),
  });
  if (enroll.status === 409) throw new Error('This trading key is already enrolled (409)');
  if (!enroll.ok) throw new Error(`Perpl key enroll -> ${enroll.status}`);
  const info = await enroll.json();
  return info.api_key?.api_key ?? info.api_key;
}
