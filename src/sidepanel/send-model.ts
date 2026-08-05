/**
 * Pure Send view-model and amount conversion helpers. Cached price data is
 * presentation-only: the token amount remains the explicit value reviewed and
 * signed by the wallet.
 */
import type { TokenBalance } from "../popup/responses";
import { sameFelt } from "../starknet/networks";
import { formatTokenAmount } from "../starknet/rpc";
import { isLikelySpam } from "../starknet/token-registry";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { CURRENCY_SYMBOLS } from "./fiat";
import { compareStrkFirst } from "./token-flows";
import { compactAmount } from "./token-row";

/**
 * One ERC20 option in the Send asset picker.
 */
export type SendAsset = TokenConfig & {
  readonly balance: string;
  readonly change?: number;
  readonly formatted: string;
  readonly price?: number;
  readonly spam: boolean;
};

const byAddress = <T>(values: Readonly<Record<string, T>>, address: string): T | undefined =>
  Object.entries(values).find(([candidate]) => sameFelt(candidate, address))?.[1];

/**
 * Joins tracked tokens with cached account balances and presentation prices.
 */
export const sendAssets = (
  networkId: string,
  preferences: WalletPreferences | null,
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
): readonly SendAsset[] =>
  (preferences?.tokens ?? [])
    .filter((token) => token.networkId === networkId)
    .map((token) => {
      const balance = balances.find((candidate) => candidate.id === token.id);
      const price = byAddress(prices, token.address);
      const change = byAddress(changes, token.address);
      return {
        ...token,
        balance: balance?.balance ?? "0",
        formatted: balance?.formatted ?? "0",
        spam: isLikelySpam(token),
        ...(price === undefined ? {} : { price }),
        ...(change === undefined ? {} : { change }),
      };
    })
    .sort((left, right) => Number(left.spam) - Number(right.spam) || compareStrkFirst(left, right));

/**
 * Returns accounts on the active network except the account sending funds.
 */
export const sendRecipientAccounts = (
  accounts: readonly AccountRef[],
  networkId: string,
  activeAccountId: string | null,
): readonly AccountRef[] =>
  accounts.filter((account) => account.networkId === networkId && account.id !== activeAccountId);

const finitePositive = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Estimates display fiat for a token input. It never participates directly in
 * calldata and returns null when the cached price or input is unusable.
 */
export const tokenInputFiat = (amount: string, price: number | undefined): number | null => {
  const parsed = finitePositive(amount);
  return parsed === null || price === undefined || !Number.isFinite(price) || price <= 0
    ? null
    : parsed * price;
};

/**
 * Converts a fiat-mode input into a visible token amount using cached price
 * data. The result is deliberately capped to token precision and is shown back
 * to the user before review; it is never a hidden exchange-rate promise.
 */
export const fiatInputToken = (
  fiat: string,
  price: number | undefined,
  decimals: number,
): string | null => {
  const parsed = finitePositive(fiat);
  if (
    parsed === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0
  ) {
    return null;
  }
  const precision = Math.min(decimals, 12);
  const converted = (parsed / price).toFixed(precision).replace(/0+$/, "").replace(/\.$/, "");
  return converted === "0" || converted.length === 0 ? null : converted;
};

/**
 * Formats a raw balance shortcut without introducing floating-point rounding
 * into the amount sent.
 */
export const balanceShortcut = (
  rawBalance: string,
  decimals: number,
  fraction: "half" | "max",
): string => {
  try {
    const raw = BigInt(rawBalance);
    const selected = fraction === "half" ? raw / 2n : raw;
    return selected > 0n ? formatTokenAmount(selected, decimals) : "";
  } catch {
    return "";
  }
};

/**
 * Short balance copy shared by recipient/account and token rows.
 */
export const sendBalanceLabel = (formatted: string): string => compactAmount(formatted);

/**
 * Currency-aware input prefix for fiat-entry mode.
 */
export const sendCurrencySymbol = (currency: DisplayCurrency): string => CURRENCY_SYMBOLS[currency];
