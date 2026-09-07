/**
 * STRK20 privacy-method param and result parsing for the dapp provider bridge.
 * Split from bridge-results.ts to keep each provider module within the size cap.
 */
import {
  hasOnlyKnownKeys,
  isJson,
  isJsonWithinBudget,
  isRecord,
  JSON_BUDGETS,
  type Json,
} from "@bramble/core/json";
import {
  isStrk20BalanceEntry,
  isStrk20CallAndProof,
  isStrk20DappName,
  isStrk20Felt,
  readStrk20Actions,
  readStrk20Tokens,
  type Strk20Action,
  type Strk20BalanceEntry,
  type Strk20CallAndProof,
} from "./strk20";

/**
 * STRK20 action union re-exported so the bridge maps params in one import.
 */
export type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
  Strk20Proof,
} from "./strk20";

/**
 * Parses `wallet_strk20Balances` params (`{ tokens: ADDRESS[] }`) into the
 * validated token list, or null when malformed.
 */
export const readStrk20BalancesParams = (params: Json | undefined): readonly string[] | null =>
  isRecord(params) && hasOnlyKnownKeys(params, ["tokens"])
    ? readStrk20Tokens(params["tokens"])
    : null;

/**
 * Parses `wallet_strk20PrepareInvoke` params (`{ actions, simulate? }`) into the
 * validated action list and simulate flag (default false), or null when
 * malformed.
 */
export const readStrk20PrepareParams = (
  params: Json | undefined,
): { readonly actions: readonly Strk20Action[]; readonly simulate: boolean } | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["actions", "simulate"]) ||
    (params["simulate"] !== undefined && typeof params["simulate"] !== "boolean")
  ) {
    return null;
  }
  const actions = readStrk20Actions(params["actions"]);
  return actions ? { actions, simulate: params["simulate"] === true } : null;
};

/**
 * Parses `wallet_strk20InvokeTransaction` params (`{ actions }`) into the
 * validated action list, or null when malformed.
 */
export const readStrk20InvokeParams = (params: Json | undefined): readonly Strk20Action[] | null =>
  isRecord(params) && hasOnlyKnownKeys(params, ["actions"])
    ? readStrk20Actions(params["actions"])
    : null;

/**
 * Parses the dapp-scoped sub-account commitment request.
 */
export const readStrk20SubaccountCommitmentParams = (
  params: Json | undefined,
): { readonly dappName: string; readonly nonce?: string } | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["dapp_name", "nonce"]) ||
    !isStrk20DappName(params["dapp_name"]) ||
    (params["nonce"] !== undefined && !isStrk20Felt(params["nonce"]))
  ) {
    return null;
  }
  return {
    dappName: params["dapp_name"],
    ...(params["nonce"] === undefined ? {} : { nonce: params["nonce"] }),
  };
};

/**
 * Narrows a background result to a STRK20_BALANCE_ENTRY[] for the page.
 */
export const providerStrk20Balances = (result: unknown): readonly Strk20BalanceEntry[] | null =>
  Array.isArray(result) && isJson(result) && result.every(isStrk20BalanceEntry) ? result : null;

/**
 * Narrows a background result to a STRK20_CALL_AND_PROOF envelope for the page.
 */
export const providerStrk20CallAndProof = (result: unknown): Strk20CallAndProof | null =>
  isJsonWithinBudget(result, JSON_BUDGETS.strk20Proof) && isStrk20CallAndProof(result)
    ? result
    : null;

/**
 * Narrows a sub-account commitment result to one felt.
 */
export const providerStrk20Commitment = (result: unknown): string | null =>
  isStrk20Felt(result) ? result : null;
