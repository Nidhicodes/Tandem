/**
 * Seal a small secret to the Tandem engine (X25519 ECDH + HKDF-SHA256 + AES-GCM).
 * Blob layout: ephemeralPublicKey(32) || iv(12) || ciphertext+tag.
 * Works in the browser and in Node (both expose WebCrypto as globalThis.crypto).
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const INFO = new TextEncoder().encode('tandem/agent-seal/v1');

async function aesKey(shared: Uint8Array, ephPub: Uint8Array, recipient: Uint8Array) {
  const salt = new Uint8Array([...ephPub, ...recipient]);
  const raw = hkdf(sha256, shared, salt, INFO, 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(recipientPublicKey: Uint8Array, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const key = await aesKey(x25519.getSharedSecret(eph, recipientPublicKey), ephPub, recipientPublicKey);
  eph.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return new Uint8Array([...ephPub, ...iv, ...ct]);
}

export async function unseal(recipientSecretKey: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  const ephPub = blob.slice(0, 32);
  const iv = blob.slice(32, 44);
  const recipient = x25519.getPublicKey(recipientSecretKey);
  const key = await aesKey(x25519.getSharedSecret(recipientSecretKey, ephPub), ephPub, recipient);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, blob.slice(44)));
}
