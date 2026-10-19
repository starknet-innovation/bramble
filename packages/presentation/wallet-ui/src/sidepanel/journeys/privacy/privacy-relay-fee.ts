/**
 * The relay fee a private-relay preparation will withdraw, as the side panel
 * receives it, and the one way to state its amount.
 *
 * The relay may convert its fee out of STRK into the token being sent, so the
 * amount is only STRK when the fee token is STRK. Everything that renders it
 * goes through {@link relayFeeAmountText}, which never formats a converted fee
 * as STRK and never subtracts amounts in different tokens.
 */

import { hasOnlyKnownKeys, isRecord, isSafeDecimals } from "@bramble/core/json";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@bramble/wallet-model/networks";

const MAX_SYMBOL_CHARACTERS = 32;

/**
 * Relay fee withdrawal reviewed with a private-relay preparation. `asset` is
 * the background registry's display metadata for `token`, absent when the
 * registry does not describe it.
 */
export type PrivacyRelayFee = {
  readonly amount: string;
  readonly asset?: { readonly decimals: number; readonly symbol: string };
  readonly recipient: string;
  readonly token: string;
};

const readAsset = (value: unknown): PrivacyRelayFee["asset"] | null =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["decimals", "symbol"]) &&
  isSafeDecimals(value["decimals"]) &&
  typeof value["symbol"] === "string" &&
  value["symbol"].length > 0 &&
  value["symbol"].length <= MAX_SYMBOL_CHARACTERS
    ? { decimals: value["decimals"], symbol: value["symbol"] }
    : null;

/**
 * Strictly decodes the untrusted relay-fee review object, or `null` when any
 * field is missing, malformed, or unexpected.
 */
export const readPrivacyRelayFee = (value: unknown): PrivacyRelayFee | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["amount", "asset", "recipient", "token"]) ||
    typeof value["amount"] !== "string" ||
    !isStarkFieldElement(value["amount"]) ||
    typeof value["recipient"] !== "string" ||
    !isNonZeroStarkFieldElement(value["recipient"]) ||
    typeof value["token"] !== "string" ||
    !isNonZeroStarkFieldElement(value["token"])
  ) {
    return null;
  }
  const asset = value["asset"] === undefined ? undefined : readAsset(value["asset"]);
  if (asset === null) {
    return null;
  }
  return {
    amount: value["amount"],
    ...(asset ? { asset } : {}),
    recipient: value["recipient"],
    token: value["token"],
  };
};

/**
 * Whether the fee is denominated in STRK, the only token the pool's own charge
 * can be compared with or added to.
 */
export const isStrkRelayFee = (fee: PrivacyRelayFee): boolean =>
  sameFelt(fee.token, STRK_TOKEN_ADDRESS);

/**
 * The fee amount in its own token: a decimal amount and symbol when the token
 * is described, otherwise the raw felt and token address, which is the most
 * that can honestly be said about an unrecognized token. Display-only.
 */
export const relayFeeAmountText = (fee: PrivacyRelayFee): string => {
  if (!fee.asset) {
    return `${fee.amount} (${fee.token})`;
  }
  try {
    return `${formatTokenAmount(BigInt(fee.amount), fee.asset.decimals)} ${fee.asset.symbol}`;
  } catch {
    return `${fee.amount} (${fee.token})`;
  }
};
