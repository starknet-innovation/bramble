/**
 * STRK20 privacy-method param and result parsing for the dapp provider bridge.
 * Split from bridge-results.ts to keep each provider module within the size cap.
 */
import { hasOnlyKnownKeys, isJson, isRecord, type Json } from "../shared/json";
import {
  isStrk20BalanceEntry,
  isStrk20CallAndProof,
  readStrk20Actions,
  readStrk20Tokens,
  type Strk20Action,
  type Strk20BalanceEntry,
  type Strk20CallAndProof,
} from "../starknet/strk20/schemas";

/**
 * STRK20 action union re-exported so the bridge maps params in one import.
 */
export type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
} from "../starknet/strk20/schemas";

/**
 * Parses `wallet_strk20Balances` params (`{ tokens: ADDRESS[] }`) into the
 * validated token list, or null when malformed.
 */
export const readStrk20BalancesParams = (params: Json | undefined): readonly string[] | null =>
  isRecord(params) && hasOnlyKnownKeys(params, ["tokens"]) ? readStrk20Tokens(params.tokens) : null;

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
    (params.simulate !== undefined && typeof params.simulate !== "boolean")
  ) {
    return null;
  }
  const actions = readStrk20Actions(params.actions);
  return actions ? { actions, simulate: params.simulate === true } : null;
};

/**
 * Parses `wallet_strk20InvokeTransaction` params (`{ actions }`) into the
 * validated action list, or null when malformed.
 */
export const readStrk20InvokeParams = (params: Json | undefined): readonly Strk20Action[] | null =>
  isRecord(params) && hasOnlyKnownKeys(params, ["actions"])
    ? readStrk20Actions(params.actions)
    : null;

/**
 * Narrows a background result to a STRK20_BALANCE_ENTRY[] for the page.
 */
export const providerStrk20Balances = (result: unknown): readonly Strk20BalanceEntry[] | null =>
  Array.isArray(result) && isJson(result) && result.every(isStrk20BalanceEntry) ? result : null;

/**
 * Narrows a background result to a STRK20_CALL_AND_PROOF envelope for the page.
 */
export const providerStrk20CallAndProof = (result: unknown): Strk20CallAndProof | null =>
  isJson(result) && isStrk20CallAndProof(result) ? result : null;
