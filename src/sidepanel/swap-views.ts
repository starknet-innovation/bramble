/**
 * Swap flow screen template (AVNU aggregator): a Sell panel and a Buy panel
 * stacked around a flip control, a rate/fee meta line, and the staged
 * confirm/receipt sections. Pure skeleton — every dynamic region (token
 * chips, balances, USD figures, quote, receipts) is populated by
 * ./swap-ui.ts, which owns the selection and stage state so it survives
 * repaints without threading through the render pipeline. Styles live in
 * ./styles-swap.ts.
 */
import type { WalletStatus } from "../popup/responses";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { flowHeader, flowScreen, noAccountEmpty } from "./parts";

// One tradable panel: label, amount region, token chip, and the USD/balance
// line. The sell side carries a real input plus Max; the buy side is output.
const swapPanel = (side: "buy" | "sell", disabled: boolean): string => `
  <div class="swap-panel" data-swap-side="${side}">
    <p class="swap-label">${side === "sell" ? "Sell" : "Buy"}</p>
    <div class="swap-main">
      ${
        side === "sell"
          ? `<input id="swap-sell-amount" class="swap-amount" inputmode="decimal" placeholder="0" autocomplete="off" spellcheck="false" aria-label="Amount to sell" ${disabled ? "disabled" : ""} />`
          : `<output id="swap-buy-amount" class="swap-amount is-output" aria-live="polite">0</output>`
      }
      <button id="swap-${side}-token" class="swap-token" type="button" aria-haspopup="listbox" aria-label="Choose ${side} token" ${disabled ? "disabled" : ""}>
        <span class="swap-token-copy">—</span>${icon("chevronDown")}
      </button>
    </div>
    <div class="swap-sub">
      <span id="swap-${side}-usd" class="swap-usd"></span>
      <span class="swap-balance">
        <span id="swap-${side}-balance"></span>
        ${side === "sell" ? `<button id="swap-max" class="swap-max" type="button" ${disabled ? "disabled" : ""}>Max</button>` : ""}
      </span>
    </div>
  </div>`;

/**
 * Renders the swap flow screen. `account` gates the controls; everything else
 * arrives through the swap bindings after render.
 */
export const swapFlow = (status: WalletStatus, account: AccountRef | null): string => {
  const disabled = account === null;
  return (
    flowHeader("Swap", status, "Best route via AVNU") +
    flowScreen(
      "swap",
      `${disabled ? noAccountEmpty(status) : ""}
      <section class="swap-stage" id="swap-edit">
        <div class="swap-card">
          ${swapPanel("sell", disabled)}
          <button id="swap-flip" class="swap-flip" type="button" aria-label="Switch sell and buy tokens" ${disabled ? "disabled" : ""}>${icon("arrowDown")}</button>
          ${swapPanel("buy", disabled)}
        </div>
        <div class="swap-meta"><span id="swap-rate"></span><span id="swap-gas"></span></div>
        <div id="swap-picker" class="swap-picker" role="listbox" aria-label="Tokens" hidden></div>
        <button id="swap-review" type="button" disabled>${icon("swap")}<span id="swap-review-label">Swap</span></button>
      </section>
      <section class="swap-stage" id="swap-confirm" hidden>
        <p class="eyebrow">Confirm swap</p>
        <dl class="receipt" id="swap-confirm-receipt"></dl>
        <p class="hint">Quotes refresh with the market; the swap executes at the best route found, never below the minimum shown.</p>
        <div class="swap-actions">
          <button id="swap-confirm-button" type="button">${icon("check")}Confirm swap</button>
          <button id="swap-back-button" class="secondary" type="button">Back</button>
        </div>
      </section>
      <section class="swap-stage swap-done" id="swap-done" hidden>
        <div class="swap-done-mark">${icon("check")}</div>
        <h2>Swap submitted</h2>
        <p class="hint" id="swap-done-copy"></p>
        <dl class="receipt" id="swap-done-receipt"></dl>
        <div class="swap-actions">
          <button id="swap-done-home" data-view="home" type="button">Done</button>
          <button class="secondary" data-view="activity" type="button">View activity</button>
        </div>
      </section>
      <p id="swap-result" role="status"></p>`,
    )
  );
};
