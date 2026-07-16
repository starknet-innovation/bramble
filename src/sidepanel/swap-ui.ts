/**
 * Bindings for the swap flow: token selection, debounced AVNU quoting, the
 * flip control, Max, the confirmation receipt, execution, and the submitted
 * receipt. All state lives here at module level (selection, amount, stage,
 * latest quote) and is re-applied after every shell repaint — leaving the
 * screen resets the in-flight stage while keeping the chosen pair. Stale
 * quote responses are dropped by sequence number so a slow reply can never
 * overwrite a newer amount's quote. Templates live in ./swap-views.ts.
 */
import type { TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { isLikelySpam } from "../starknet/token-registry";
import type { DisplayCurrency, TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { formatFiat } from "./fiat";
import { icon } from "./icons";
import { accountLabel } from "./parts";
import type { BalanceState, SidepanelWallet } from "./runtime";
import type { SwapClient, SwapQuoteView } from "./swap-client";
import { compactAmount, tokenGlyph } from "./token-row";

/**
 * State accessors and services the swap bindings close over.
 */
export type SwapUiDeps = {
  readonly app: Element | null;
  readonly balances: () => BalanceState;
  readonly currency: () => DisplayCurrency;
  readonly preferences: () => WalletPreferences | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly status: () => WalletStatus;
  readonly swap: SwapClient;
  readonly wallet: SidepanelWallet;
};

const QUOTE_DEBOUNCE_MS = 350;
const SLIPPAGE = 0.005;

let sellTokenId: string | null = null;
let buyTokenId: string | null = null;
let amountText = "";
let quote: SwapQuoteView | null = null;
let quoteSeq = 0;
let quoteTimer: ReturnType<typeof setTimeout> | null = null;
let stage: "confirm" | "done" | "edit" = "edit";
let picking: "buy" | "sell" | null = null;
let done: { readonly buyText: string; readonly hash: string; readonly sellText: string } | null =
  null;

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

// Heals stale selections and picks sensible defaults: sell prefers ETH (or the
// first tradable token), buy prefers STRK (or the next distinct token).
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

// Renders every dynamic region from module state. Called after each repaint
// and after every imperative state change, so there is exactly one painter.
const applySwapUi = (deps: SwapUiDeps, root: Element): void => {
  const sellToken = tokenById(deps, sellTokenId);
  const buyToken = tokenById(deps, buyTokenId);
  const sellBalance = balanceFor(deps, sellTokenId);
  const buyBalance = balanceFor(deps, buyTokenId);
  const currency = deps.currency();
  const sellChip = root.querySelector("#swap-sell-token");
  const buyChip = root.querySelector("#swap-buy-token");
  if (sellChip) {
    sellChip.innerHTML = chipMarkup(sellToken);
  }
  if (buyChip) {
    buyChip.innerHTML = chipMarkup(buyToken);
  }
  const input = root.querySelector<HTMLInputElement>("#swap-sell-amount");
  if (input && input.value !== amountText && input.ownerDocument.activeElement !== input) {
    input.value = amountText;
  }
  setText(root, "swap-sell-balance", sellBalance ? compactAmount(sellBalance.formatted) : "0");
  setText(root, "swap-buy-balance", buyBalance ? compactAmount(buyBalance.formatted) : "0");
  setText(root, "swap-buy-amount", quote ? compactAmount(quote.buyAmount) : "0");
  setText(
    root,
    "swap-sell-usd",
    quote && amountNumber() > 0 ? `≈ ${formatFiat(quote.sellAmountInUsd, currency)}` : "",
  );
  setText(root, "swap-buy-usd", quote ? `≈ ${formatFiat(quote.buyAmountInUsd, currency)}` : "");
  const sellAmount = Number(quote?.sellAmount ?? "0");
  const buyAmount = Number(quote?.buyAmount ?? "0");
  // Sub-unit rates keep enough places for the display policy's significant
  // digits (0.5 ETH -> STRK reads "1 STRK = 0.000015 ETH", never "0 ETH").
  const rate = sellAmount > 0 ? buyAmount / sellAmount : 0;
  setText(
    root,
    "swap-rate",
    quote && rate > 0 && sellToken && buyToken
      ? `1 ${sellToken.symbol} = ${compactAmount(rate >= 1 ? rate.toFixed(4) : rate.toFixed(10))} ${buyToken.symbol}`
      : "",
  );
  setText(root, "swap-gas", quote ? `Fee ≈ ${formatFiat(quote.gasFeesInUsd, "usd")}` : "");
  const insufficient =
    amountNumber() > 0 && sellBalance !== null && amountNumber() > Number(sellBalance.formatted);
  const review = root.querySelector<HTMLButtonElement>("#swap-review");
  const reviewLabel = root.querySelector("#swap-review-label");
  if (review && reviewLabel) {
    review.disabled = !quote || insufficient || amountNumber() <= 0;
    reviewLabel.textContent = insufficient
      ? `Insufficient ${sellToken?.symbol ?? "balance"}`
      : "Swap";
  }
  root.querySelector("#swap-edit")?.toggleAttribute("hidden", stage !== "edit");
  root.querySelector("#swap-confirm")?.toggleAttribute("hidden", stage !== "confirm");
  root.querySelector("#swap-done")?.toggleAttribute("hidden", stage !== "done");
  const picker = root.querySelector<HTMLElement>("#swap-picker");
  if (picker) {
    picker.hidden = picking === null;
    if (picking !== null) {
      picker.innerHTML = tradableTokens(deps)
        .map((token) => {
          const balance = balanceFor(deps, token.id);
          return `<button class="option-row" role="option" type="button" data-swap-pick="${escapeHtml(token.id)}">
              ${tokenGlyph(token.address, token.symbol)}
              <span class="option-copy"><strong>${escapeHtml(token.symbol)}</strong><span class="option-sub">${escapeHtml(token.name)}</span></span>
              <span class="menu-value">${balance ? escapeHtml(compactAmount(balance.formatted)) : "0"}</span>
            </button>`;
        })
        .join("");
    }
  }
  if (stage === "confirm" && quote && sellToken && buyToken) {
    const receipt = root.querySelector("#swap-confirm-receipt");
    const minReceived = compactAmount((buyAmount * (1 - SLIPPAGE)).toFixed(8));
    if (receipt) {
      receipt.innerHTML = `
        <div class="receipt-row"><dt>You sell</dt><dd>${escapeHtml(compactAmount(quote.sellAmount))} ${escapeHtml(sellToken.symbol)}</dd></div>
        <div class="receipt-row"><dt>You receive (est.)</dt><dd>${escapeHtml(compactAmount(quote.buyAmount))} ${escapeHtml(buyToken.symbol)}</dd></div>
        <div class="receipt-row"><dt>Minimum received</dt><dd>${escapeHtml(minReceived)} ${escapeHtml(buyToken.symbol)}</dd></div>
        <div class="receipt-row"><dt>Network fee</dt><dd>≈ ${escapeHtml(formatFiat(quote.gasFeesInUsd, "usd"))}</dd></div>
        <div class="receipt-row"><dt>Slippage cap</dt><dd>0.5%</dd></div>
        <div class="receipt-row"><dt>Route</dt><dd>AVNU aggregator</dd></div>`;
    }
  }
  if (stage === "done" && done) {
    setText(root, "swap-done-copy", `${done.sellText} is on its way to becoming ${done.buyText}.`);
    const receipt = root.querySelector("#swap-done-receipt");
    if (receipt) {
      receipt.innerHTML = `
        <div class="receipt-row"><dt>Swapped</dt><dd>${escapeHtml(done.sellText)}</dd></div>
        <div class="receipt-row"><dt>For (est.)</dt><dd>${escapeHtml(done.buyText)}</dd></div>
        <div class="receipt-row"><dt>Transaction</dt><dd><code>${escapeHtml(accountLabel(done.hash))}</code><button class="icon-button" data-copy="${escapeHtml(done.hash)}" type="button" aria-label="Copy transaction hash">${icon("copy")}</button></dd></div>`;
    }
  }
};

const setResult = (root: Element, text: string): void => setText(root, "swap-result", text);

const requestQuote = (deps: SwapUiDeps, root: Element): void => {
  quote = null;
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
      setResult(root, "");
      applySwapUi(deps, root);
    },
    (error: unknown) => {
      if (seq !== quoteSeq) {
        return;
      }
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

/**
 * Binds the swap screen. Safe to call on every render; when the swap screen
 * is not mounted it resets the transient stage (keeping the chosen pair) so
 * the next visit starts at a fresh edit state.
 */
export const bindSwap = (deps: SwapUiDeps): void => {
  const root = deps.app?.querySelector("#wallet-screen-swap")?.parentElement;
  if (!root) {
    stage = "edit";
    picking = null;
    quote = null;
    amountText = "";
    done = null;
    return;
  }
  healSelection(deps);
  applySwapUi(deps, root);

  root.querySelector<HTMLInputElement>("#swap-sell-amount")?.addEventListener("input", (event) => {
    amountText = (event.target as HTMLInputElement).value.trim();
    scheduleQuote(deps, root);
  });
  root.querySelector("#swap-max")?.addEventListener("click", () => {
    const balance = balanceFor(deps, sellTokenId);
    if (balance) {
      amountText = balance.formatted;
      requestQuote(deps, root);
    }
  });
  root.querySelector("#swap-flip")?.addEventListener("click", () => {
    [sellTokenId, buyTokenId] = [buyTokenId, sellTokenId];
    if (quote) {
      amountText = quote.buyAmount;
    }
    requestQuote(deps, root);
  });
  root.querySelector("#swap-sell-token")?.addEventListener("click", () => {
    picking = picking === "sell" ? null : "sell";
    applySwapUi(deps, root);
  });
  root.querySelector("#swap-buy-token")?.addEventListener("click", () => {
    picking = picking === "buy" ? null : "buy";
    applySwapUi(deps, root);
  });
  root.querySelector("#swap-picker")?.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-swap-pick]");
    const id = row?.dataset["swapPick"];
    if (!id || !picking) {
      return;
    }
    if (picking === "sell") {
      buyTokenId = id === buyTokenId ? sellTokenId : buyTokenId;
      sellTokenId = id;
    } else {
      sellTokenId = id === sellTokenId ? buyTokenId : sellTokenId;
      buyTokenId = id;
    }
    picking = null;
    requestQuote(deps, root);
  });
  root.querySelector("#swap-review")?.addEventListener("click", () => {
    if (quote) {
      stage = "confirm";
      applySwapUi(deps, root);
    }
  });
  root.querySelector("#swap-back-button")?.addEventListener("click", () => {
    stage = "edit";
    requestQuote(deps, root);
  });
  const confirmButton = root.querySelector<HTMLButtonElement>("#swap-confirm-button");
  confirmButton?.addEventListener("click", () => {
    const sellToken = tokenById(deps, sellTokenId);
    const buyToken = tokenById(deps, buyTokenId);
    if (!quote || !sellToken || !buyToken || !sellTokenId || !buyTokenId) {
      return;
    }
    buttonBusy(confirmButton, true);
    const executed = quote;
    deps.swap
      .execute({
        amount: executed.sellAmount,
        buyAmount: compactAmount(executed.buyAmount),
        buyTokenId,
        quoteId: executed.quoteId,
        sellTokenId,
      })
      .then(
        async (hash) => {
          done = {
            buyText: `${compactAmount(executed.buyAmount)} ${buyToken.symbol}`,
            hash,
            sellText: `${compactAmount(executed.sellAmount)} ${sellToken.symbol}`,
          };
          stage = "done";
          quote = null;
          amountText = "";
          showToast("Swap submitted", "success");
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Swap failed"), "error");
          setResult(root, errorMessage(error, "Swap failed"));
          buttonBusy(confirmButton, false);
          stage = "edit";
          requestQuote(deps, root);
        },
      );
  });
};
