/**
 * Pure Send view-model and amount conversion helpers. Cached price data is
 * presentation-only: the token amount remains the explicit value reviewed and
 * signed by the wallet.
 */

import { isSafeDecimals } from "@bramble/core/json";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import type {
  DisplayCurrency,
  TokenConfig,
  WalletPreferences,
} from "@bramble/settings/preferences";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ValueBucket } from "@bramble/transactions/send-routes";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../popup/responses/responses";
import { CURRENCY_SYMBOLS } from "../../shared/fiat";
import { compareStrkFirst } from "../portfolio/token-flows";
import { compactAmount } from "../portfolio/token-row";

/**
 * A pre-configured send, handed to the Send screen by a shortcut that already
 * knows what the user is doing — the asset screen's Shield and Unshield buttons.
 * Seeds the recipient, the asset, and both buckets, so the screen opens on the
 * amount rather than asking again for what was already chosen.
 */
export type SendIntent = {
  readonly accountId: string;
  /** Shared account selected when a setup-owned funding send completes. */
  readonly completeMultisigId?: string;
  /** Continues a shortcut-owned funding send into its saved deployment setup. */
  readonly completeTo?: "multisig-deploy";
  readonly destination: ValueBucket;
  readonly networkId: string;
  readonly recipient: string;
  readonly recipientLabel: string;
  readonly source: ValueBucket;
  readonly tokenId: string;
};

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
        // A missing cache entry is unread, not proof that the account owns
        // zero. Keep that distinction through the form so balance labels and
        // Max never claim a value the RPC has not returned.
        balance: balance?.balance ?? "",
        formatted: balance?.formatted ?? "",
        spam: isLikelySpam(token),
        ...(price === undefined ? {} : { price }),
        ...(change === undefined ? {} : { change }),
      };
    })
    .sort((left, right) => Number(left.spam) - Number(right.spam) || compareStrkFirst(left, right));

/**
 * Returns every account on the active network, the sending account included.
 *
 * The origin is a legitimate recipient rather than a mistake: shielding moves
 * value from an account's public balance into its own private one, so the
 * account has to be selectable. Callers mark it so it never reads as a
 * different account.
 */
export const sendRecipientAccounts = (
  accounts: readonly AccountRef[],
  networkId: string,
): readonly AccountRef[] => accounts.filter((account) => account.networkId === networkId);

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
    // The shared token-decimals bound, not a local half of it: a count this
    // screen would convert against must be one the token boundaries admit.
    !isSafeDecimals(decimals)
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
export const sendBalanceLabel = (formatted: string): string =>
  formatted.length === 0 ? "—" : compactAmount(formatted);

/**
 * The amount card's balance line for the bucket being spent from. Every writer
 * of `#send-balance-label` — the first paint, an asset pick, a bucket flip, and
 * the repaint after discovery or a recipient check settles — renders through
 * here, so the line keeps one shape (and one width) for the life of the screen:
 * a later writer that printed the balance at full token precision widened the
 * card past the narrowest side panel. A balance that has not been read is named
 * as such, never shown as zero.
 */
export const sendBalanceLine = (
  source: ValueBucket,
  formatted: string | null,
  symbol: string,
): string => {
  const scope = source === "private" ? "Private balance" : "Balance";
  return formatted === null
    ? `${scope} unavailable`
    : `${scope} ${sendBalanceLabel(formatted)} ${symbol}`;
};

/**
 * Currency-aware input prefix for fiat-entry mode.
 */
export const sendCurrencySymbol = (currency: DisplayCurrency): string => CURRENCY_SYMBOLS[currency];
