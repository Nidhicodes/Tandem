'use client';
/**
 * One passkey -> every key Tandem needs, with nothing secret stored anywhere.
 *
 * A single WebAuthn ceremony returns 32 PRF bytes (the root). Each purpose gets its
 * own key from an isolated HKDF namespace, so compromising one never exposes another:
 *   - evm   : the Monad account (BIP-39/BIP-32, m/44'/60'/0'/0/0, same as mera's recipe)
 *   - perpl : the Ed25519 Perpl API key; the agent can trade with it but can never withdraw
 *   - vault : AES-GCM key that encrypts the user's copy rules + Perpl token at rest
 *   - agent : a second, separately enrolled trade-only Perpl key the user can hand to the
 *             always-on engine (sealed to it), revocable without touching the others
 * The same passkey on a fresh device reproduces all four.
 */
import {
  createEd25519SigningSession,
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  type Ed25519SigningSession,
} from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { LocalAccount } from 'viem';
import { RP_NAME } from './config';

export type Keys = {
  account: LocalAccount; // EVM signer (Monad)
  perpl: Ed25519SigningSession; // Perpl API-key signer
  vault: CryptoKey; // non-extractable AES-GCM key
  agent: Ed25519SigningSession; // always-on agent key signer
  agentSeed: Uint8Array; // raw agent seed, only ever sealed to the engine; zeroed by end()
  end(): void; // zero every in-memory private key
};

const NAMESPACE = {
  perpl: 'tandem/perpl-api-key/v1',
  vault: 'tandem/vault/v1',
  agent: 'tandem/agent-key/v1',
} as const;

const derive = (root: Uint8Array, info: string) =>
  hkdf(sha256, root, undefined, new TextEncoder().encode(info), 32);

async function fromRoot(root: Uint8Array): Promise<Keys> {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(root, wordlist))).derive(
    "m/44'/60'/0'/0/0",
  );
  if (!node.privateKey) throw new Error('EVM derivation produced no key');

  const evmSession = createSecp256k1SigningSession({ privateKey: node.privateKey });
  const perplSeed = derive(root, NAMESPACE.perpl);
  const perpl = createEd25519SigningSession({ privateKey: perplSeed });
  const vaultSeed = derive(root, NAMESPACE.vault);
  const vault = await crypto.subtle.importKey('raw', vaultSeed, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const agentSeed = derive(root, NAMESPACE.agent);
  const agent = createEd25519SigningSession({ privateKey: agentSeed.slice() });

  // Sessions and WebCrypto hold their own copies; wipe ours.
  for (const b of [root, node.privateKey, perplSeed, vaultSeed]) b.fill(0);

  return {
    account: toViemAccount(evmSession),
    perpl,
    vault,
    agent,
    agentSeed,
    end() {
      evmSession.end();
      perpl.end();
      agent.end();
      agentSeed.fill(0);
    },
  };
}

const rpId = () => window.location.hostname;

/** First visit: one prompt creates the passkey and returns every key. */
export async function createAccount(name: string): Promise<Keys> {
  const { prfOutput } = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: RP_NAME },
    user: { name, displayName: name },
  });
  return fromRoot(prfOutput);
}

/** Any later visit, any device: one prompt, same keys. No local state required. */
export async function signIn(): Promise<Keys> {
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: rpId() });
  return fromRoot(prfOutput);
}
