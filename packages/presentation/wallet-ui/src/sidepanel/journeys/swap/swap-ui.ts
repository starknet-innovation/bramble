/**
 * Bindings for the swap flow: token selection, debounced AVNU quoting, the
 * flip control, Max, the confirmation receipt, execution, and the submitted
 * receipt. All state lives here at module level (selection, amount, stage,
 * latest quote) and is re-applied after every shell repaint — leaving the
 * screen resets the in-flight stage while keeping the chosen pair. Stale
 * quote responses are dropped by sequence number so a slow reply can never
 * overwrite a newer amount's quote. Templates live in ./swap-views.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import type {
  DisplayCurrency,
  TokenConfig,
  WalletPreferences,
} from "@bramble/settings/preferences";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState, SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { formatFiat } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { reviewPanel } from "../../shared/review-render";
import { compactAmount, tokenGlyph } from "../portfolio/token-row";
import {
  SWAP_LOSS_HIGH_RISK_PERCENT,
  SWAP_LOSS_WARN_PERCENT,
  type SwapClient,
  type SwapPreparationView,
  type SwapQuoteView,
  swapValueDeltaPercent,
} from "./swap-client";
import { bindSwapPicker, repaintSwapPicker, setPickerSide } from "./swap-picker";
import { type SwapStage, transitionSwapStage } from "./swap-transition";
import { swapConfirmReceipt, swapQuoteDetails } from "./swap-views";

/**
 * State accessors and services the swap bindings close over.
 */
export type SwapUiDeps = {
  readonly app: Element | null;
  readonly balances: () => BalanceState;
  readonly currency: () => DisplayCurrency;
  readonly navigateHome: () => void;
  readonly preferences: () => WalletPreferences | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly status: () => WalletStatus;
  readonly swap: SwapClient;
  readonly wallet: SidepanelWallet;
};

const QUOTE_DEBOUNCE_MS = 350;

let sellTokenId: string | null = null;
let buyTokenId: string | null = null;
let amountText = "";
let pendingBuyAmount: string | null = null;
let quote: SwapQuoteView | null = null;
let preparation: SwapPreparationView | null = null;
let quoteSeq = 0;
let quoteTimer: ReturnType<typeof setTimeout> | null = null;
let stage: SwapStage = "edit";
let successSummary = "";
const SUCCESS_HOLD_MS = 1900;
let successTimer: ReturnType<typeof setTimeout> | null = null;

const tradableTokens = (deps: SwapUiDeps): readonly TokenConfig[] =>
  (deps.preferences()?.tokens ?? []).filter(
    (token) => token.networkId === deps.status().networkId && !isLikelySpam(token),
  );

const balanceFor = (deps: SwapUiDeps, tokenId: string | null): TokenBalance | null => {
  const state = deps.balances();
  return "error" in state
    ? null
    : (state.balances.find((balance) => balance.id === tokenId) ?? null);
};

const healSelection = (deps: SwapUiDeps): void => {
  const tokens = tradableTokens(deps);
  const has = (id: string | null): boolean => tokens.some((token) => token.id === id);
  if (!has(sellTokenId)) {
    sellTokenId = (tokens.find((token) => token.symbol === "ETH") ?? tokens[0])?.id ?? null;
  }
  if (!has(buyTokenId) || buyTokenId === sellTokenId) {
    buyTokenId =
      (
        tokens.find((token) => token.symbol === "STRK" && token.id !== sellTokenId) ??
        tokens.find((token) => token.id !== sellTokenId)
      )?.id ?? null;
  }
};

const setText = (root: Element, id: string, text: string): void => {
  const node = root.querySelector(`#${id}`);
  if (node) {
    node.textContent = text;
  }
};

const tokenById = (deps: SwapUiDeps, id: string | null): TokenConfig | null =>
  tradableTokens(deps).find((token) => token.id === id) ?? null;

const chipMarkup = (token: TokenConfig | null): string =>
  token
    ? `${tokenGlyph(token.address, token.symbol)}<span class="swap-token-copy">${escapeHtml(token.symbol)}</span>${icon("chevronDown")}`
    : `<span class="swap-token-copy">Select</span>${icon("chevronDown")}`;

