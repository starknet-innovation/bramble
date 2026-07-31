/**
 * Token balance row: symbol + compact amount on the left, fiat value and 24h
 * change on the right. Split from ./views.ts to keep it within the size budget.
 */
import type { TokenBalance } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { STRK_TOKEN_ADDRESS } from "../starknet/networks";
import { tokenLogoSvg } from "../starknet/token-logos-svg";
import type { DisplayCurrency } from "../storage/preferences-store";
import { formatFiat, tokenFiatValue } from "./fiat";
import { icon } from "./icons";

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
 * THE display policy for token amounts — every view renders amounts through
 * this one formatter so precision never varies screen to screen. Values of one
 * or more show grouped thousands and at most five decimals (trailing zeros
 * dropped, so "1.0" reads as "1"). Sub-unit values keep four significant
 * digits instead of a fixed cut, so a small balance like 0.00001234 survives
 * rather than truncating to "0"; anything below the 8-place display floor
 * reads as "<0.00000001". Raw untruncated strings belong only in inputs and
 * signed payloads, never in display copy.
 */
export const compactAmount = (formatted: string): string => {
  const [whole = "0", fraction = ""] = formatted.split(".");
  const grouped = groupThousands(whole);
  if (fraction.length === 0) {
    return grouped;
  }
  const isSubUnit = /^-?0$/.test(whole);
  if (!isSubUnit) {
    const trimmed = fraction.slice(0, 5).replace(/0+$/, "");
    return trimmed.length === 0 ? grouped : `${grouped}.${trimmed}`;
  }
  const firstSignificant = fraction.search(/[1-9]/);
  if (firstSignificant === -1) {
    return grouped;
  }
  if (firstSignificant >= MAX_FRACTION_PLACES) {
    return `<0.${"0".repeat(MAX_FRACTION_PLACES - 1)}1`;
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
  return `<li class="token-row">
    <button class="token-open" type="button" data-token-detail="${escapeHtml(token.id)}">
      ${tokenGlyph(token.address, token.symbol)}
      <div class="token-copy">
        <strong>${escapeHtml(token.symbol)}</strong>
        <p data-live-key="token:${escapeHtml(token.id)}:balance" data-live-value="${escapeHtml(token.formatted)}">${escapeHtml(compactAmount(token.formatted))}${options.private ? `<span class="private-balance-mark" aria-label="Private balance">${icon("lock")}</span>` : ""}</p>
      </div>
      <div class="token-side">
        <span class="token-amount" data-live-key="token:${escapeHtml(token.id)}:fiat" data-live-value="${fiat === null ? "unknown" : fiat}">${fiat === null ? "—" : escapeHtml(formatFiat(fiat, currency))}</span>
        ${changeBadge(change)}
      </div>
    </button>
  </li>`;
};
