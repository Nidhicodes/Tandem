// Compile + deploy a Tandem contract to Monad testnet with the sponsor key.
// Usage: npm run deploy:vault | npm run deploy:agents   (reads SPONSOR_PRIVATE_KEY from .env.local)
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { createWalletClient, http, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain } from '../src/lib/config';
import { publicClient } from '../src/lib/onchain';

const name = process.argv[2];
const ENV: Record<string, string> = { TandemVault: 'NEXT_PUBLIC_VAULT_ADDRESS', TandemAgents: 'NEXT_PUBLIC_AGENTS_ADDRESS' };
if (!ENV[name]) throw new Error(`usage: deploy-contract.ts ${Object.keys(ENV).join('|')}`);

const file = `${name}.sol`;
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { [file]: { content: readFileSync(new URL(`../contracts/${file}`, import.meta.url), 'utf8') } },
      settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
    }),
  ),
);
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
const { abi, evm } = out.contracts[file][name] as { abi: Abi; evm: { bytecode: { object: string } } };

const key = process.env.SPONSOR_PRIVATE_KEY as Hex | undefined;
if (!key || key.length !== 66) throw new Error('Set SPONSOR_PRIVATE_KEY in .env.local');
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http() });

// TandemAgents' operator (who may mark an agent halted) is the engine, i.e. the sponsor.
const args = name === 'TandemAgents' ? [account.address] : [];
const hash = await wallet.deployContract({ abi, bytecode: `0x${evm.bytecode.object}`, args });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`${name} deployed at ${receipt.contractAddress} (tx ${hash})`);
console.log(`Add to .env.local: ${ENV[name]}=${receipt.contractAddress}`);
