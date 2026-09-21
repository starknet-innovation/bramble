/**
 * Token balance row: symbol + compact amount on the left, fiat value and 24h
 * change on the right. Split from ./views.ts to keep it within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { tokenLogoSvg } from "@bramble/portfolio/token-logos";
import type { DisplayCurrency } from "@bramble/settings/preferences";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../popup/responses/responses";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { icon } from "../../shared/icons";

/**
 * Renders a token's bundled logo when one is known, else a letter badge from
 * the symbol. Decorative — the symbol is shown alongside it. Known logos are
 * emitted as inline vector SVG (a trusted static constant from the logo map,
 * never token-supplied data) so the marks stay crisp on high-DPI displays; the
 * letter badge still HTML-escapes the untrusted symbol.
 */
export const tokenGlyph = (address: string, symbol: string): string => {
  const logo = tokenLogoSvg(address);
  if (logo) {
    return logo;
  }
  // Letter badges carry a deterministic per-token tint (same derivation as
  // account avatars) so long token lists stay scannable without brand marks.
  let tone = 0;
  try {
    tone = Number(BigInt(address) % 4n);
  } catch {
    tone = 0;
  }
  return `<span class="token-mark" data-tone="${tone}">${escapeHtml(symbol.slice(0, 3))}</span>`;
};

/**
 * Renders the trusted bundled Starknet mark for network context. The mark is
 * decorative and never uses network- or dapp-supplied image data.
 */
export const starknetNetworkGlyph = (): string => tokenGlyph(STRK_TOKEN_ADDRESS, "STRK");

const groupThousands = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Display floor for sub-unit amounts: fractions whose first significant digit
// sits beyond this many places render as "<0.00000001" instead of a longer tail.
const MAX_FRACTION_PLACES = 8;
// Significant digits kept on sub-unit amounts (0.00001234 → 0.00001234, 4 sig).
const SUB_UNIT_SIGNIFICANT = 4;
/**
 * Fraction places the portfolio list and hero settle on: a scannable column of
 * two, padded so amounts align. Detail and review screens keep the wider
 * default, where an exact figure matters more than a tidy column.
 */
export const PORTFOLIO_FRACTION_PLACES = 2;
const DEFAULT_FRACTION_PLACES = 5;

/**
 * THE display policy for token amounts — every view renders amounts through
 * this one formatter so precision never varies screen to screen. Values of one
 * or more show grouped thousands and at most `places` decimals; the default
 * drops trailing zeros (so "1.0" reads as "1"), while a caller that fixes
 * `places` (the portfolio list) pads to exactly that width so a column of
 * amounts lines up. Sub-unit values ignore `places` and keep four significant
 * digits instead, so a small balance like 0.00001234 survives rather than
 * rounding away to "0.00"; anything below the 8-place display floor reads as
 * "<0.00000001". Raw untruncated strings belong only in inputs and signed
 * payloads, never in display copy.
 */
export const compactAmount = (formatted: string, places?: number): string => {
  const [whole = "0", fraction = ""] = formatted.split(".");
  const grouped = groupThousands(whole);
  const fixed = places !== undefined;
  if (fraction.length === 0) {
    return fixed ? `${grouped}.${"0".repeat(places)}` : grouped;
  }
  const isSubUnit = /^-?0$/.test(whole);
  if (!isSubUnit) {
    const width = places ?? DEFAULT_FRACTION_PLACES;
    const cut = fraction.slice(0, width);
    if (fixed) {
      return `${grouped}.${cut.padEnd(width, "0")}`;
    }
    const trimmed = cut.replace(/0+$/, "");
    return trimmed.length === 0 ? grouped : `${grouped}.${trimmed}`;
  }
  const firstSignificant = fraction.search(/[1-9]/);
  if (firstSignificant === -1) {
    return fixed ? `${grouped}.${"0".repeat(places)}` : grouped;
  }
  if (firstSignificant >= MAX_FRACTION_PLACES) {
    return `<0.${"0".repeat(MAX_FRACTION_PLACES - 1)}1`;
  }
  // A fixed width only applies while it can still show the value: 0.5 reads as
  // "0.50", but 0.00001234 keeps its significant digits rather than rounding to
  // "0.00" and claiming the balance is empty.
  if (fixed && firstSignificant < places) {
    return `${grouped}.${fraction.slice(0, places).padEnd(places, "0")}`;
  }
  const end = Math.min(firstSignificant + SUB_UNIT_SIGNIFICANT, MAX_FRACTION_PLACES);
  const trimmed = fraction.slice(0, end).replace(/0+$/, "");
  return `${grouped}.${trimmed}`;
};

const changeBadge = (change: number | undefined): string => {
  if (change === undefined || !Number.isFinite(change)) {
    return "";
  }
  const direction = change >= 0 ? "up" : "down";
  const arrow = change >= 0 ? "↑" : "↓";
  return `<span class="token-change ${direction}">${arrow} ${Math.abs(change).toFixed(2)}%</span>`;
};

