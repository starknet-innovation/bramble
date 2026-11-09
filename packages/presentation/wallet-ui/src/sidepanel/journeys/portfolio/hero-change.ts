/**
 * The hero's 24h change line, shared by the account Home hero and the watched
 * multisig hero so the two surfaces cannot drift into naming the same figure
 * two ways.
 */
import { escapeHtml } from "@bramble/core/html";
import type { DisplayCurrency } from "@bramble/settings/preferences";
import type { TokenBalance } from "../../../popup/responses/responses";
import { formatFiat, portfolioDelta } from "../../shared/fiat";

/**
 * Renders the hero's 24h change line, or an empty string when nothing is
 * priced (`portfolioDelta === null`). The magnitude keeps the coloured up/down
 * ink; the window stays muted. Returns markup from trusted constants and the
 * escaped fiat figure only. `held` keeps the line's space while the total
 * beside it still reads "—", hidden from sight and assistive tech, so the
 * hero does not move when the figure arrives (issue 795).
 */
export const heroChange = (
  balances: readonly TokenBalance[],
  prices: Readonly<Record<string, number>>,
  changes: Readonly<Record<string, number>>,
  currency: DisplayCurrency,
  held = false,
): string => {
  const delta = portfolioDelta(balances, prices, changes);
  if (delta === null) {
    return "";
  }
  const arrow = delta.direction === "up" ? "↑" : "↓";
  return `<p class="hero-change${delta.direction === "down" ? " down" : ""}${held ? ' is-held" aria-hidden="true' : ""}">
      <span class="hero-change-amt">${arrow} ${escapeHtml(formatFiat(delta.absolute, currency))}</span>
      <span class="hero-change-win">Portfolio price · ${delta.percent.toFixed(2)}% · 24h</span>
    </p>`;
};
