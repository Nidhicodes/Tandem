// Seal tests. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { seal, unseal } from '../src/lib/seal';

const enc = (s: string) => new TextEncoder().encode(s);

test('seal round-trips to the recipient only', async () => {
  const sk = x25519.utils.randomSecretKey();
  const blob = await seal(x25519.getPublicKey(sk), enc('{"seed":"0xabc","token":"t"}'));
  assert.equal(new TextDecoder().decode(await unseal(sk, blob)), '{"seed":"0xabc","token":"t"}');
  await assert.rejects(unseal(x25519.utils.randomSecretKey(), blob)); // wrong key
});

test('seal is randomized and tamper-evident', async () => {
  const sk = x25519.utils.randomSecretKey();
  const pk = x25519.getPublicKey(sk);
  const a = await seal(pk, enc('same'));
  const b = await seal(pk, enc('same'));
  assert.notDeepEqual(a, b);
  a[a.length - 1] ^= 1;
  await assert.rejects(unseal(sk, a));
});

test('a realistic agent payload fits the registry limit', async () => {
  const payload = JSON.stringify({ seed: `0x${'ab'.repeat(32)}`, token: 'x'.repeat(64) });
  const blob = await seal(x25519.getPublicKey(x25519.utils.randomSecretKey()), enc(payload));
  assert.ok(blob.length <= 512, `sealed ${blob.length} bytes`);
});
