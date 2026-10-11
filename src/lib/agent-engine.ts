/**
 * Always-on copy engine (server only). Reads every active agent from TandemAgents, unseals
 * its trade-only Perpl key with the engine's X25519 secret, and runs one copyStep each.
 * Triggered by the Chainlink CRE workflow (cre/) via POST /api/engine/tick, or by
 * `npm run engine` locally.
 */
import { createEd25519SigningSession } from '@category-labs/mera';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, createWalletClient, hexToBytes, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AGENTS, agentsAbi, listAgents, type Agent } from './agents';
import { chain } from './config';
import { copyStep, type EngineLog } from './engine';
import { publicClient } from './onchain';
import { markets, perplClient, type Market } from './perpl';
import { unseal } from './seal';

const sponsorKey = () => {
  const k = process.env.SPONSOR_PRIVATE_KEY;
  if (!k || k.length !== 66) throw new Error('engine not configured (SPONSOR_PRIVATE_KEY)');
  return k as Hex;
};
const derive = (info: string) => hkdf(sha256, new TextEncoder().encode(sponsorKey()), undefined, new TextEncoder().encode(info), 32);

/** The engine's X25519 keypair, derived from the sponsor key (one server secret to manage). */
const engineSecret = () => derive('tandem/engine/x25519/v1');
export const enginePublicKey = (): Hex => bytesToHex(x25519.getPublicKey(engineSecret()));

/** Bearer token the CRE workflow presents on /api/engine/tick. */
export const tickToken = (): string => bytesToHex(derive('tandem/engine/tick-token/v1')).slice(2);

export type SealedAgentKey = { seed: Hex; token: string };

async function agentClient(owner: Hex) {
  const blob = await publicClient.readContract({ address: AGENTS!, abi: agentsAbi, functionName: 'sealedKeys', args: [owner] });
  const { seed, token } = JSON.parse(new TextDecoder().decode(await unseal(engineSecret(), hexToBytes(blob)))) as SealedAgentKey;
  return perplClient(createEd25519SigningSession({ privateKey: hexToBytes(seed) }), token);
}

async function halt(owner: Hex, reason: string) {
  const operator = createWalletClient({ account: privateKeyToAccount(sponsorKey()), chain, transport: http() });
  const hash = await operator.writeContract({ address: AGENTS!, abi: agentsAbi, functionName: 'halt', args: [owner, reason] });
  await publicClient.waitForTransactionReceipt({ hash });
}

export type TickReport = { owner: Hex; leader: string; logs: EngineLog[]; error?: string };

let marketCache: { at: number; value: Market[] } | undefined;
const openMarkets = async () => {
  if (!marketCache || Date.now() - marketCache.at > 300_000) marketCache = { at: Date.now(), value: await markets() };
  return marketCache.value
    .filter((m) => m.config.is_open)
    .map((m) => ({ id: m.id, symbol: m.symbol, priceDecimals: m.config.price_decimals, sizeDecimals: m.config.size_decimals }));
};

/** One pass over every active agent (or just `only`, e.g. the owners CRE flagged as drifted). */
export async function tick(only?: Hex[]): Promise<TickReport[]> {
  if (!AGENTS) return [];
  const wanted = only && new Set(only.map((o) => o.toLowerCase()));
  const agents = (await listAgents()).filter((a) => !wanted || wanted.has(a.owner.toLowerCase()));
  const metas = await openMarkets();

  return Promise.all(
    agents.map(async (a: Agent): Promise<TickReport> => {
      const report: TickReport = { owner: a.owner, leader: a.leader.toString(), logs: [] };
      try {
        const r = await copyStep({ perpl: await agentClient(a.owner), follower: a.follower, leader: a.leader, markets: metas, rules: a.rules, halted: a.halted });
        report.logs = r.logs;
        if (r.breached) await halt(a.owner, `loss cap ${a.rules.maxLoss} AUSD hit`);
      } catch (e) {
        report.error = (e as Error).message.split('\n')[0];
      }
      return report;
    }),
  );
}
