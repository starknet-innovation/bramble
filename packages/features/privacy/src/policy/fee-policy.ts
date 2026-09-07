/** STRK20 pool-fee parsing and bounds shared by preparation and submission. */

import { WalletError } from "@bramble/core/errors";
import { UINT128_LIMIT } from "@bramble/wallet-model/networks";

/**
 * Stable refusal for missing or malformed SDK/service routing; callers fail
 * closed without proving, signing, or submitting.
 */
export const STRK20_SERVICE_UNAVAILABLE = "strk20 services unavailable";

/**
 * Maximum accepted pool fee, single-sourced from the uint256 limb bound so
 * protocol field limits cannot drift across layers.
 */
export const STRK20_MAX_POOL_FEE = UINT128_LIMIT - 1n;

/**
 * Parses a reviewed pool fee into canonical felt form. Malformed, negative, or
 * out-of-range service values fail closed before entering an approval digest.
 */
export const canonicalStrk20PoolFee = (value: string): string => {
  let fee: bigint;
  try {
    fee = BigInt(value);
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  if (fee < 0n || fee > STRK20_MAX_POOL_FEE) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return `0x${fee.toString(16)}`;
};
