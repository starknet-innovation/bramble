/**
 * Swap flow screen template (AVNU aggregator): a Sell panel and a Buy panel
 * stacked around a flip control, a rate/fee meta line, and the staged
 * confirm/receipt sections. Pure skeleton — every dynamic region (token
 * chips, balances, USD figures, quote, receipts) is populated by
 * ./swap-ui.ts, which owns the selection and stage state so it survives
 * repaints without threading through the render pipeline. Styles live in
 * ./styles-swap.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import { receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { formatFiat } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen, noAccountEmpty } from "../../shared/parts";
import { formatFeeEstimate } from "../../shared/review-render";
import { tokenDropdownShell } from "../../shared/token-dropdown";
import { compactAmount, tokenGlyph } from "../portfolio/token-row";
import type { SwapPreparationView } from "./swap-client";
import { SWAP_LOSS_WARN_PERCENT } from "./swap-client";

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
      <section class="swap-stage" id="swap-confirm" hidden>
        <header class="decision-head">
          <span class="decision-seal">${icon("shield")}</span>
          <span><p class="decision-label">Reviewed intent</p><h2>Confirm this swap</h2></span>
        </header>
        <div id="swap-confirm-receipt"></div>
        <div id="swap-risk-review"></div>
        <details class="disclosure decision-technical" data-disclosure="swap-technical-details">
          <summary>
            <span class="menu-copy"><strong>Technical details</strong><small>Frozen calls and review digest</small></span>
            <span class="disclosure-mark">${icon("chevronRight")}</span>
          </summary>
          <div class="disclosure-body">
            <div id="swap-quote-details"></div>
            <div id="swap-call-review"></div>
          </div>
        </details>
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
    <p class="decision-label">Maximum cost and constraints</p>
    ${receipt([
      {
        label: "Minimum received",
        value: `${compactAmount(figures.minBuyAmount)} ${figures.buySymbol} (wallet-enforced)`,
      },
      { label: "Maximum network fee", value: formatFeeEstimate(figures.networkFee) },
    ])}
  </div>`;

/**
 * Renders secondary quote facts behind the technical disclosure.
 */
export const swapQuoteDetails = (figures: SwapConfirmFigures): string =>
  receipt([
    ...(figures.valueDelta === null
      ? []
      : [
          {
            label: "Value change",
            value: `${figures.valueDelta > 0 ? "+" : ""}${figures.valueDelta.toFixed(2)}%`,
            valueTone:
              figures.lossPercent >= SWAP_LOSS_WARN_PERCENT
                ? ("danger" as const)
                : ("default" as const),
          },
        ]),
    {
      label: "Aggregator fee estimate",
      value: `≈ ${formatFiat(figures.gasFeesInUsd, "usd")} (not wallet-enforced)`,
    },
    { label: "Route", value: "AVNU aggregator" },
  ]);
