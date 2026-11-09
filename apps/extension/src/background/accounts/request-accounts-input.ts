/**
 * Account-request parser at the untrusted content-script boundary.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";

/**
 * Parses dapp account requests from content-script traffic. Silent requests
 * are read-only preauthorization probes and must never create an approval.
 */
export const readRequestAccountsInput = (
  message: unknown,
): { readonly origin: string; readonly silent: boolean } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "silent", "type"]) ||
    message["type"] !== "wallet.requestAccounts" ||
    (message["silent"] !== undefined && typeof message["silent"] !== "boolean")
  ) {
    return null;
  }

  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin, silent: message["silent"] === true } : null;
};