/**
 * Public/private split shown inside a unified row's dropdown. `unavailable`
 * stays terse; the copyable retry toast owns the diagnostic.
 */
export type PrivateBreakdown =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly balance: string; readonly formatted: string }
  | { readonly kind: "unavailable" }
  /** Registration broadcast, not yet visible to the privacy indexer. */
  | { readonly kind: "pending" }
  | { readonly kind: "unregistered" }
  | { readonly kind: "undeployed" };

const privateBreakdownLine = (token: TokenBalance, breakdown: PrivateBreakdown): string => {
  const symbol = token.symbol;
  if (breakdown.kind === "unregistered" || breakdown.kind === "undeployed") {
    const label =
      breakdown.kind === "undeployed" ? "Deploy and enable" : "Register to start shielding";
    return `<button class="token-breakdown-register" data-privacy-register="${escapeHtml(token.id)}" type="button" title="${label}">
        <span class="token-breakdown-label">${icon("lock")}Private balance</span>
        <span>${label}</span>
      </button>`;
  }
  const value =
    breakdown.kind === "ready"
      ? `${escapeHtml(compactAmount(breakdown.formatted, PORTFOLIO_FRACTION_PLACES))} ${escapeHtml(symbol)}`
      : breakdown.kind === "loading"
        ? "Discovering…"
        : breakdown.kind === "pending"
          ? "Registration pending…"
          : "Unavailable";
  return `<div class="token-breakdown-row${breakdown.kind === "ready" ? "" : " muted"}">
      <span class="token-breakdown-label">${icon("lock")}Private balance</span>
      <span class="token-breakdown-value">${value}</span>
    </div>`;
};

/**
 * Renders one unified token row: the summary shows the combined public plus
 * private amount, and expanding it disloses the public/private split, the
 * shield/unshield entry, and the asset-screen link. The private line doubles as
 * the registration entry when the account is not registered with the privacy
 * pool, in which case there is nothing to shield yet and no entry is offered.
 */
export const unifiedBalanceRow = (
  token: TokenBalance,
  price: number | undefined,
  change: number | undefined,
  currency: DisplayCurrency,
  breakdown: {
    readonly private: PrivateBreakdown;
    readonly publicFormatted: string;
  },
): string => {
  const fiat = tokenFiatValue(token.formatted, price);
  return `<li class="token-row token-unified" data-live-group>
    <details class="token-disclosure">
      <summary aria-label="Show ${escapeHtml(token.symbol)} balance breakdown">
        ${tokenGlyph(token.address, token.symbol)}
        <div class="token-copy">
          <strong>${escapeHtml(token.symbol)}</strong>
          <p data-live-key="token:${escapeHtml(token.id)}:balance" data-live-value="${escapeHtml(token.formatted)}">${escapeHtml(compactAmount(token.formatted, PORTFOLIO_FRACTION_PLACES))}</p>
        </div>
        <div class="token-side">
          <span class="token-amount" data-live-key="token:${escapeHtml(token.id)}:fiat" data-live-value="${fiat === null ? "unknown" : fiat}">${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</span>
          ${changeBadge(change)}
        </div>
      </summary>
      <div class="token-breakdown">
        <div class="token-breakdown-row">
          <span class="token-breakdown-label">Public balance</span>
          <span class="token-breakdown-value">${escapeHtml(compactAmount(breakdown.publicFormatted, PORTFOLIO_FRACTION_PLACES))} ${escapeHtml(token.symbol)}</span>
        </div>
        ${privateBreakdownLine(token, breakdown.private)}
        <button class="token-breakdown-more" data-token-detail="${escapeHtml(token.id)}" type="button">See more about ${escapeHtml(token.symbol)}${icon("chevronRight")}</button>
      </div>
    </details>
  </li>`;
};

/**
 * Renders one tappable token row for the home balances list.
 */
export const balanceRow = (
  token: TokenBalance,
  price: number | undefined,
  change: number | undefined,
  currency: DisplayCurrency,
  options: { readonly private?: boolean } = {},
): string => {
  const fiat = tokenFiatValue(token.formatted, price);
  return `<li class="token-row" data-live-group>
    <button class="token-open" type="button" data-token-detail="${escapeHtml(token.id)}">
      ${tokenGlyph(token.address, token.symbol)}
      <div class="token-copy">
        <strong>${escapeHtml(token.symbol)}</strong>
        <p data-live-key="token:${escapeHtml(token.id)}:balance" data-live-value="${escapeHtml(token.formatted)}">${escapeHtml(compactAmount(token.formatted, PORTFOLIO_FRACTION_PLACES))}${options.private ? `<span class="private-balance-mark" aria-label="Private balance">${icon("lock")}</span>` : ""}</p>
      </div>
      <div class="token-side">
        <span class="token-amount" data-live-key="token:${escapeHtml(token.id)}:fiat" data-live-value="${fiat === null ? "unknown" : fiat}">${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</span>
        ${changeBadge(change)}
      </div>
    </button>
  </li>`;
};
