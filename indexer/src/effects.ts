import { createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from "viem";

const EXCHANGE = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";
const abi = parseAbi([
  "function getAccountById(uint256 accountId) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256 bank1, uint256 bank2, uint256 bank3, uint256 bank4) positions) accountInfo)",
]);

const client = createPublicClient({
  transport: http(process.env.ENVIO_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz", { batch: true }),
});

/**
 * Address of a Perpl account created before our start block. Cached in the
 * indexer DB, and rate-limited under the public RPC's 15 req/s cap.
 */
export const accountAddress = createEffect(
  {
    name: "accountAddress",
    input: S.string, // account id as a decimal string
    output: S.string,
    rateLimit: { calls: 10, per: "second" },
    cache: true,
  },
  async ({ input }) => {
    const info = await client.readContract({
      address: EXCHANGE,
      abi,
      functionName: "getAccountById",
      args: [BigInt(input)],
    });
    return info.accountAddr;
  },
);
