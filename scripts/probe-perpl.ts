// Dev probe: can a fresh wallet enroll a Perpl testnet API key from our Origin?
// Usage: ORIGIN=http://localhost:3000 npm run probe:perpl
import * as ed from '@noble/ed25519';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hashTypedData, toHex } from 'viem';

const API = 'https://testnet.perpl.xyz/api';
const ORIGIN = process.env.ORIGIN; // unset = no Origin header (server-side caller)
const wallet = privateKeyToAccount(generatePrivateKey());
const { secretKey, publicKey } = await ed.keygenAsync();

const post = (path: string, body: unknown) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ORIGIN ? { Origin: ORIGIN } : {}) },
    body: JSON.stringify(body),
  });

const payloadRes = await post('/v1/api-key/payload', {
  chain_id: 10143, address: wallet.address, public_key: toHex(publicKey), scope_mask: 3, label: 'tandem-probe',
});
console.log('payload', payloadRes.status);
if (!payloadRes.ok) { console.log(await payloadRes.text()); process.exit(1); }
const { typed_data, mac } = await payloadRes.json();

const { EIP712Domain, ...types } = typed_data.types;
const args = { domain: { ...typed_data.domain, chainId: Number(typed_data.domain.chainId) }, types, primaryType: typed_data.primaryType, message: typed_data.message };
const signature = await wallet.signTypedData(args);
const pop = await ed.signAsync(Buffer.from(hashTypedData(args).slice(2), 'hex'), secretKey);

const enrollRes = await post('/v1/api-key/enroll', {
  chain_id: 10143, address: wallet.address, typed_data, mac, signature, pop_signature: toHex(pop),
});
console.log('enroll', enrollRes.status, (await enrollRes.text()).slice(0, 300));
