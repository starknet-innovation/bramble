/**
 * Swap flow screen template (AVNU aggregator): a Sell panel and a Buy panel
 * stacked around a flip control, a rate/fee meta line, and the staged
 * confirm/receipt sections. Pure skeleton — every dynamic region (token
 * chips, balances, USD figures, quote, receipts) is populated by
 * ./swap-ui.ts, which owns the selection and stage state so it survives
 * repaints without threading through the render pipeline. Styles live in
 * ./styles-swap.ts.
 */

import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { inputControl } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen, noAccountEmpty } from "../../shared/parts";

// One tradable panel: label, amount region, token chip, and the USD/balance
// line. The sell side carries a real input plus Max; the buy side is output.
const swapPanel = (side: "buy" | "sell", disabled: boolean): string => `
  <div class="swap-panel" data-swap-side="${side}">
    <p class="swap-label">${side === "sell" ? "Sell" : "Buy"}</p>
    <div class="swap-main">
      ${
        side === "sell"
          ? inputControl({
              ariaLabel: "Amount to sell",
              attributes: { id: "swap-sell-amount" },
              autocomplete: "off",
              className: "swap-amount",
              disabled,
              inputmode: "decimal",
              placeholder: "0",
              spellcheck: false,
            })
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
        <p id="swap-warning" class="swap-warning" role="alert" hidden></p>
        <button id="swap-review" type="button" disabled>${icon("swap")}<span id="swap-review-label">Swap</span></button>
      </section>
      <div id="swap-picker" class="swap-sheet" role="dialog" aria-modal="true" aria-label="Choose token" hidden>
        <header class="swap-sheet-head">
          <h2 id="swap-picker-title">Receive</h2>
          ${iconButton({
            attributes: { id: "swap-picker-close" },
            icon: "x",
            label: "Close token picker",
            variant: "ghost",
          })}
        </header>
        ${inputControl({
          ariaLabel: "Token name or address",
          attributes: { id: "swap-picker-search" },
          autocomplete: "off",
          className: "swap-search",
          placeholder: "Token name or address",
          spellcheck: false,
          type: "search",
        })}
        <div id="swap-picker-chips" class="swap-chips"></div>
        <div id="swap-picker-list" class="swap-sheet-list" role="listbox" aria-label="Tokens"></div>
        ${emptyState("", "status", { hidden: true, id: "swap-picker-status" })}
      </div>
      <section class="swap-stage" id="swap-confirm" hidden>
        <p class="eyebrow">Confirm swap</p>
        ${receipt([], { id: "swap-confirm-receipt" })}
        <div id="swap-call-review"></div>
        <p class="hint">These exact calls were built and frozen before this screen. Confirm submits them once; the route cannot change after review.</p>
        <div class="swap-actions">
          ${button({
            attributes: { id: "swap-confirm-button" },
            icon: "check",
            label: "Confirm swap",
          })}
          ${button({
            attributes: { id: "swap-back-button" },
            label: "Back",
            variant: "secondary",
          })}
        </div>
      </section>
      <section class="swap-stage swap-success" id="swap-success" role="status" hidden>
        <span class="swap-success-mark" aria-hidden="true">
          <svg viewBox="0 0 56 56"><circle class="swap-success-ring" cx="28" cy="28" r="25" /><path class="swap-success-check" d="M18 29.5l7 7 14-15" /></svg>
        </span>
        <h2>Swap submitted</h2>
        <p class="swap-success-summary" id="swap-success-summary"></p>
        <p class="hint">Taking you home — track it under Activity.</p>
      </section>
      <p id="swap-result" role="status"></p>`,
    )
  );
};
