/**
 * Tandem copy-sentinel: a Chainlink CRE workflow.
 *
 * Every 30s the DON reads the TandemAgents registry and every agent's leader/follower
 * positions straight from the Perpl Exchange on Monad (consensus-verified EVM reads), runs
 * Tandem's own drift check (src/lib/copy.ts, the same code the engine uses), and wakes the
 * Tandem engine only for the followers that actually need an order. The engine holds the
 * sealed trade-only keys and signs; CRE decides *when* to act, from on-chain truth.
 */
import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  HTTPClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  ok,
  Runner,
  type NodeRuntime,
  type Runtime,
} from '@chainlink/cre-sdk';
import { decodeFunctionResult, encodeFunctionData, multicall3Abi, parseAbi, zeroAddress, type Hex } from 'viem';
import { needsAction, type Leg, type MarketMeta } from '../../src/lib/copy';

type Config = {
  schedule: string;
  chainName: string;
  registry: Hex;
  exchange: Hex;
  multicall: Hex;
  engineUrl: string;
  markets: MarketMeta[];
  maxAgents: number; // EVM read quota is 15 calls per execution: 1 for the registry + 1 per agent
};

const AGENT = '(uint64 follower, uint64 leader, uint32 ratioBps, uint32 maxNotional, uint16 leverage, uint32 maxLoss, bool halted)';
const registryAbi = parseAbi([`function list(uint256 offset, uint256 limit) view returns (address[] who, ${AGENT}[] what)`]);
const exchangeAbi = parseAbi([
  'function getPositionV2(uint256 perpId, uint256 accountId) view returns ((uint256 accountId, uint256 nextNodeId, uint256 prevNodeId, uint8 positionType, uint256 depositCNS, uint256 pricePNS, uint256 lotLNS, uint256 entryBlock, int256 pnlCNS, int256 deltaPnlCNS, int256 premiumPnlCNS, uint256 priceResiduePNSQ16) positionInfo, uint256 markPricePNS, bool markPriceValid)',
]);

function read(runtime: Runtime<Config>, evm: EVMClient, to: Hex, data: Hex): Hex {
  const reply = evm
    .callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
    .result();
  return bytesToHex(reply.data);
}

/** Signed lot (+long/-short), open PnL and mark for each (perp, account) pair, in one multicall. */
function positions(runtime: Runtime<Config>, evm: EVMClient, pairs: [number, bigint][]) {
  const calls = pairs.map(([perp, acc]) => ({
    target: runtime.config.exchange,
    allowFailure: false,
    callData: encodeFunctionData({ abi: exchangeAbi, functionName: 'getPositionV2', args: [BigInt(perp), acc] }),
  }));
  const raw = read(runtime, evm, runtime.config.multicall, encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [calls] }));
  const results = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: raw });
  return results.map((r) => {
    const [p, mark] = decodeFunctionResult({ abi: exchangeAbi, functionName: 'getPositionV2', data: r.returnData });
    const lot = p.lotLNS === 0n ? 0n : p.positionType === 0 ? p.lotLNS : -p.lotLNS; // 0 = Long on-chain
    return { lot, pnl: p.lotLNS === 0n ? 0n : p.pnlCNS, mark };
  });
}

const wakeEngine = (node: NodeRuntime<Config>, owners: Hex[], token: string) => {
  const res = new HTTPClient()
    .sendRequest(node, {
      url: `${node.config.engineUrl}/api/engine/tick`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: Buffer.from(JSON.stringify({ owners })).toString('base64'),
      // One engine call per execution, not one per DON node.
      cacheSettings: { store: true, maxAge: '25s' },
    })
    .result();
  if (!ok(res)) throw new Error(`engine tick failed: ${res.statusCode}`);
  return { statusCode: res.statusCode };
};

const onCron = (runtime: Runtime<Config>): string => {
  const { config } = runtime;
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainName });
  if (!network) throw new Error(`unknown chain ${config.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  const listed = read(runtime, evm, config.registry, encodeFunctionData({ abi: registryAbi, functionName: 'list', args: [0n, BigInt(config.maxAgents)] }));
  const [who, what] = decodeFunctionResult({ abi: registryAbi, functionName: 'list', data: listed });
  if (who.length === 0) return 'no active agents';

  const drifted: Hex[] = [];
  who.forEach((owner, i) => {
    const a = what[i];
    const pos = positions(runtime, evm, config.markets.flatMap((m) => [[m.id, a.leader], [m.id, a.follower]] as [number, bigint][]));
    const legs: Leg[] = config.markets.map((m, j) => {
      const lead = pos[2 * j];
      const mine = pos[2 * j + 1];
      return { m, leaderLot: lead.lot, followerLot: mine.lot, mark: mine.mark || lead.mark };
    });
    const pnl = config.markets.reduce((s, _, j) => s + pos[2 * j + 1].pnl, 0n);
    const rules = { ratioBps: a.ratioBps, maxNotional: a.maxNotional, leverage: a.leverage, maxLoss: a.maxLoss };
    if (needsAction(legs, pnl, rules, a.halted)) drifted.push(owner);
  });

  runtime.log(`agents=${who.length} drifted=${drifted.length}`);
  if (drifted.length === 0) return `checked ${who.length} agents, all in sync`;

  const token = runtime.getSecret({ id: 'ENGINE_TICK_TOKEN' }).result().value;
  const { statusCode } = runtime.runInNodeMode(wakeEngine, consensusIdenticalAggregation<{ statusCode: number }>())(drifted, token).result();
  return `checked ${who.length} agents, woke engine for ${drifted.length} (HTTP ${statusCode})`;
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
