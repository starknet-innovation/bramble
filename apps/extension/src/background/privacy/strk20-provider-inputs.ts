/**
 * Resource-bounded parsers for dapp-reachable STRK20 runtime messages. These
 * values are untrusted even after the provider bridge normalizes them.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { normalizeWalletOrigin } from "@mc-wallet/core/origin";
import {
  isStrk20DappName,
  isStrk20Felt,
  readStrk20ActionRequest,
  readStrk20Tokens,
  type Strk20ActionRequest,
} from "@mc-wallet/wallet-protocol/strk20";

/**
 * Parses the MC-only one-time registration capability. Rejects parameters and
 * malformed origins before the request reaches the approval queue.
 */
export const readStrk20RegisterMessage = (message: unknown): { readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "type"]) ||
    message["type"] !== "wallet.strk20Register"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { origin } : null;
};

/**
 * Parses a private-balance disclosure request under the shared token bounds.
 */
export const readStrk20BalancesMessage = (
  message: unknown,
): { readonly origin: string; readonly tokens: readonly string[] } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["origin", "tokens", "type"]) ||
    message["type"] !== "wallet.strk20Balances"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const tokens = readStrk20Tokens(message["tokens"]);
  return origin && tokens ? { origin, tokens } : null;
};

/**
 * Parses a private proof-preparation request and clones only validated actions.
 * A lone register action becomes a register request; register mixed with other
 * actions is rejected.
 */
export const readStrk20PrepareMessage = (
  message: unknown,
): {
  readonly origin: string;
  readonly request: Strk20ActionRequest;
  readonly simulate: boolean;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["actions", "origin", "simulate", "type"]) ||
    message["type"] !== "wallet.strk20PrepareInvoke" ||
    typeof message["simulate"] !== "boolean"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const request = readStrk20ActionRequest(message["actions"]);
  return origin && request ? { origin, request, simulate: message["simulate"] } : null;
};

/**
 * Parses a private invoke request and clones only validated actions. A lone
 * register action becomes a register request; register mixed with other
 * actions is rejected.
 */
export const readStrk20InvokeMessage = (
  message: unknown,
): { readonly origin: string; readonly request: Strk20ActionRequest } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["actions", "origin", "type"]) ||
    message["type"] !== "wallet.strk20InvokeTransaction"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const request = readStrk20ActionRequest(message["actions"]);
  return origin && request ? { origin, request } : null;
};

/**
 * Parses a bounded dapp-scoped private identity commitment request.
 */
export const readStrk20SubaccountMessage = (
  message: unknown,
): {
  readonly dappName: string;
  readonly nonce?: string;
  readonly origin: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["dappName", "nonce", "origin", "type"]) ||
    message["type"] !== "wallet.strk20SubaccountCommitment" ||
    !isStrk20DappName(message["dappName"]) ||
    (message["nonce"] !== undefined && !isStrk20Felt(message["nonce"]))
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin
    ? {
        dappName: message["dappName"],
        ...(message["nonce"] === undefined ? {} : { nonce: message["nonce"] }),
        origin,
      }
    : null;
};
