/**
 * Fee values in the unit the user last chose.
 *
 * The wallet records a fee as an exact FRI ceiling: that figure is what the
 * approval binds. A fiat reading of the same figure is a convenience, and it
 * exists only when a fresh STRK price is on hand. Missing or stale price means
 * STRK only, never a guessed or out-of-date number, which keeps this module a
 * pure function of its inputs: the price, the currency and the chosen unit all
 * arrive from the caller.
 *
 * Every fee value in a review follows one stored choice, so a screen with a
 * network fee, a pool fee and their total never mixes units.
 */
import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency, FeeDisplayUnit } from "@bramble/settings/preferences";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { formatFiat } from "./fiat";
import { formatFri } from "./parts";

/** FRI per STRK. The wallet denominate every fee it quotes in this unit. */
const FRI_PER_STRK = 10n ** 18n;

/**
 * What a fee surface needs: the chosen unit, the user's display currency, and
 * the STRK price when one is fresh. `strkPrice` is `null` whenever the price is
 * absent or stale, which is the fail-closed signal every renderer keys off.
 */
export type FeeDisplay = {
  readonly currency: DisplayCurrency;
  readonly strkPrice: number | null;
  readonly unit: FeeDisplayUnit;
};

/**
 * The reading used where no preference or price context reaches: the exact STRK
 * ceiling, and no toggle, because a control that cannot fetch a price would do
 * nothing.
 */
export const STRK_ONLY: FeeDisplay = { currency: "usd", strkPrice: null, unit: "strk" };

/**
 * The fresh STRK price from a panel prices map, or `null`.
 *
 * Stale prices resolve to `null`: a fee must never quote a reference rate the
 * wallet already knows is out of date. Keys are compared as field elements, not
 * as text, so a differently cased or padded address still matches.
 */
export const strkPriceFrom = (
  prices: Readonly<Record<string, number>>,
  stale: boolean,
): number | null => {
  if (stale) {
    return null;
  }
  for (const [address, price] of Object.entries(prices)) {
    if (sameFelt(address, STRK_TOKEN_ADDRESS) && Number.isFinite(price) && price > 0) {
      return price;
    }
  }
  return null;
};

/**
 * Resolves the fee reading from the panel's stored preferences and its price
 * cache, so every surface derives it the same way. A stale or absent price
 * leaves `strkPrice` null, which is what keeps the toggle off a screen that
 * could not quote a truthful fiat figure.
 */
export const feeDisplayFrom = (
  preferences:
    | {
        readonly displayCurrency?: DisplayCurrency;
        readonly feeDisplayUnit?: FeeDisplayUnit;
      }
    | null
    | undefined,
  prices: Readonly<Record<string, number>>,
  stale: boolean,
): FeeDisplay => ({
  currency: preferences?.displayCurrency ?? "usd",
  strkPrice: strkPriceFrom(prices, stale),
  unit: preferences?.feeDisplayUnit ?? "strk",
});

/**
 * A fiat reading of one FRI fee, or `null` when there is nothing truthful to
 * show (no fresh price, or an unparseable amount).
 */
const feeFiatText = (display: FeeDisplay, fri: string): string | null => {
  if (display.strkPrice === null) {
    return null;
  }
  let raw: bigint;
  try {
    raw = BigInt(fri);
  } catch {
    return null;
  }
  if (raw < 0n) {
    return null;
  }
  const strk = Number(raw) / Number(FRI_PER_STRK);
  if (!Number.isFinite(strk)) {
    return null;
  }
  return formatFiat(strk * display.strkPrice, display.currency);
};

/**
 * The fee value in the chosen unit as plain escaped text, with no control. Used
 * where the value is not tappable (a notice, a hint) or where no fresh price
 * makes a fiat reading possible.
 */
export const feeValueText = (display: FeeDisplay, fri: string): string => {
  if (display.unit === "fiat") {
    const fiat = feeFiatText(display, fri);
    if (fiat !== null) {
      return fiat;
    }
  }
  return formatFri(fri);
};

/**
 * The fee value as markup: a toggle button when a fresh price makes the fiat
 * reading possible, otherwise the plain STRK text exactly as before.
 *
 * In fiat mode the exact STRK ceiling stays visible beside the fiat figure,
 * because that is the figure the approval binds and the one a reviewer needs;
 * in STRK mode the value reads as it always has.
 *
 * `label` names what the value is (for example "Estimated fee") and makes the
 * accessible name state both the figure and what activating it does.
 */
export const feeValueHtml = (display: FeeDisplay, fri: string, label: string): string => {
  const strk = formatFri(fri);
  const fiat = feeFiatText(display, fri);
  if (fiat === null) {
    return escapeHtml(strk);
  }
  const showingFiat = display.unit === "fiat";
  const text = showingFiat ? `${fiat} (${strk})` : strk;
  const action = showingFiat ? "show in STRK" : `show in ${display.currency.toUpperCase()}`;
  const aria = `${label} ${text}, activate to ${action}`;
  return `<button type="button" class="fee-unit-toggle" data-fee-toggle aria-pressed="${String(
    showingFiat,
  )}" aria-label="${escapeHtml(aria)}">${escapeHtml(text)}</button>`;
};
