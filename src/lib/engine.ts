/**
 * The copy engine loop. Every tick it reads leader + follower positions on-chain,
 * plans the delta with the pure planner in ./copy, and submits market IoC orders
 * through the follower's trade-only Perpl key (which can never withdraw).
 *
 * MVP runs in the open app; the planner is I/O-free so the same logic can move to a
 * server worker / Chainlink CRE workflow without change.
 */
import { lossBreached, plan, significant, targetLot, type MarketMeta, type Rules } from './copy';
import { positionsOf } from './onchain';
import { BUILDER, type OrderSpec, type PerplClient } from './perpl';

export type EngineLog = { at: number; text: string; level: 'info' | 'trade' | 'warn' };

type Opts = {
  perpl: PerplClient;
  follower: bigint; // follower exchange account id
  leader: bigint; // leader exchange account id
  markets: MarketMeta[];
  rules: Rules;
  onLog: (l: EngineLog) => void;
  intervalMs?: number;
};

const SLIPPAGE_BPS = 100;
const IOC = 4;
const COOLDOWN_MS = 4_000; // fills land on-chain in ~1.5s (measured live); wait a little longer before re-checking a market

export function startEngine({ perpl, follower, leader, markets, rules, onLog, intervalMs = 3000 }: Opts) {
  const log = (text: string, level: EngineLog['level'] = 'info') => onLog({ at: Date.now(), text, level });
  const coolUntil = new Map<number, number>();
  let rq = 0;
  let stopped = false;
  let halted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    const reads = await positionsOf(markets.flatMap((m) => [[m.id, leader], [m.id, follower]] as [number, bigint][]));
    const legs = markets.map((m, i) => ({ m, lead: reads[2 * i], mine: reads[2 * i + 1] }));

    const pnl = legs.reduce((sum, l) => sum + l.mine.pnl, 0n);
    if (!halted && lossBreached(pnl, rules)) {
      halted = true;
      log(`Loss cap of ${rules.maxLoss} AUSD hit. Closing copied positions and pausing.`, 'warn');
    }

    const now = Date.now();
    const orders: OrderSpec[] = [];
    let acc: Awaited<ReturnType<PerplClient['account']>> | undefined;
    for (const { m, lead, mine } of legs) {
      if ((coolUntil.get(m.id) ?? 0) > now) continue;
      const target = halted ? 0n : targetLot(lead.lot, mine.mark || lead.mark, rules, m);
      if (!significant(mine.lot, target)) continue;
      acc ??= await perpl.account();
      rq = Math.max(rq, acc.lfr) + 1;
      for (const o of plan(mine.lot, target, m.id)) {
        orders.push({ ...o, rq: rq++, acc: acc.id, p: 0, fl: IOC, lv: rules.leverage * 100, lb: 0, ms: SLIPPAGE_BPS, ...(BUILDER.id && BUILDER.fee ? { bf: BUILDER.fee } : {}) });
      }
      coolUntil.set(m.id, now + COOLDOWN_MS);
    }
    if (!orders.length) return;

    const statuses = await perpl.submit(orders);
    orders.forEach((o, i) => {
      const s = statuses[i];
      const what = `${['', 'Open long', 'Open short', 'Close long', 'Close short'][o.t]} ${o.s} ${markets.find((m) => m.id === o.mkt)?.symbol ?? `market ${o.mkt}`}`;
      if (s?.code === 0) log(`${what}: sent`, 'trade');
      else log(`${what}: refused ${s?.code ?? '?'} ${s?.error ?? ''}`, 'warn');
    });
  }

  async function loop() {
    if (stopped) return;
    try {
      await tick();
    } catch (e) {
      log((e as Error).message, 'warn');
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  }

  log(`Copying account #${leader} at ${rules.ratioBps / 100}% size, max ${rules.maxNotional} AUSD per market.`);
  void loop();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      log('Stopped.');
    },
  };
}
