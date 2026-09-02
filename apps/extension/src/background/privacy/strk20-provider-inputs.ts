/**
 * Resource-bounded parsers for dapp-reachable STRK20 runtime messages. These
 * values are untrusted even after the provider bridge normalizes them.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import {
  isStrk20DappName,
  isStrk20Felt,
  readStrk20Actions,
  readStrk20Tokens,
  type Strk20Action,
} from "@bramble/wallet-protocol/strk20";

/**
 * Parses the legacy one-time registration capability. Rejects parameters and
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
 */
export const readStrk20PrepareMessage = (
  message: unknown,
): {
  readonly actions: readonly Strk20Action[];
  readonly origin: string;
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
  const actions = readStrk20Actions(message["actions"]);
  return origin && actions ? { actions, origin, simulate: message["simulate"] } : null;
};

/**
 * Parses a private invoke request and clones only validated actions.
 */
export const readStrk20InvokeMessage = (
  message: unknown,
): { readonly actions: readonly Strk20Action[]; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["actions", "origin", "type"]) ||
    message["type"] !== "wallet.strk20InvokeTransaction"
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  const actions = readStrk20Actions(message["actions"]);
  return origin && actions ? { actions, origin } : null;
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
