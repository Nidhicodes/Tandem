/**
 * The slice of the Perpl Exchange ABI Tandem uses. Signatures copied from
 * PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json. None of these event
 * params are indexed, so filtering by account happens after decoding.
 */
import { parseAbi } from 'viem';

export const exchangeAbi = parseAbi([
  'function createAccount(uint256 amountCNS)',
  'function allowOrderForwarding(bool allow)',
  'function depositCollateral(uint256 amountCNS)', // selector verified present in the Exchange implementation
  'function getPositionV2(uint256 perpId, uint256 accountId) view returns ((uint256 accountId, uint256 nextNodeId, uint256 prevNodeId, uint8 positionType, uint256 depositCNS, uint256 pricePNS, uint256 lotLNS, uint256 entryBlock, int256 pnlCNS, int256 deltaPnlCNS, int256 premiumPnlCNS, uint256 priceResiduePNSQ16) positionInfo, uint256 markPricePNS, bool markPriceValid)',
  'function getAccountByAddr(address accountAddress) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256 bank1, uint256 bank2, uint256 bank3, uint256 bank4) positions) accountInfo)',
  'function getAccountById(uint256 accountId) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256 bank1, uint256 bank2, uint256 bank3, uint256 bank4) positions) accountInfo)',
  'error AccountDoesNotExist(address accountAddress)', // getAccountByAddr reverts with this for a wallet with no account (seen live)
]);

/** Events that realize PnL (closing side) plus the ones that open or grow exposure. */
export const positionEvents = parseAbi([
  'event PositionOpenedV2(uint256 perpId, uint256 accountId, uint8 positionType, uint256 leverageHdths, uint256 depositCNS, int256 pnlCollateralizedCNS, uint256 pricePNS, uint256 lotLNS, uint256 insFeeCNS, uint256 protFeeCNS, uint256 priceResiduePNSQ16)',
  'event PositionIncreasedV2(uint256 perpId, uint256 accountId, uint8 positionType, uint256 leverageHdths, uint256 startDepositCNS, uint256 endDepositCNS, int256 pnlCollateralizedCNS, int256 premiumPnlSettledCNS, uint256 maxNegPnlCollatBPS, uint256 pricePNS, uint256 startLotLNS, uint256 endLotLNS, uint256 insFeeCNS, uint256 protFeeCNS, uint256 priceResiduePNSQ16)',
  'event PositionDecreased(uint256 perpId, uint256 accountId, uint8 positionType, uint256 startDepositCNS, uint256 endDepositCNS, uint256 startLotLNS, uint256 endLotLNS, int256 deltaPnlCNS, int256 fundingCNS)',
  'event PositionClosed(uint256 perpId, uint256 accountId, uint8 positionType, uint256 pricePNS, int256 deltaPnlCNS, int256 fundingCNS)',
  'event PositionInverted(uint256 perpId, uint256 accountId, uint8 positionType, uint256 leverageHdths, uint256 startDepositCNS, uint256 endDepositCNS, int256 pnlCollateralizedCNS, uint256 pricePNS, uint256 startLotLNS, uint256 endLotLNS, int256 deltaPnlCNS, int256 fundingCNS, uint256 insFeeCNS, uint256 protFeeCNS)',
  'event PositionLiquidated(uint256 perpId, uint256 posAccountId, uint8 positionType, uint256 markPricePNS, uint256 liqPricePNS, uint256 liqLotLNS, uint256 posLotLNS, int256 deltaPnlCNS, int256 fundingCNS, int256 posAmountCNS, uint256 posDepositCNS, int256 accAmountCNS, uint256 accBalanceCNS, bool onOrderBook)',
]);

/** On-chain PositionType: 0 = Long, 1 = Short (dex-sdk state/position.rs). */
export const LONG = 0;
