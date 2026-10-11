'use client';
/**
 * Always-on copying: keeps copying with the app closed.
 *
 * The passkey derives a dedicated agent key, enrolled with Perpl as its own trade-only API key
 * (it can never withdraw, and it's revocable on its own at perpl.xyz/apikeys). Its seed and
 * token are sealed to the Tandem engine's public key and registered, with the copy rules, in
 * the TandemAgents contract. The Chainlink CRE workflow watches the registry and wakes the
 * engine when a follower drifts from its leader.
 */
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { startAgent, stopAgent } from './agents';
import type { Rules } from './copy';
import type { Keys } from './keys';
import { enrollApiKey } from './perpl';
import { seal } from './seal';
import { loadVault, saveVault } from './vault';

export async function enableAlwaysOn(keys: Keys, follower: bigint, leader: bigint, rules: Rules) {
  const res = await fetch('/api/engine/key');
  if (!res.ok) throw new Error('The always-on engine is not available right now');
  const { publicKey } = (await res.json()) as { publicKey: Hex };

  let { agentApiKey } = await loadVault(keys);
  if (!agentApiKey) {
    agentApiKey = await enrollApiKey(keys.account, keys.agent, 'Tandem always-on agent');
    await saveVault(keys, { agentApiKey, rules, leader: leader.toString() });
  } else {
    await saveVault(keys, { rules, leader: leader.toString() });
  }
  const payload = new TextEncoder().encode(JSON.stringify({ seed: bytesToHex(keys.agentSeed), token: agentApiKey }));
  const sealed = await seal(hexToBytes(publicKey), payload);
  payload.fill(0);
  await startAgent(keys.account, { follower, leader, rules }, bytesToHex(sealed));
}

export const disableAlwaysOn = (keys: Keys) => stopAgent(keys.account);
