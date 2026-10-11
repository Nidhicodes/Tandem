/**
 * The copy planner: pure, deterministic, no I/O. Given the leader's and the follower's
 * position in one market, return the market orders that move the follower to its
 * target. Mirroring *positions* (not individual fills) makes the engine self-healing:
 * a missed event, a restart or a partial fill is corrected on the next tick.
 */
export type Rules = {
  ratioBps: number; // follower size as a share of the leader's, in basis points (1000 = 10%)
  maxNotional: number; // per-market exposure cap, in AUSD
  leverage: number; // whole x, e.g. 3
  maxLoss: number; // stop copying and flatten once position PnL falls below -maxLoss AUSD
};

export type MarketMeta = { id: number; priceDecimals: number; sizeDecimals: number; symbol?: string };
export type Side = { lot: bigint; mark: bigint }; // signed lot: + long, - short
export type PlannedOrder = { mkt: number; t: 1 | 2 | 3 | 4; s: number }; // Open/Close Long/Short, scaled size

const OPEN_LONG = 1, OPEN_SHORT = 2, CLOSE_LONG = 3, CLOSE_SHORT = 4;
const abs = (x: bigint) => (x < 0n ? -x : x);
const AUSD_DECIMALS = 6n;

/** Largest lot whose notional stays within `maxNotional` AUSD at `mark`. */
export function capLot(maxNotional: number, mark: bigint, m: MarketMeta): bigint {
  if (mark <= 0n) return 0n;
  // notional(AUSD) = lot/10^sd * mark/10^pd  ->  lot = maxNotional * 10^(sd+pd) / mark
  return (BigInt(Math.floor(maxNotional)) * 10n ** BigInt(m.sizeDecimals + m.priceDecimals)) / mark;
}

export function targetLot(leader: bigint, mark: bigint, rules: Rules, m: MarketMeta): bigint {
  const scaled = (leader * BigInt(rules.ratioBps)) / 10_000n;
  const cap = capLot(rules.maxNotional, mark, m);
  return abs(scaled) > cap ? (scaled < 0n ? -cap : cap) : scaled;
}

/** Orders that take `current` to `target`; a flip closes first, then opens the other side. */
export function plan(current: bigint, target: bigint, mkt: number): PlannedOrder[] {
  const out: PlannedOrder[] = [];
  const close = (lot: bigint) => lot !== 0n && out.push({ mkt, t: lot > 0n ? CLOSE_LONG : CLOSE_SHORT, s: Number(abs(lot)) });
  const open = (lot: bigint) => lot !== 0n && out.push({ mkt, t: lot > 0n ? OPEN_LONG : OPEN_SHORT, s: Number(abs(lot)) });

  if (current === target) return out;
  if (current !== 0n && target !== 0n && current > 0n !== target > 0n) {
    close(current);
    open(target);
  } else if (abs(target) > abs(current)) {
    open(target - current);
  } else {
    close(current - target);
  }
  return out;
}

/**
 * True once the follower's open PnL (6-decimal AUSD, summed over markets) breaches the loss cap.
 * Uses the Exchange's getPositionV2 pnlCNS, which is mark-to-market PnL (checked against
 * (mark - entry) * lot on live positions, 2026-10-10).
 */
export const lossBreached = (pnlCNS: bigint, rules: Rules) => pnlCNS < -BigInt(Math.floor(rules.maxLoss)) * 10n ** AUSD_DECIMALS;

/**
 * Ignore drift below `minBps` of the target, so rounding and tiny leader trims
 * don't spam the book with dust orders.
 */
export function significant(current: bigint, target: bigint, minBps = 200): boolean {
  const delta = abs(target - current);
  if (delta === 0n) return false;
  const ref = abs(target) > abs(current) ? abs(target) : abs(current);
  return delta * 10_000n >= ref * BigInt(minBps);
}

export type Leg = { m: MarketMeta; leaderLot: bigint; followerLot: bigint; mark: bigint };

/**
 * Does this follower need an order right now? True when any market drifted past the dust
 * threshold, or the loss cap is breached (or already halted) with exposure still open.
 * Shared by the engine and the Chainlink CRE workflow, so both agree on "drifted".
 */
export function needsAction(legs: Leg[], followerPnlCNS: bigint, rules: Rules, halted: boolean): boolean {
  const flatten = halted || lossBreached(followerPnlCNS, rules);
  return legs.some((l) => significant(l.followerLot, flatten ? 0n : targetLot(l.leaderLot, l.mark, rules, l.m)));
}
