/**
 * Pure popup validators for the fiat price and token chart responses.
 */

import { hasOnlyKnownKeys, isJson, isRecord } from "@mc-wallet/core/json";

/**
 * Fiat prices keyed by contract address accepted from the background boundary.
 */
export type PricesResponse = {
  readonly asOf?: number | null;
  readonly changes?: Readonly<Record<string, number>>;
  readonly currency: "eur" | "gbp" | "usd";
  readonly ok: true;
  readonly prices: Readonly<Record<string, number>>;
  readonly stale?: boolean;
};

/**
 * Token price series accepted from the background boundary.
 */
export type TokenChartResponse = {
  readonly currency: "eur" | "gbp" | "usd";
  readonly ok: true;
  readonly points: readonly number[];
};

const isDisplayCurrencyValue = (value: unknown): value is "eur" | "gbp" | "usd" =>
  value === "eur" || value === "gbp" || value === "usd";

const isFiniteNumberValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPriceMap = (value: unknown): value is Readonly<Record<string, number>> =>
  isRecord(value) && Object.values(value).every(isFiniteNumberValue);

const isNumberArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every(isFiniteNumberValue);

/**
 * Checks fiat price responses before applying values to balances.
 */
export const isPricesResponse = (value: unknown): value is PricesResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["asOf", "changes", "currency", "ok", "prices", "stale"]) &&
  value["ok"] === true &&
  isDisplayCurrencyValue(value["currency"]) &&
  isPriceMap(value["prices"]) &&
  (value["changes"] === undefined || isPriceMap(value["changes"])) &&
  (value["asOf"] === undefined || value["asOf"] === null || isFiniteNumberValue(value["asOf"])) &&
  (value["stale"] === undefined || typeof value["stale"] === "boolean");

/**
 * Checks token chart responses before drawing a sparkline.
 */
export const isTokenChartResponse = (value: unknown): value is TokenChartResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["currency", "ok", "points"]) &&
  value["ok"] === true &&
  isDisplayCurrencyValue(value["currency"]) &&
  isNumberArray(value["points"]);
