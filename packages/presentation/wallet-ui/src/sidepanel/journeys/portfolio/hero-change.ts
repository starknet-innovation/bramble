/**
 * The hero's 24h change line and its caption, shared by the account Home hero
 * and the watched multisig hero so the two surfaces cannot drift into naming
 * the same figure two ways.
 */
import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency } from "@bramble/settings/preferences";
import type { TokenBalance } from "../../../popup/responses/responses";
import { formatFiat, portfolioDelta } from "../../shared/fiat";

/**
 * Caption under a hero's 24h change line. The figures are price moves measured
 * against the balances held today, so sends and receives do not count and the
 * row percentages do not sum to the hero figure. One source so the wording is a
 * single edit and both heroes explain it the same way.
 */
const HERO_CHANGE_NOTE =
  "Price change over 24h at your current balances; sends and receives aren't included.";

/**
 * Renders the hero's 24h change line and its caption, or an empty string when
 * nothing is priced, the same `portfolioDelta === null` gate the change figure
 * itself uses. The magnitude keeps the coloured up/down ink; the window and the
 * caption stay muted. Returns markup from trusted constants and the escaped
 * fiat figure only.
 */
export const heroChange = (
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
): string => {
  const delta = portfolioDelta(balances, prices, changes);
  if (delta === null) {
    return "";
  }
  const arrow = delta.direction === "up" ? "↑" : "↓";
  return `<p class="hero-change${delta.direction === "down" ? " down" : ""}">
      <span class="hero-change-amt">${arrow} ${escapeHtml(formatFiat(delta.absolute, currency))}</span>
      <span class="hero-change-win">Portfolio price · ${delta.percent.toFixed(2)}% · 24h</span>
    </p>
    <p class="hero-note">${HERO_CHANGE_NOTE}</p>`;
};
