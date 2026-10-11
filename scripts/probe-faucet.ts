// Dev probe: confirm the Agora AUSD faucet's requestFunds(address) simulates for a fresh address.
import { createPublicClient, http, parseAbi } from 'viem';
import { monadTestnet } from 'viem/chains';

const client = createPublicClient({ chain: monadTestnet, transport: http() });
const who = '0x000000000000000000000000000000000000dEaD';
try {
  await client.simulateContract({
    address: '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C',
    abi: parseAbi(['function requestFunds(address to)']),
    functionName: 'requestFunds',
    args: [who],
    account: who,
  });
  console.log('requestFunds simulates OK');
} catch (e) {
  console.log('revert:', (e as Error).message.split('\n').slice(0, 4).join(' | '));
}
