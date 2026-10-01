/**
 * What the swap screen is allowed to say once a swap has left the wallet.
 *
 * Kept as one value rather than four loose variables in the binder, because
 * every field has to move together: a heading that claims completion beside a
 * hash the chain has not answered for is the exact mistake this screen used to
 * make. The binder holds one receipt and replaces it whole.
 */
import type { TokenConfig } from "@bramble/settings/preferences";
import type { TokenBalance } from "../../../popup/responses/responses";
import type { ConfirmationOutcome } from "../../shared/confirm-submitted";
import { renderFragment } from "../../shared/dom";
import { formatFiat } from "../../shared/fiat";
import { applyOutcomeHash } from "../../shared/outcome-hash";
import { reviewPanel } from "../../shared/review-render";
import { compactAmount } from "../portfolio/token-row";
import { setText } from "../send/transfer-progress-ui";
import type { SwapPreparationView, SwapQuoteView } from "./swap-client";

/** Everything the screen derives from the quote, the balance and the pair. */
export type SwapFigures = {
  readonly buyToken: TokenConfig | null;
  readonly highRisk: boolean;
  readonly insufficient: boolean;
  readonly lossPercent: number;
  readonly sellBalance: TokenBalance | null;
  readonly sellToken: TokenConfig | null;
  readonly valueDelta: number | null;
};

import { SWAP_LOSS_WARN_PERCENT } from "./swap-client";
import { swapConfirmReceipt } from "./swap-views";

/** The heading, the qualifier under it, and the figures it stands over. */
export type SwapReceipt = {
  readonly hash: string;
  /** Empty unless the receipt is claiming less than completion. */
  readonly note: string;
  readonly summary: string;
  readonly title: string;
};

/** Nothing submitted: what the screen carries before and after a swap. */
export const EMPTY_SWAP_RECEIPT: SwapReceipt = { hash: "", note: "", summary: "", title: "" };

/**
 * Builds the receipt for a submitted swap from the chain's answer.
 *
 * A `null` outcome is the journey running out of patience, which is neither
 * success nor failure: the swap is on its way and the receipt says exactly
 * that, rather than claiming a completion nothing has confirmed. A failed
 * outcome never reaches here — the binder keeps that on the review, where a
 * retry starts.
 */
export const swapReceiptFor = (
  outcome: ConfirmationOutcome | null,
  summary: string,
  hash: string,
): SwapReceipt => ({
  hash,
  note: outcome ? "" : "Not confirmed yet. Follow it in Activity.",
  summary,
  title: outcome ? "Swap complete" : "Swap submitted",
});

/**
 * Writes the receipt into the success stage under `root`. The identifier goes
 * through the shared outcome row, so a swap reports its transaction exactly as
 * a send does.
 */
export const paintSwapReceipt = (root: Element, receipt: SwapReceipt, networkId: string): void => {
  setText(root, "swap-success-summary", receipt.summary);
  setText(root, "swap-success-title", receipt.title);
  setText(root, "swap-success-note", receipt.note);
  root.querySelector("#swap-success-note")?.toggleAttribute("hidden", receipt.note === "");
  applyOutcomeHash(root, "swap-success-hash", receipt.hash, networkId);
};

/** The token facts the confirm card states for one side of the pair. */
type SwapSide = { readonly address: string; readonly symbol: string };

/**
 * Writes the confirm card and its risk panel.
 *
 * The minimum comes off the FROZEN preparation, where the background decoded it
 * out of the route calldata it is about to sign. It is never recomputed here
 * from the quote and a panel-local slippage constant, which is what once let
 * this card state a minimum the transaction did not carry.
 */
export const paintSwapConfirm = (
  root: Element,
  input: {
    readonly buyToken: SwapSide;
    readonly lossPercent: number;
    readonly preparation: SwapPreparationView;
    readonly quote: SwapQuoteView;
    readonly sellToken: SwapSide;
    readonly valueDelta: number | null;
  },
): void => {
  const card = root.querySelector("#swap-confirm-receipt");
  if (!card) {
    return;
  }
  renderFragment(
    card,
    swapConfirmReceipt({
      buyAddress: input.buyToken.address,
      buyAmount: input.quote.buyAmount,
      buySymbol: input.buyToken.symbol,
      gasFeesInUsd: input.quote.gasFeesInUsd,
      lossPercent: input.lossPercent,
      minBuyAmount: input.preparation.minBuyAmount,
      networkFee: input.preparation.reviewedFee,
      sellAddress: input.sellToken.address,
      sellAmount: input.quote.sellAmount,
      sellSymbol: input.sellToken.symbol,
      valueDelta: input.valueDelta,
    }),
  );
  const risk = root.querySelector("#swap-risk-review");
  if (risk) {
    renderFragment(risk, reviewPanel(input.preparation.flags.map((flag) => flag.message)));
  }
};

/**
 * Writes the quote line, the fee, the slippage warning and the review control.
 * The figures come in rather than being read from the binder's state, so what
 * the screen states is a function of what it was given.
 */
export const paintSwapMeta = (
  root: Element,
  figures: SwapFigures,
  quote: SwapQuoteView | null,
  amount: number,
): void => {
  const sellAmount = Number(quote?.sellAmount ?? "0");
  const buyAmount = Number(quote?.buyAmount ?? "0");
  // Sub-unit rates keep enough places for the display policy's significant
  // digits (0.5 ETH -> STRK reads "1 STRK = 0.000015 ETH", never "0 ETH").
  const rate = sellAmount > 0 ? buyAmount / sellAmount : 0;
  setText(
    root,
    "swap-rate",
    quote && rate > 0 && figures.sellToken && figures.buyToken
      ? `1 ${figures.sellToken.symbol} = ${compactAmount(rate >= 1 ? rate.toFixed(4) : rate.toFixed(10))} ${figures.buyToken.symbol}`
      : "",
  );
  setText(root, "swap-gas", quote ? `Fee ≈ ${formatFiat(quote.gasFeesInUsd, "usd")}` : "");
  const warning = root.querySelector<HTMLElement>("#swap-warning");
  if (warning) {
    // The Swap button carries the figure ("Swap anyway (-4.2%)"), so the
    // warning names the risk rather than restating the percentage.
    const message =
      quote && figures.lossPercent >= SWAP_LOSS_WARN_PERCENT ? "High slippage risk" : "";
    warning.textContent = message;
    warning.hidden = message.length === 0;
  }
  const review = root.querySelector<HTMLButtonElement>("#swap-review");
  const reviewLabel = root.querySelector("#swap-review-label");
  if (review && reviewLabel) {
    review.disabled = !quote || figures.insufficient || amount <= 0;
    review.classList.toggle("swap-risk", figures.highRisk);
    reviewLabel.textContent = figures.insufficient
      ? `Insufficient ${figures.sellToken?.symbol ?? "balance"}`
      : figures.highRisk
        ? `Swap anyway (−${figures.lossPercent.toFixed(1)}%)`
        : "Review swap";
  }
};
