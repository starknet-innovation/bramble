/**
 * Live check for the Ekubo fee tiers (#153): every tier the terminal quotes
 * through must key an initialised mainnet pool. Core's `get_pool_price` returns
 * a zero sqrt ratio for a pool key that was never initialised, so a fee or tick
 * spacing that is off in any digit shows up here as a failure.
 */
import type { RpcProvider } from "starknet";
import { EKUBO_ADDRESSES, MAINNET_TOKEN_ADDRESSES } from "../src/protocols/constants";
import {
  buildPoolKey,
  buildPoolPriceCalldata,
  EKUBO_FEE_TIERS,
  orderTokens,
  parsePoolSqrtRatio,
} from "../src/protocols/ekubo/ekubo-swap";

/**
 * Reads each tier's ETH/USDC pool from mainnet Core and throws naming every
 * tier whose pool is not initialised.
 */
export const checkEkuboFeeTiers = async (
  provider: RpcProvider,
): Promise<{ readonly status: string; readonly detail: string }> => {
  const block = await provider.getBlockNumber();
  const { token0, token1 } = orderTokens(MAINNET_TOKEN_ADDRESSES.ETH, MAINNET_TOKEN_ADDRESSES.USDC);
  const missing: string[] = [];
  for (const tier of EKUBO_FEE_TIERS) {
    const response = await provider.callContract(
      {
        calldata: buildPoolPriceCalldata(buildPoolKey(token0, token1, tier)),
        contractAddress: EKUBO_ADDRESSES.core,
        entrypoint: "get_pool_price",
      },
      block,
    );
    if (parsePoolSqrtRatio(response) === 0n) {
      missing.push(tier.label);
    }
  }
  if (missing.length > 0) {
    throw new Error(`no initialised ETH/USDC pool for tier(s) ${missing.join(", ")} at block ${block}`);
  }
  return {
    detail: `${EKUBO_FEE_TIERS.length} tiers key initialised ETH/USDC pools at block ${block}`,
    status: "rpc",
  };
};
