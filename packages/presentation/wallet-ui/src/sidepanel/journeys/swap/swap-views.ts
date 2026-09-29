/**
 * Swap flow screen template (avnu aggregator): a Sell panel and a Buy panel
 * stacked around a flip control, a rate/fee meta line, and the staged
 * confirm/receipt sections. Pure skeleton — every dynamic region (token
 * chips, balances, USD figures, quote, receipts) is populated by
 * ./swap-ui.ts, which owns the selection and stage state so it survives
 * repaints without threading through the render pipeline. Styles live in
 * ./styles-swap.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import { receipt } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { outcomeHashRow } from "../../shared/outcome-hash";
import { flowScreen, flowSteps, noAccountEmpty } from "../../shared/parts";
import { formatFeeEstimate } from "../../shared/review-render";
import { tokenDropdownShell } from "../../shared/token-dropdown";
import { compactAmount, tokenGlyph } from "../portfolio/token-row";
import type { SwapPreparationView } from "./swap-client";

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
      <div class="token-dropdown" data-align="end">
        <button id="swap-${side}-token" class="swap-token" type="button" aria-haspopup="listbox" aria-label="Choose ${side} token" ${disabled ? "disabled" : ""}>
          <span class="swap-token-copy">—</span>${icon("chevronDown")}
        </button>
        ${tokenDropdownShell(`swap-${side}-options`, side === "sell" ? "Tokens you can pay with" : "Tokens you can receive")}
      </div>
    </div>
    <div class="swap-sub">
      <span id="swap-${side}-usd" class="swap-usd"></span>
      <span class="swap-balance">
        <span id="swap-${side}-balance"></span>
        ${side === "sell" ? `<button id="swap-max" class="swap-max" type="button" ${disabled ? "disabled" : ""}>Max</button>` : ""}
      </span>
    </div>
  </div>`;

// Swap owns its header so the back arrow can step from the review to the quote
// rather than leaving the flow, which is what the review stage needs now that
// it carries no Back button of its own.
const swapHeader = (): string => `
  <header class="flow-header">
    ${iconButton({
      attributes: { id: "swap-header-back" },
      icon: "chevronLeft",
      label: "Back",
      variant: "ghost",
    })}
    <div class="flow-title"><h1>Swap</h1></div>
  </header>`;

/**
 * Renders the swap flow screen. `account` gates the controls; everything else
 * arrives through the swap bindings after render.
 */
export const swapFlow = (status: WalletStatus, account: AccountRef | null): string => {
  const disabled = account === null;
  return (
    swapHeader() +
    flowScreen(
      "swap",
      `${disabled ? noAccountEmpty(status) : ""}
      ${flowSteps("data-swap-step", "Swap progress", [
        ["edit", "Quote"],
        ["confirm", "Review"],
        ["success", "Execute"],
      ])}
      <section class="swap-stage" id="swap-edit">
        <div class="swap-card">
          ${swapPanel("sell", disabled)}
          <button id="swap-flip" class="swap-flip" type="button" aria-label="Switch sell and buy tokens" ${disabled ? "disabled" : ""}>${icon("arrowDown")}</button>
          ${swapPanel("buy", disabled)}
        </div>
        <div class="swap-meta"><span id="swap-rate"></span><span id="swap-gas"></span></div>
        <p id="swap-warning" class="swap-warning" role="alert" hidden></p>
        <button id="swap-review" type="button" disabled>${icon("swap")}<span id="swap-review-label">Review swap</span></button>
      </section>
      <section class="swap-stage" id="swap-confirm" hidden>
        <h2 class="swap-review-title">Review swap</h2>
        <div id="swap-confirm-receipt"></div>
        <div id="swap-risk-review"></div>
        <div class="swap-actions">
          ${button({
            attributes: { id: "swap-confirm-button" },
            icon: "check",
            label: "Confirm swap",
          })}
        </div>
      </section>
      <section class="swap-stage swap-success" id="swap-success" role="status" hidden>
        <span class="swap-success-mark" aria-hidden="true">
          <svg viewBox="0 0 56 56"><circle class="swap-success-ring" cx="28" cy="28" r="25" /><path class="swap-success-check" d="M18 29.5l7 7 14-15" /></svg>
        </span>
        <h2>Swap submitted</h2>
        <div class="send-receipt">
          <p class="send-receipt-summary swap-success-summary" id="swap-success-summary"></p>
          <div class="send-receipt-tx">
            <span class="send-receipt-label">Transaction</span>
            ${outcomeHashRow("swap-success-hash")}
          </div>
        </div>
        <div class="send-actions">
          ${button({ attributes: { id: "swap-view-activity" }, icon: "activity", label: "View in Activity tab" })}
          ${button({ attributes: { id: "swap-home" }, label: "Back", variant: "secondary" })}
        </div>
      </section>
      <p id="swap-result" role="status"></p>`,
    )
  );
};

/**
 * The figures the confirm receipt states. `minBuyAmount` is the minimum the
 * BACKGROUND decoded out of the frozen route calldata, not one derived here —
 * that separation is the whole point of the row.
 */
export type SwapConfirmFigures = {
  readonly buyAddress: string;
  readonly buyAmount: string;
  readonly buySymbol: string;
  readonly gasFeesInUsd: number;
  readonly lossPercent: number;
  readonly minBuyAmount: string;
  readonly networkFee: SwapPreparationView["reviewedFee"];
  readonly sellAddress: string;
  readonly sellAmount: string;
  readonly sellSymbol: string;
  readonly valueDelta: number | null;
};

/**
 * Renders the confirm-stage receipt. Pure: it states only what it is given, and
 * every row is a claim the wallet can stand behind — the minimum comes off the
 * frozen preparation and is labelled as enforced, while the aggregator's fee
 * guess is labelled as not. Nothing here recomputes a figure the transaction
 * carries; a row the wallet cannot back would be a false assurance on the last
 * screen before signing.
 */
export const swapConfirmReceipt = (figures: SwapConfirmFigures): string =>
  `<div class="swap-review-pair" aria-label="What will happen">
    <div class="swap-review-asset">
      ${tokenGlyph(figures.sellAddress, figures.sellSymbol)}
      <span><small>You sell</small><strong>${escapeHtml(compactAmount(figures.sellAmount))} ${escapeHtml(figures.sellSymbol)}</strong></span>
    </div>
    <span class="swap-review-arrow">${icon("arrowDown")}</span>
    <div class="swap-review-asset">
      ${tokenGlyph(figures.buyAddress, figures.buySymbol)}
      <span><small>You receive</small><strong>${escapeHtml(compactAmount(figures.buyAmount))} ${escapeHtml(figures.buySymbol)}</strong></span>
    </div>
  </div>
  <div class="receipt-group">
    <p class="decision-label">Cost</p>
    ${receipt([
      {
        label: "Minimum received",
        value: `${compactAmount(figures.minBuyAmount)} ${figures.buySymbol}`,
      },
      { label: "Estimated fee", value: formatFeeEstimate(figures.networkFee) },
    ])}
  </div>`;
