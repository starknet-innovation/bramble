/**
 * Pure popup validators for token-balance data returned by the background
 * boundary: the tracked-balance list the panel renders and the auto-detection
 * suggestions it offers. Split from ./responses so that file stays under the
 * repository line cap; ./responses re-exports these so existing import paths are
 * unchanged.
 *
 * Nothing here is trusted on arrival, and the token half of each row is not
 * re-validated with a second field list: it is handed to the storage layer's own
 * {@link isTokenConfig}, which owns the canonical-address rule, the derived-id
 * rule, and the symbol/decimals/name grammars. That is what makes the
 * {@link TokenBalance} type's `TokenConfig & …` claim true rather than
 * decorative — a balance the panel renders is literally one the token store
 * would have accepted, so a background reporting an unpadded address spelling,
 * a differently spelled id, or a zero address is rejected rather than shown.
 * Only the two balance-only scalars are checked here, with the shared
 * `shared/json` grammars their writer used.
 */

import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "@mc-wallet/core/json";
import { isTokenBalance, type TokenBalance } from "@mc-wallet/starknet/rpc";
import { isAccountIdForNetwork } from "@mc-wallet/wallet-model/accounts";

/**
 * Shared validated balance row accepted by presentation boundaries.
 */
export type { TokenBalance };

/**
 * Popup token balances response accepted from the background boundary.
 */
export type BalancesResponse = {
  readonly accountId: string;
  readonly asOf?: number | null;
  readonly balances: readonly TokenBalance[];
  readonly networkId: string;
  readonly ok: true;
  readonly stale?: boolean;
};

/**
 * Auto-detected token suggestions accepted from the background boundary.
 */
export type DetectTokensResponse = {
  readonly ok: true;
  readonly suggestions: readonly TokenBalance[];
};

/**
 * Checks balance responses before rendering. Each row must be a token the store
 * would have accepted (see {@link isTokenBalance}'s delegation to
 * `isTokenConfig`) and must belong to the network the response names; the id
 * uniqueness check then means one row per token, because the canonical-address
 * rule leaves a token exactly one spelling of its id.
 */
export const isBalancesResponse = (value: unknown): value is BalancesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accountId", "asOf", "balances", "networkId", "ok", "stale"]) &&
  value["ok"] === true &&
  (value["asOf"] === undefined ||
    value["asOf"] === null ||
    (typeof value["asOf"] === "number" &&
      Number.isSafeInteger(value["asOf"]) &&
      value["asOf"] >= 0)) &&
  (value["stale"] === undefined || typeof value["stale"] === "boolean") &&
  isAccountIdForNetwork(value["accountId"], value["networkId"]) &&
  Array.isArray(value["balances"]) &&
  value["balances"].every(
    (balance) => isTokenBalance(balance) && balance.networkId === value["networkId"],
  ) &&
  hasUniqueStrings(value["balances"].map((balance) => balance.id));

/**
 * Checks auto-detected token responses before rendering suggestions.
 */
export const isDetectTokensResponse = (value: unknown): value is DetectTokensResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "suggestions"]) &&
  value["ok"] === true &&
  Array.isArray(value["suggestions"]) &&
  value["suggestions"].every(isTokenBalance) &&
  hasUniqueStrings(value["suggestions"].map((token) => token.id));