const amountNumber = (): number => {
  const value = Number(amountText);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

type SwapFigures = {
  readonly buyToken: TokenConfig | null;
  readonly highRisk: boolean;
  readonly insufficient: boolean;
  readonly lossPercent: number;
  readonly sellBalance: TokenBalance | null;
  readonly sellToken: TokenConfig | null;
  readonly valueDelta: number | null;
};

const swapFigures = (deps: SwapUiDeps): SwapFigures => {
  const sellBalance = balanceFor(deps, sellTokenId);
  const valueDelta = quote ? swapValueDeltaPercent(quote) : null;
  const lossPercent = valueDelta !== null && valueDelta < 0 ? -valueDelta : 0;
  return {
    buyToken: tokenById(deps, buyTokenId),
    highRisk: quote !== null && lossPercent >= SWAP_LOSS_HIGH_RISK_PERCENT,
    insufficient:
      amountNumber() > 0 && sellBalance !== null && amountNumber() > Number(sellBalance.formatted),
    lossPercent,
    sellBalance,
    sellToken: tokenById(deps, sellTokenId),
    valueDelta,
  };
};

const paintSwapPanels = (deps: SwapUiDeps, root: Element, figures: SwapFigures): void => {
  const currency = deps.currency();
  const buyBalance = balanceFor(deps, buyTokenId);
  const sellChip = root.querySelector("#swap-sell-token");
  if (sellChip) {
    sellChip.innerHTML = chipMarkup(figures.sellToken);
  }
  const buyChip = root.querySelector("#swap-buy-token");
  if (buyChip) {
    buyChip.innerHTML = chipMarkup(figures.buyToken);
  }
  const input = root.querySelector<HTMLInputElement>("#swap-sell-amount");
  if (input && input.value !== amountText && input.ownerDocument.activeElement !== input) {
    input.value = amountText;
  }
  setText(
    root,
    "swap-sell-balance",
    figures.sellBalance ? compactAmount(figures.sellBalance.formatted) : "0",
  );
  setText(root, "swap-buy-balance", buyBalance ? compactAmount(buyBalance.formatted) : "0");
  setText(root, "swap-buy-amount", compactAmount(quote?.buyAmount ?? pendingBuyAmount ?? "0"));
  setText(
    root,
    "swap-sell-usd",
    quote && amountNumber() > 0 ? `≈ ${formatFiat(quote.sellAmountInUsd, currency)}` : "",
  );
  const buyUsdNode = root.querySelector<HTMLElement>("#swap-buy-usd");
  if (buyUsdNode) {
    const delta = figures.valueDelta;
    buyUsdNode.textContent = quote
      ? `≈ ${formatFiat(quote.buyAmountInUsd, currency)}${delta === null ? "" : ` (${delta > 0 ? "+" : ""}${delta.toFixed(2)}%)`}`
      : "";
    buyUsdNode.classList.toggle(
      "swap-delta-bad",
      delta !== null && delta <= -SWAP_LOSS_WARN_PERCENT,
    );
  }
};

const paintSwapMeta = (root: Element, figures: SwapFigures): void => {
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
    const message =
      quote && figures.lossPercent >= SWAP_LOSS_WARN_PERCENT
        ? `This route returns ${figures.lossPercent.toFixed(1)}% less value than you pay. Small orders can route poorly — try a larger amount or a different pair.`
        : "";
    warning.textContent = message;
    warning.hidden = message.length === 0;
  }
  const review = root.querySelector<HTMLButtonElement>("#swap-review");
  const reviewLabel = root.querySelector("#swap-review-label");
  if (review && reviewLabel) {
    review.disabled = !quote || figures.insufficient || amountNumber() <= 0;
    review.classList.toggle("swap-risk", figures.highRisk);
    reviewLabel.textContent = figures.insufficient
      ? `Insufficient ${figures.sellToken?.symbol ?? "balance"}`
      : figures.highRisk
        ? `Swap anyway (−${figures.lossPercent.toFixed(1)}%)`
        : "Swap";
  }
};

