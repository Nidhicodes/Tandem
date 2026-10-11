'use client';
/**
 * Small encrypted store under the passkey-derived vault key (AES-GCM, non-extractable).
 * Holds things that can't be re-derived, like the Perpl API token, plus copy rules.
 * Ciphertext lives in localStorage for now; syncing it to a server is what makes it
 * restore on a fresh device.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const slot = (address: string, name: string) => `tandem:${address.toLowerCase()}:${name}`;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(key: CryptoKey, address: string, name: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  localStorage.setItem(slot(address, name), `${b64(iv)}.${b64(ct)}`);
}

export async function open<T>(key: CryptoKey, address: string, name: string): Promise<T | undefined> {
  const raw = localStorage.getItem(slot(address, name));
  if (!raw) return undefined;
  const [iv, ct] = raw.split('.').map(unb64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt)) as T;
}
