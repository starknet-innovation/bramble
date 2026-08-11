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

import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isBaseUnitsAmount,
  isJson,
  isRecord,
} from "../shared/json";
import { isTokenConfig, type TokenConfig } from "../storage/preferences-entries";
import { isAccountIdForNetwork } from "../storage/vault-schema";

/**
 * Popup token balance item accepted from the background boundary. Structurally
 * the stored token config plus its read balance, spelled as one extension of
 * {@link TokenConfig} rather than a second field list, so the wire shape cannot
 * drift from the record the background actually sends (`starknet/rpc`'s
 * `TokenBalance` is the same extension of the same type).
 */
export type TokenBalance = TokenConfig & {
  readonly balance: string;
  readonly formatted: string;
};

/**
 * Popup token balances response accepted from the background boundary.
 */
export type BalancesResponse = {
  readonly accountId: string;
  readonly balances: readonly TokenBalance[];
  readonly networkId: string;
  readonly ok: true;
};

/**
 * Auto-detected token suggestions accepted from the background boundary.
 */
export type DetectTokensResponse = {
  readonly ok: true;
  readonly suggestions: readonly TokenBalance[];
};

// The TokenConfig half of a wire row, re-assembled as its own record so the
// storage validator sees exactly the six keys it owns. Never a second copy of
// those six rules: the canonical-address and derived-id checks in particular
// exist once, in ../storage/preferences-entries.
const tokenConfigPart = (value: Record<string, unknown>): Record<string, unknown> => ({
  address: value["address"],
  decimals: value["decimals"],
  id: value["id"],
  name: value["name"],
  networkId: value["networkId"],
  symbol: value["symbol"],
});

const isTokenBalance = (value: unknown): value is TokenBalance =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, [
    "address",
    "balance",
    "decimals",
    "formatted",
    "id",
    "name",
    "networkId",
    "symbol",
  ]) &&
  isBaseUnitsAmount(value["balance"]) &&
  typeof value["formatted"] === "string" &&
  value["formatted"].length > 0 &&
  isTokenConfig(tokenConfigPart(value));

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
  hasOnlyKnownKeys(value, ["accountId", "balances", "networkId", "ok"]) &&
  value["ok"] === true &&
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
