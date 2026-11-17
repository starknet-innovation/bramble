/** Strict token-balance shape shared by RPC, persistence, and UI boundaries. */
import { hasOnlyKnownKeys, isBaseUnitsAmount, isJson, isRecord } from "@bramble/core/json";
import { isTokenConfig, type TokenConfig } from "@bramble/wallet-model/preferences";

/**
 * One tracked token with its latest public on-chain balance.
 */
export type TokenBalance = TokenConfig & {
  readonly balance: string;
  readonly formatted: string;
};

const tokenConfigPart = (value: Record<string, unknown>): Record<string, unknown> => ({
  address: value["address"],
  decimals: value["decimals"],
  id: value["id"],
  name: value["name"],
  networkId: value["networkId"],
  symbol: value["symbol"],
});

/**
 * Validates a balance before it crosses RPC, storage, or presentation trust
 * boundaries. Token identity stays delegated to the canonical stored-token
 * validator so address and derived-id rules cannot drift.
 */
export const isTokenBalance = (value: unknown): value is TokenBalance =>
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
