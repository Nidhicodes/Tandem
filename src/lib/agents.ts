/**
 * TandemAgents registry client (browser + server). Who copies whom, with what rules, and
 * the follower's trade-only agent key sealed to the engine.
 */
import { createWalletClient, http, parseAbi, type Hex, type LocalAccount } from 'viem';
import type { Rules } from './copy';
import { chain } from './config';
import { publicClient } from './onchain';

export const AGENTS = process.env.NEXT_PUBLIC_AGENTS_ADDRESS as Hex | undefined;

const AGENT = '(uint64 follower, uint64 leader, uint32 ratioBps, uint32 maxNotional, uint16 leverage, uint32 maxLoss, bool halted)';
export const agentsAbi = parseAbi([
  `function start(${AGENT} a, bytes sealedKey)`,
  'function stop()',
  'function halt(address owner, string reason)',
  'function count() view returns (uint256)',
  `function list(uint256 offset, uint256 limit) view returns (address[] who, ${AGENT}[] what)`,
  `function agents(address) view returns (uint64 follower, uint64 leader, uint32 ratioBps, uint32 maxNotional, uint16 leverage, uint32 maxLoss, bool halted)`,
  'function sealedKeys(address) view returns (bytes)',
]);

export type Agent = { owner: Hex; follower: bigint; leader: bigint; rules: Rules; halted: boolean };

const toAgent = (owner: Hex, a: { follower: bigint; leader: bigint; ratioBps: number; maxNotional: number; leverage: number; maxLoss: number; halted: boolean }): Agent => ({
  owner,
  follower: a.follower,
  leader: a.leader,
  rules: { ratioBps: a.ratioBps, maxNotional: a.maxNotional, leverage: a.leverage, maxLoss: a.maxLoss },
  halted: a.halted,
});

export async function listAgents(): Promise<Agent[]> {
  if (!AGENTS) return [];
  const out: Agent[] = [];
  for (let offset = 0n; ; offset += 50n) {
    const [who, what] = await publicClient.readContract({ address: AGENTS, abi: agentsAbi, functionName: 'list', args: [offset, 50n] });
    who.forEach((w, i) => out.push(toAgent(w, what[i])));
    if (who.length < 50) return out;
  }
}

/** The caller's active agent, or undefined. */
export async function agentOf(owner: Hex): Promise<Agent | undefined> {
  if (!AGENTS) return undefined;
  const [follower, leader, ratioBps, maxNotional, leverage, maxLoss, halted] = await publicClient.readContract({
    address: AGENTS, abi: agentsAbi, functionName: 'agents', args: [owner],
  });
  return follower === 0n ? undefined : toAgent(owner, { follower, leader, ratioBps, maxNotional, leverage, maxLoss, halted });
}

const wallet = (account: LocalAccount) => {
  if (!AGENTS) throw new Error('Always-on copying is not configured (NEXT_PUBLIC_AGENTS_ADDRESS)');
  return { address: AGENTS, client: createWalletClient({ account, chain, transport: http() }) };
};

export async function startAgent(account: LocalAccount, a: Omit<Agent, 'owner' | 'halted'>, sealedKey: Hex) {
  const { address, client } = wallet(account);
  const agent = {
    follower: a.follower, leader: a.leader, ratioBps: a.rules.ratioBps, maxNotional: Math.floor(a.rules.maxNotional),
    leverage: Math.floor(a.rules.leverage), maxLoss: Math.floor(a.rules.maxLoss), halted: false,
  };
  const hash = await client.writeContract({ address, abi: agentsAbi, functionName: 'start', args: [agent, sealedKey], account, chain });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function stopAgent(account: LocalAccount) {
  const { address, client } = wallet(account);
  const hash = await client.writeContract({ address, abi: agentsAbi, functionName: 'stop', account, chain });
  await publicClient.waitForTransactionReceipt({ hash });
}
