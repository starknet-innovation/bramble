/**
 * Fee-estimate wire grammar shared by review producers, runtime parsers, and
 * the final signing boundary. Unknown denominations and malformed amounts fail
 * closed because they cannot be compared to a reviewed ceiling.
 */
import { hasOnlyKnownKeys, isBaseUnitsAmount, isRecord } from "@mc-wallet/core/json";

/**
 * Fee amount in base units and its Starknet denomination.
 */
export type FeeEstimate = {
  readonly overallFee: string;
  readonly unit: string;
};

/**
 * Starknet fee denominations the wallet can display and compare.
 */
export type FeeUnit = "FRI" | "WEI";

/**
 * Checks the shared fee-denomination allowlist.
 */
export const isFeeUnit = (value: unknown): value is FeeUnit => value === "FRI" || value === "WEI";

/**
 * Parses the one fee-estimate shape allowed across wallet boundaries.
 */
export const isFeeEstimate = (value: unknown): value is FeeEstimate =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["overallFee", "unit"]) &&
  isBaseUnitsAmount(value["overallFee"]) &&
  isFeeUnit(value["unit"]);
