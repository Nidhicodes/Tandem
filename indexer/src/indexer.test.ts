import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const [alice] = TestHelpers.Addresses.mockAddresses;
const DAY1 = 1_791_590_400; // 2026-10-10 00:00 UTC
const DAY2 = DAY1 + 86_400;
const ID = 4242n;

const position = (perpId: bigint, extra: Record<string, unknown>) => ({
  perpId,
  accountId: ID,
  positionType: 0n,
  ...extra,
});

describe("Trader stats", () => {
  it("counts opens as trades and closes as realized PnL, rolled up per day", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            { contract: "Exchange", event: "AccountCreated", params: { account: alice!, id: ID }, block: { timestamp: DAY1 } },
            {
              contract: "Exchange",
              event: "PositionOpenedV2",
              params: position(16n, { leverageHdths: 300n, depositCNS: 0n, pnlCollateralizedCNS: 0n, pricePNS: 0n, lotLNS: 10n, insFeeCNS: 0n, protFeeCNS: 0n, priceResiduePNSQ16: 0n }),
              block: { timestamp: DAY1 + 10 },
            },
            {
              contract: "Exchange",
              event: "PositionDecreased",
              params: position(16n, { startDepositCNS: 0n, endDepositCNS: 0n, startLotLNS: 10n, endLotLNS: 5n, deltaPnlCNS: 7_000_000n, fundingCNS: 0n }),
              block: { timestamp: DAY1 + 20 },
            },
            {
              contract: "Exchange",
              event: "PositionClosed",
              params: position(32n, { pricePNS: 0n, deltaPnlCNS: -2_000_000n, fundingCNS: 0n }),
              block: { timestamp: DAY2 + 5 },
            },
          ],
        },
      },
    });

    const trader = await indexer.Trader.getOrThrow(ID);
    t.expect(trader).toMatchObject({
      address: alice,
      realizedPnl: 5_000_000n, // +7 -2 AUSD
      closes: 2,
      wins: 1,
      trades: 3,
      liquidations: 0,
      markets: [16, 32],
      lastTradeAt: DAY2 + 5,
    });

    const d1 = await indexer.TraderDay.getOrThrow(`${ID}-${DAY1 / 86_400}`);
    const d2 = await indexer.TraderDay.getOrThrow(`${ID}-${DAY2 / 86_400}`);
    t.expect([d1.realizedPnl, d1.trades, d1.closes]).toEqual([7_000_000n, 2, 1]);
    t.expect([d2.realizedPnl, d2.trades, d2.closes]).toEqual([-2_000_000n, 1, 1]);
  });

  it("credits liquidations to the liquidated account", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            { contract: "Exchange", event: "AccountCreated", params: { account: alice!, id: ID }, block: { timestamp: DAY1 } },
            {
              contract: "Exchange",
              event: "PositionLiquidated",
              params: {
                perpId: 16n, posAccountId: ID, positionType: 1n, markPricePNS: 0n, liqPricePNS: 0n, liqLotLNS: 5n, posLotLNS: 5n,
                deltaPnlCNS: -9_000_000n, fundingCNS: 0n, posAmountCNS: 0n, posDepositCNS: 0n, accAmountCNS: 0n, accBalanceCNS: 0n, onOrderBook: false,
              },
              block: { timestamp: DAY1 + 1 },
            },
          ],
        },
      },
    });
    t.expect(await indexer.Trader.getOrThrow(ID)).toMatchObject({ realizedPnl: -9_000_000n, closes: 1, wins: 0, liquidations: 1 });
  });

  it("indexes real Perpl blocks on Monad testnet", { timeout: 120_000 }, async (t) => {
    const indexer = createTestIndexer();
    // 100 recent blocks with market-maker activity, verified 2026-10-10.
    const result = await indexer.process({ chains: { 10143: { startBlock: 69_782_265, endBlock: 69_782_364 } } });
    const traders = await indexer.Trader.getAll();
    t.expect(result.changes.length).toBeGreaterThan(0);
    t.expect(traders.length).toBeGreaterThan(0);
    for (const tr of traders) t.expect(tr.address).toMatch(/^0x[0-9a-fA-F]{40}$/); // pre-start accounts resolved via the RPC effect
  });
});
