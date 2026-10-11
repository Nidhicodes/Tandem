// Compile + deploy TandemVault to Monad testnet with the sponsor key.
// Usage: npm run deploy:vault   (reads SPONSOR_PRIVATE_KEY from .env.local)
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain } from '../src/lib/config';
import { publicClient } from '../src/lib/onchain';

const source = readFileSync(new URL('../contracts/TandemVault.sol', import.meta.url), 'utf8');
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { 'TandemVault.sol': { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
    }),
  ),
);
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
const { evm } = out.contracts['TandemVault.sol'].TandemVault;

const key = process.env.SPONSOR_PRIVATE_KEY as Hex | undefined;
if (!key || key.length !== 66) throw new Error('Set SPONSOR_PRIVATE_KEY in .env.local');
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http() });

const hash = await wallet.deployContract({ abi: [], bytecode: `0x${evm.bytecode.object}` });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`TandemVault deployed at ${receipt.contractAddress} (tx ${hash})`);
console.log(`Add to .env.local: NEXT_PUBLIC_VAULT_ADDRESS=${receipt.contractAddress}`);
