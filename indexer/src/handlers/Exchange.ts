import { indexer, type EvmOnEventContext, type Trader, type TraderDay } from "envio";
import { accountAddress } from "../effects.js";

const DAY = 86_400;

type Ctx = EvmOnEventContext;
type Fill = { accountId: bigint; perpId: bigint; at: number; deltaPnl?: bigint; liquidation?: boolean };

/** Apply one position event to the trader's all-time row and their daily row. */
async function record(context: Ctx, f: Fill) {
  const day = Math.floor(f.at / DAY);
  const dayId = `${f.accountId}-${day}`;
  const [existing, existingDay] = await Promise.all([context.Trader.get(f.accountId), context.TraderDay.get(dayId)]);

  const trader: Trader = existing ?? {
    id: f.accountId,
    address: await context.effect(accountAddress, f.accountId.toString()),
    realizedPnl: 0n,
    closes: 0,
    wins: 0,
    liquidations: 0,
    trades: 0,
    markets: [],
    lastTradeAt: 0,
  };
  const daily: TraderDay = existingDay ?? {
    id: dayId,
    trader_id: f.accountId,
    day,
    realizedPnl: 0n,
    closes: 0,
    wins: 0,
    trades: 0,
  };

  const closing = f.deltaPnl !== undefined;
  const pnl = f.deltaPnl ?? 0n;
  const won = closing && pnl > 0n ? 1 : 0;
  const perp = Number(f.perpId);

  context.Trader.set({
    ...trader,
    realizedPnl: trader.realizedPnl + pnl,
    closes: trader.closes + (closing ? 1 : 0),
    wins: trader.wins + won,
    liquidations: trader.liquidations + (f.liquidation ? 1 : 0),
    trades: trader.trades + 1,
    markets: trader.markets.includes(perp) ? trader.markets : [...trader.markets, perp],
    lastTradeAt: Math.max(trader.lastTradeAt, f.at),
  });
  context.TraderDay.set({
    ...daily,
    realizedPnl: daily.realizedPnl + pnl,
    closes: daily.closes + (closing ? 1 : 0),
    wins: daily.wins + won,
    trades: daily.trades + 1,
  });
}

indexer.onEvent({ contract: "Exchange", event: "AccountCreated" }, async ({ event, context }) => {
  const existing = await context.Trader.get(event.params.id);
  context.Trader.set({
    id: event.params.id,
    address: event.params.account,
    realizedPnl: existing?.realizedPnl ?? 0n,
    closes: existing?.closes ?? 0,
    wins: existing?.wins ?? 0,
    liquidations: existing?.liquidations ?? 0,
    trades: existing?.trades ?? 0,
    markets: existing?.markets ?? [],
    lastTradeAt: existing?.lastTradeAt ?? 0,
  });
});

// Exposure-opening events: count as trades, realize nothing.
for (const event of ["PositionOpened", "PositionOpenedV2", "PositionIncreased", "PositionIncreasedV2"] as const) {
  indexer.onEvent({ contract: "Exchange", event }, async ({ event: e, context }) =>
    record(context, { accountId: e.params.accountId, perpId: e.params.perpId, at: e.block.timestamp }),
  );
}

// Closing events: each realizes deltaPnl.
for (const event of ["PositionDecreased", "PositionClosed", "PositionInverted"] as const) {
  indexer.onEvent({ contract: "Exchange", event }, async ({ event: e, context }) =>
    record(context, { accountId: e.params.accountId, perpId: e.params.perpId, at: e.block.timestamp, deltaPnl: e.params.deltaPnlCNS }),
  );
}

indexer.onEvent({ contract: "Exchange", event: "PositionLiquidated" }, async ({ event: e, context }) =>
  record(context, {
    accountId: e.params.posAccountId,
    perpId: e.params.perpId,
    at: e.block.timestamp,
    deltaPnl: e.params.deltaPnlCNS,
    liquidation: true,
  }),
);
