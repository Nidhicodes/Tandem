/**
 * The copy engine. `copyStep` is one pass: read leader + follower positions on-chain,
 * plan the delta with the pure planner in ./copy, and submit market IoC orders through the
 * follower's trade-only Perpl key (which can never withdraw). The same step runs in the open
 * app (`startEngine`), in the always-on server engine, and behind the Chainlink CRE trigger.
 */
import { lossBreached, plan, significant, targetLot, type MarketMeta, type Rules } from './copy';
import { positionsOf } from './onchain';
import { BUILDER, type OrderSpec, type PerplClient } from './perpl';

export type EngineLog = { at: number; text: string; level: 'info' | 'trade' | 'warn' };

type Step = {
  perpl: PerplClient;
  follower: bigint; // follower exchange account id
  leader: bigint; // leader exchange account id
  markets: MarketMeta[];
  rules: Rules;
  halted?: boolean; // already halted: only flatten
  skip?: (marketId: number) => boolean; // e.g. a per-market cooldown
};

export type StepResult = { breached: boolean; traded: number[]; logs: EngineLog[] };

const SLIPPAGE_BPS = 100;
const IOC = 4;
const COOLDOWN_MS = 4_000; // fills land on-chain in ~1.5s (measured live); wait a little longer before re-checking a market
const TYPE = ['', 'Open long', 'Open short', 'Close long', 'Close short'];

/**
 * One copy pass. Request ids are seeded from the account's last accepted id (`lfr`), so two
 * runners computing the same plan at the same time submit the same `rq` and Perpl executes
 * it at most once.
 */
export async function copyStep({ perpl, follower, leader, markets, rules, halted = false, skip }: Step): Promise<StepResult> {
  const logs: EngineLog[] = [];
  const log = (text: string, level: EngineLog['level'] = 'info') => logs.push({ at: Date.now(), text, level });

  const reads = await positionsOf(markets.flatMap((m) => [[m.id, leader], [m.id, follower]] as [number, bigint][]));
  const legs = markets.map((m, i) => ({ m, lead: reads[2 * i], mine: reads[2 * i + 1] }));
  const breached = !halted && lossBreached(legs.reduce((s, l) => s + l.mine.pnl, 0n), rules);
  if (breached) log(`Loss cap of ${rules.maxLoss} AUSD hit. Closing copied positions and pausing.`, 'warn');
  const flatten = halted || breached;

  const orders: OrderSpec[] = [];
  const traded: number[] = [];
  let acc: Awaited<ReturnType<PerplClient['account']>> | undefined;
  let rq = 0;
  for (const { m, lead, mine } of legs) {
    if (skip?.(m.id)) continue;
    const target = flatten ? 0n : targetLot(lead.lot, mine.mark || lead.mark, rules, m);
    if (!significant(mine.lot, target)) continue;
    acc ??= await perpl.account();
    rq = Math.max(rq, acc.lfr);
    for (const o of plan(mine.lot, target, m.id)) {
      orders.push({
        ...o, rq: ++rq, acc: acc.id, p: 0, fl: IOC, lv: rules.leverage * 100, lb: 0, ms: SLIPPAGE_BPS,
        ...(BUILDER.id && BUILDER.fee ? { bf: BUILDER.fee } : {}),
      });
    }
    traded.push(m.id);
  }
  if (orders.length) {
    const statuses = await perpl.submit(orders);
    orders.forEach((o, i) => {
      const s = statuses[i];
      const what = `${TYPE[o.t]} ${o.s} ${markets.find((m) => m.id === o.mkt)?.symbol ?? `market ${o.mkt}`}`;
      if (s?.code === 0) log(`${what}: sent`, 'trade');
      else log(`${what}: refused ${s?.code ?? '?'} ${s?.error ?? ''}`, 'warn');
    });
  }
  return { breached, traded, logs };
}

type Loop = Omit<Step, 'halted' | 'skip'> & { onLog: (l: EngineLog) => void; intervalMs?: number };

/** In-app loop: runs copyStep every few seconds while the app is open. */
export function startEngine({ onLog, intervalMs = 3000, ...step }: Loop) {
  const coolUntil = new Map<number, number>();
  let stopped = false;
  let halted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string, level: EngineLog['level'] = 'info') => onLog({ at: Date.now(), text, level });

  async function loop() {
    if (stopped) return;
    try {
      const now = Date.now();
      const r = await copyStep({ ...step, halted, skip: (id) => (coolUntil.get(id) ?? 0) > now });
      halted ||= r.breached;
      for (const id of r.traded) coolUntil.set(id, now + COOLDOWN_MS);
      r.logs.forEach(onLog);
    } catch (e) {
      say((e as Error).message, 'warn');
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  }

  say(`Copying account #${step.leader} at ${step.rules.ratioBps / 100}% size, max ${step.rules.maxNotional} AUSD per market.`);
  void loop();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      say('Stopped.');
    },
  };
}