const paintSwapStages = (root: Element, figures: SwapFigures): void => {
  root.querySelector("#swap-edit")?.toggleAttribute("hidden", stage !== "edit");
  root.querySelector("#swap-confirm")?.toggleAttribute("hidden", stage !== "confirm");
  root.querySelector("#swap-success")?.toggleAttribute("hidden", stage !== "success");
  setText(root, "swap-success-summary", successSummary);
  const { buyToken, sellToken, valueDelta } = figures;
  if (stage !== "confirm" || !quote || !preparation || !sellToken || !buyToken) {
    return;
  }
  const receipt = root.querySelector("#swap-confirm-receipt");
  if (!receipt) {
    return;
  }
  // The minimum comes off the FROZEN preparation, where the background decoded
  // it out of the route calldata it is about to sign. It is never recomputed
  // here from the quote and a panel-local slippage constant, which is what once
  // let this card state a minimum the transaction did not carry.
  const confirmFigures = {
    buyAddress: buyToken.address,
    buyAmount: quote.buyAmount,
    buySymbol: buyToken.symbol,
    gasFeesInUsd: quote.gasFeesInUsd,
    lossPercent: figures.lossPercent,
    minBuyAmount: preparation.minBuyAmount,
    networkFee: preparation.reviewedFee,
    sellAddress: sellToken.address,
    sellAmount: quote.sellAmount,
    sellSymbol: sellToken.symbol,
    valueDelta,
  };
  receipt.innerHTML = swapConfirmReceipt(confirmFigures);
  const quoteDetails = root.querySelector("#swap-quote-details");
  if (quoteDetails) {
    quoteDetails.innerHTML = swapQuoteDetails(confirmFigures);
  }
  const calls = root.querySelector("#swap-call-review");
  if (calls) {
    calls.innerHTML = `<ul class="review-calls">${preparation.summaries
      .map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`)
      .join(
        "",
      )}</ul><p class="hint">Review digest <code>${escapeHtml(preparation.payloadDigest.slice(0, 23))}…</code></p>`;
  }
  const risk = root.querySelector("#swap-risk-review");
  if (risk) {
    risk.innerHTML = reviewPanel(preparation.flags.map((flag) => flag.message));
  }
};

const applySwapUi = (deps: SwapUiDeps, root: Element): void => {
  const figures = swapFigures(deps);
  paintSwapPanels(deps, root, figures);
  paintSwapMeta(root, figures);
  paintSwapStages(root, figures);
};

const setResult = (root: Element, text: string): void => setText(root, "swap-result", text);

const requestQuote = (deps: SwapUiDeps, root: Element): void => {
  quote = null;
  preparation = null;
  const seq = ++quoteSeq;
  if (amountNumber() <= 0 || !sellTokenId || !buyTokenId) {
    setResult(root, "");
    applySwapUi(deps, root);
    return;
  }
  setResult(root, "Finding the best route…");
  applySwapUi(deps, root);
  const input = { amount: amountText, buyTokenId, sellTokenId };
  deps.swap.quote(input).then(
    (view) => {
      if (seq !== quoteSeq) {
        return;
      }
      quote = view;
      pendingBuyAmount = null;
      setResult(root, "");
      applySwapUi(deps, root);
    },
    (error: unknown) => {
      if (seq !== quoteSeq) {
        return;
      }
      pendingBuyAmount = null;
      setResult(root, errorMessage(error, "No route available right now."));
      applySwapUi(deps, root);
    },
  );
};

const scheduleQuote = (deps: SwapUiDeps, root: Element): void => {
  if (quoteTimer !== null) {
    clearTimeout(quoteTimer);
  }
  quoteTimer = setTimeout(() => requestQuote(deps, root), QUOTE_DEBOUNCE_MS);
};

const applySelection =
  (deps: SwapUiDeps, root: Element) =>
  (side: "buy" | "sell", tokenId: string): void => {
    if (side === "sell") {
      buyTokenId = tokenId === buyTokenId ? sellTokenId : buyTokenId;
      sellTokenId = tokenId;
    } else {
      sellTokenId = tokenId === sellTokenId ? buyTokenId : sellTokenId;
      buyTokenId = tokenId;
    }
    pendingBuyAmount = null;
    requestQuote(deps, root);
  };

/**
 * Binds the swap screen. Safe to call on every render; when the swap screen
 * is not mounted it resets the transient stage (keeping the chosen pair) so
 * the next visit starts at a fresh edit state.
 */
export const bindSwap = (deps: SwapUiDeps): void => {
  const root = deps.app?.querySelector("#wallet-screen-swap")?.parentElement;
  if (!root) {
    stage = "edit";
    setPickerSide(null);
    quote = null;
    preparation = null;
    pendingBuyAmount = null;
    amountText = "";
    successSummary = "";
    if (successTimer !== null) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    return;
  }
  healSelection(deps);
  applySwapUi(deps, root);

  root.querySelector<HTMLInputElement>("#swap-sell-amount")?.addEventListener("input", (event) => {
    amountText = (event.target as HTMLInputElement).value.trim();
    quote = null;
    preparation = null;
    pendingBuyAmount = null;
    quoteSeq += 1;
    applySwapUi(deps, root);
    scheduleQuote(deps, root);
  });
  root.querySelector("#swap-max")?.addEventListener("click", () => {
    const balance = balanceFor(deps, sellTokenId);
    if (balance) {
      amountText = balance.formatted;
      pendingBuyAmount = null;
      requestQuote(deps, root);
    }
  });
  root.querySelector("#swap-flip")?.addEventListener("click", () => {
    const previousSellAmount = amountText;
    const previousBuyAmount = quote?.buyAmount ?? pendingBuyAmount;
    [sellTokenId, buyTokenId] = [buyTokenId, sellTokenId];
    if (previousBuyAmount) {
      amountText = previousBuyAmount;
      pendingBuyAmount = previousSellAmount;
    } else {
      pendingBuyAmount = null;
    }
    requestQuote(deps, root);
  });
  root.querySelector("#swap-sell-token")?.addEventListener("click", () => {
    setPickerSide("sell");
    repaintSwapPicker(deps, root);
    root.querySelector<HTMLInputElement>("#swap-picker-search")?.focus();
  });
  root.querySelector("#swap-buy-token")?.addEventListener("click", () => {
    setPickerSide("buy");
    repaintSwapPicker(deps, root);
    root.querySelector<HTMLInputElement>("#swap-picker-search")?.focus();
  });
  bindSwapPicker(deps, root, applySelection(deps, root));
  root.querySelector("#swap-review")?.addEventListener("click", () => {
    const sellToken = tokenById(deps, sellTokenId);
    const buyToken = tokenById(deps, buyTokenId);
    const reviewButton = root.querySelector<HTMLButtonElement>("#swap-review");
    if (!quote || !sellToken || !buyToken || !sellTokenId || !buyTokenId || !reviewButton) {
      return;
    }
    buttonBusy(reviewButton, true);
    setResult(root, "Building and validating the executable route…");
    const quoted = quote;
    const preparationSeq = quoteSeq;
    deps.swap
      .prepare({
        amount: quoted.sellAmount,
        // The RAW quoted amount, never the display form: compactAmount groups
        // thousands ("1000" reads "1,000"), and the background's amount reader
        // rejects a grouped string — formatting one into the message made every
        // quote of 1000 units or more unpreparable. Grouping is for the screen.
        buyAmount: quoted.buyAmount,
        buyTokenId,
        quoteId: quoted.quoteId,
        sellTokenId,
      })
      .then(
        (prepared) => {
          if (preparationSeq !== quoteSeq || quote !== quoted) {
            buttonBusy(reviewButton, false);
            return;
          }
          preparation = prepared;
          setResult(root, "");
          buttonBusy(reviewButton, false);
          transitionSwapStage(root.ownerDocument, stage, "confirm", () => {
            stage = "confirm";
            applySwapUi(deps, root);
          });
        },
        (error: unknown) => {
          if (preparationSeq !== quoteSeq || quote !== quoted) {
            buttonBusy(reviewButton, false);
            return;
          }
          setResult(root, errorMessage(error, "Could not prepare a safe swap route."));
          buttonBusy(reviewButton, false);
          applySwapUi(deps, root);
        },
      );
  });
  root.querySelector("#swap-back-button")?.addEventListener("click", () => {
    preparation = null;
    transitionSwapStage(root.ownerDocument, stage, "edit", () => {
      stage = "edit";
      requestQuote(deps, root);
    });
  });
  const confirmButton = root.querySelector<HTMLButtonElement>("#swap-confirm-button");
  confirmButton?.addEventListener("click", () => {
    const sellToken = tokenById(deps, sellTokenId);
    const buyToken = tokenById(deps, buyTokenId);
    if (!quote || !preparation || !sellToken || !buyToken || !sellTokenId || !buyTokenId) {
      return;
    }
    buttonBusy(confirmButton, true);
    const restingContent = confirmButton.innerHTML;
    confirmButton.innerHTML = `${icon("refresh")}Submitting swap…`;
    const executed = quote;
    const claimedPreparation = preparation;
    deps.swap.execute(claimedPreparation.id).then(
      async () => {
        const sellText = `${compactAmount(executed.sellAmount)} ${sellToken.symbol}`;
        const buyText = `${compactAmount(executed.buyAmount)} ${buyToken.symbol}`;
        successSummary = `${sellText} → ~${buyText}`;
        quote = null;
        preparation = null;
        amountText = "";
        setResult(root, "");
        transitionSwapStage(root.ownerDocument, stage, "success", () => {
          stage = "success";
          applySwapUi(deps, root);
        });
        if (successTimer !== null) {
          clearTimeout(successTimer);
        }
        successTimer = setTimeout(() => {
          successTimer = null;
          stage = "edit";
          successSummary = "";
          deps.navigateHome();
          // Honest state on landing: the transaction is sent and pending,
          // not yet final — Activity carries it until it settles.
          showToast(`Transaction sent — ${sellText} → ~${buyText} pending`, "success", root);
        }, SUCCESS_HOLD_MS);
        await deps.render(await deps.wallet.loadStatus());
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Swap failed"), "error", root);
        setResult(root, errorMessage(error, "Swap failed"));
        confirmButton.innerHTML = restingContent;
        buttonBusy(confirmButton, false);
        preparation = null;
        transitionSwapStage(root.ownerDocument, stage, "edit", () => {
          stage = "edit";
          requestQuote(deps, root);
        });
      },
    );
  });
};
