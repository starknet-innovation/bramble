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
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState, SidepanelWallet } from "../../runtime/runtime";
import { awaitConfirmation } from "../../shared/confirm-submitted";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { formatFiat } from "../../shared/fiat";
import { icon } from "../../shared/icons";
import { setFlowStep } from "../../shared/parts";
import { compactAmount, tokenGlyph } from "../portfolio/token-row";
import { setText } from "../send/transfer-progress-ui";
import {
  SWAP_LOSS_HIGH_RISK_PERCENT,
  SWAP_LOSS_WARN_PERCENT,
  type SwapClient,
  type SwapPreparationView,
  type SwapQuoteView,
  swapValueDeltaPercent,
} from "./swap-client";
import { bindSwapTokenDropdowns } from "./swap-picker";
import { swapPresetPair } from "./swap-preset";
import type { SwapFigures } from "./swap-receipt";
import {
  EMPTY_SWAP_RECEIPT,
  paintSwapConfirm,
  paintSwapMeta,
  paintSwapReceipt,
  type SwapReceipt,
  swapReceiptFor,
  swapUnknownReceipt,
} from "./swap-receipt";
import { type SwapStage, transitionSwapStage } from "./swap-transition";

/**
 * State accessors and services the swap bindings close over.
 */
export type SwapUiDeps = {
  readonly app: Element | null;
  readonly balances: () => BalanceState;
  /** Overrides the confirmation checkpoints; tests pass a single zero delay. */
  readonly confirmationDelaysMs?: readonly number[];
  readonly currency: () => DisplayCurrency;
  readonly navigateActivity: () => void;
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
let receipt: SwapReceipt = EMPTY_SWAP_RECEIPT;
let confirmEpoch = 0;
// True from Confirm until the swap settles (refused, failed, or receipted).
// Header Back is ignored meanwhile: the preparation is already spent, and an
// abandoned wait must not take over the next swap (mc-wallet issue 476).
let submitting = false;

/** Opens the swap on a chosen sell token, clearing any in-flight quote. */
export const presetSwapPair = (sellId: string, tokens: readonly TokenConfig[]): void => {
  const pair = swapPresetPair(sellId, tokens);
  if (!pair) return;
  [sellTokenId, buyTokenId, amountText] = [pair.sellId, pair.buyId, ""];
  [quote, preparation, pendingBuyAmount, stage] = [null, null, null, "edit"];
};

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

const SWAP_STEP_INDEX: Readonly<Record<SwapStage, number>> = { confirm: 1, edit: 0, success: 2 };

const paintSwapStages = (root: Element, figures: SwapFigures, networkId: string): void => {
  setFlowStep(root, "data-swap-step", SWAP_STEP_INDEX[stage]);
  root.querySelector(".send-progress")?.removeAttribute("hidden");
  root.querySelector("#swap-edit")?.toggleAttribute("hidden", stage !== "edit");
  root.querySelector("#swap-confirm")?.toggleAttribute("hidden", stage !== "confirm");
  root.querySelector("#swap-success")?.toggleAttribute("hidden", stage !== "success");
  paintSwapReceipt(root, receipt, networkId);
  const { buyToken, sellToken, valueDelta } = figures;
  if (stage !== "confirm" || !quote || !preparation || !sellToken || !buyToken) {
    return;
  }
  paintSwapConfirm(root, {
    buyToken,
    lossPercent: figures.lossPercent,
    preparation,
    quote,
    sellToken,
    valueDelta,
  });
};

const applySwapUi = (deps: SwapUiDeps, root: Element): void => {
  const figures = swapFigures(deps);
  paintSwapPanels(deps, root, figures);
  paintSwapMeta(root, figures, quote, amountNumber());
  paintSwapStages(root, figures, deps.status().networkId);
};

const setResult = (root: Element, text: string): void => setText(root, "swap-result", text);

// `note` keeps a reason on screen (a failed swap's) while the fresh quote loads
// and after it lands; a quote error still replaces it.
const requestQuote = (deps: SwapUiDeps, root: Element, note = ""): void => {
  quote = null;
  preparation = null;
  const seq = ++quoteSeq;
  if (amountNumber() <= 0 || !sellTokenId || !buyTokenId) {
    setResult(root, note);
    applySwapUi(deps, root);
    return;
  }
  setResult(root, note || "Finding the best route…");
  applySwapUi(deps, root);
  const input = { amount: amountText, buyTokenId, sellTokenId };
  deps.swap.quote(input).then(
    (view) => {
      if (seq !== quoteSeq) {
        return;
      }
      quote = view;
      pendingBuyAmount = null;
      setResult(root, note);
      applySwapUi(deps, root);
    },
    (error: unknown) => {
      if (seq !== quoteSeq) {
        return;
      }
      pendingBuyAmount = null;
      setResult(root, errorLine(error, "No route available right now."));
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

const swapRoot = (deps: SwapUiDeps): Element | null =>
  deps.app?.querySelector("#wallet-screen-swap")?.parentElement ?? null;

/**
 * Binds the swap screen. Safe to call on every render; when the swap screen
 * is not mounted it resets the transient stage (keeping the chosen pair) so
 * the next visit starts at a fresh edit state.
 */
export const bindSwap = (deps: SwapUiDeps): void => {
  const root = swapRoot(deps);
  if (!root) {
    stage = "edit";
    quote = null;
    preparation = null;
    pendingBuyAmount = null;
    amountText = "";
    receipt = EMPTY_SWAP_RECEIPT;
    confirmEpoch += 1;
    submitting = false;
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
  bindSwapTokenDropdowns(deps, root, applySelection(deps, root));
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
          setResult(root, errorLine(error, "Could not prepare a safe swap route."));
          buttonBusy(reviewButton, false);
          applySwapUi(deps, root);
        },
      );
  });
  // Both ways off the receipt reset the stage first, so returning to Swap opens
  // on a fresh quote rather than on the transaction that already left.
  for (const [id, leave] of [
    ["#swap-view-activity", deps.navigateActivity],
    ["#swap-home", deps.navigateHome],
  ] as const) {
    root.querySelector(id)?.addEventListener("click", () => {
      stage = "edit";
      receipt = EMPTY_SWAP_RECEIPT;
      confirmEpoch += 1;
      leave();
    });
  }
  // The review stage carries no Back button, so the header's arrow steps back to
  // the quote from there and leaves the flow from anywhere else; it does nothing
  // while a swap is submitting, so no confirmation wait is ever left behind.
  root.ownerDocument.querySelector("#swap-header-back")?.addEventListener("click", () => {
    if (submitting) return;
    if (stage !== "confirm") {
      deps.navigateHome();
      return;
    }
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
    submitting = true;
    const restingContent = confirmButton.innerHTML;
    confirmButton.innerHTML = `${icon("refresh")}Submitting swap…`;
    const executed = quote;
    const claimedPreparation = preparation;
    const sellText = `${compactAmount(executed.sellAmount)} ${sellToken.symbol}`;
    const summary = `${sellText} → ~${compactAmount(executed.buyAmount)} ${buyToken.symbol}`;
    const follow = async (transactionHash: string): Promise<void> => {
      // The preparation is spent; the amount is kept until the outcome, so a
      // failed swap can be re-quoted as it was.
      quote = null;
      preparation = null;
      setResult(root, "");
      // The hash is a handoff, not an outcome. The screen stays on the
      // review, saying what it is doing, until the chain answers.
      const epoch = ++confirmEpoch;
      confirmButton.innerHTML = `${icon("refresh")}Confirming…`;
      const outcome = await awaitConfirmation({
        ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
        hash: transactionHash,
        loadActivity: () => deps.wallet.loadActivity(),
        stillCurrent: () => epoch === confirmEpoch,
      });
      if (epoch !== confirmEpoch) return;
      submitting = false;
      if (outcome?.kind === "failed") {
        // The review's preparation is spent, so its Confirm cannot run again:
        // return to edit and re-quote the same amount, keeping the reason.
        showToast(outcome.toast, "error", root);
        confirmButton.innerHTML = restingContent;
        buttonBusy(confirmButton, false);
        stage = "edit";
        await deps.render(await deps.wallet.loadStatus());
        if (epoch !== confirmEpoch) return;
        // The repaint may have rebuilt the screen; quote into the live one.
        requestQuote(deps, swapRoot(deps) ?? root, outcome.message);
        return;
      }
      amountText = "";
      receipt = swapReceiptFor(outcome, summary, transactionHash);
      transitionSwapStage(root.ownerDocument, stage, "success", () => {
        stage = "success";
        applySwapUi(deps, root);
      });
      if (outcome) showToast(outcome.toast, "success", root);
      await deps.render(await deps.wallet.loadStatus());
    };
    deps.swap.execute(claimedPreparation.id).then(follow, (error: unknown) => {
      // A lost reply may already be on chain: follow its signed hash, or say
      // the status is unknown — never re-quote into a second swap (audit 173).
      if (error instanceof SubmissionUnknownError) {
        if (error.transactionHash) {
          void follow(error.transactionHash);
          return;
        }
        [submitting, quote, preparation, amountText] = [false, null, null, ""];
        confirmButton.innerHTML = restingContent;
        buttonBusy(confirmButton, false);
        receipt = swapUnknownReceipt(error.message, summary);
        transitionSwapStage(root.ownerDocument, stage, "success", () => {
          stage = "success";
          applySwapUi(deps, root);
        });
        return;
      }
      submitting = false;
      showToast(errorDetails(error, "Swap failed"), "error", root);
      setResult(root, errorLine(error, "Swap failed"));
      confirmButton.innerHTML = restingContent;
      buttonBusy(confirmButton, false);
      preparation = null;
      transitionSwapStage(root.ownerDocument, stage, "edit", () => {
        stage = "edit";
        requestQuote(deps, root);
      });
    });
  });
};
