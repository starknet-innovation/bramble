/**
 * Pure parsers for dapp provider runtime messages that reach the background
 * from the content bridge: permission queries and watch-asset requests. Also
 * parses the panel-only fee-retry request, which is privileged and never
 * reachable from content scripts.
 */
import { isUuid } from "@bramble/core/ids";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import {
  isProviderWatchAsset,
  type ProviderWatchAsset,
} from "@bramble/wallet-protocol/watch-asset";

/**
 * Parses dapp permission queries from content-script traffic.
 */
export const readGetPermissionsInput = (message: unknown): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message["type"] !== "wallet.getPermissions"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin } : null;
};

/**
 * Parses dapp watch-asset requests from content-script traffic.
 */
export const readWatchAssetInput = (
  message: unknown,
): { readonly asset: ProviderWatchAsset; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["asset", "origin", "type"]) ||
    message["type"] !== "wallet.watchAsset"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const asset = isProviderWatchAsset(message["asset"]) ? message["asset"] : null;
  return origin && asset ? { asset, origin } : null;
};

/**
 * Parses the panel's request to re-estimate a queued invoke approval's fee.
 * Privileged traffic only: the message type is not in the dapp allowlist, so
 * the dispatcher rejects it from content scripts before this parser runs.
 */
export const readRetryApprovalFeeInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === "wallet.retryApprovalFee" &&
  typeof message["id"] === "string" &&
  isUuid(message["id"])
    ? { id: message["id"] }
    : null;
