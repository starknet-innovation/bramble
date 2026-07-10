/**
 * Tokens screen event bindings. Follows the wallet's bindAll pattern: operates
 * only on the passed-in `app` element (never document/window), re-attaches on
 * every paint, and is a no-op when the Tokens tab is not present. Drill-in and
 * the sub-tabs toggle the `hidden` attribute on pre-rendered nodes (same shape as
 * the shell's tab-host toggling — no runtime HTML injection). The swap panel's
 * amount input and quick-amount chips quote through the ekubo/avnu protocol
 * layer, and the review button builds the swap calls for the in-wallet invoke
 * path. No event handlers are inlined (CSP-safe); the protocol calls fail closed
 * until those stubs land.
 *
 * NOTE (phase-2 integration): register `bindTokens({ app, status })` inside
 * bindAll() in src/sidepanel/index.ts (next to bindTrade) to activate this; the
 * foundation-owned entrypoint is intentionally left untouched here.
 */
import type { WalletStatus } from "../../popup/responses";
import type {
  MainnetTokenSymbol,
  SwapParams,
  SwapQuote,
  SwapQuoteParams,
} from "../../starknet/protocols";
import {
  avnu,
  ekubo,
  MAINNET_TOKEN_ADDRESSES,
  MAINNET_TOKEN_DECIMALS,
} from "../../starknet/protocols";
import { SAMPLE_TOKENS, type TokenListItem } from "./data";

/**
 * State accessors the Tokens bindings close over. `status` supplies the active
 * account used as the swap taker; it comes from the entrypoint's render context.
 */
export type TokensUiDeps = {
  readonly app: Element | null;
  readonly status: WalletStatus;
};

type SwapSide = "buy" | "sell";

const SLIPPAGE_BPS = 50;

const activeAddress = (status: WalletStatus): string | null =>
  status.accounts.find((account) => account.id === status.activeAccountId)?.address ?? null;

const decimalsFor = (symbol: string): number =>
  symbol in MAINNET_TOKEN_DECIMALS ? MAINNET_TOKEN_DECIMALS[symbol as MainnetTokenSymbol] : 18;

const swapPair = (
  token: TokenListItem,
  side: SwapSide,
): {
  readonly sellToken: string;
  readonly buyToken: string;
  readonly sellSymbol: string;
  readonly buySymbol: string;
} => {
  const usdc = MAINNET_TOKEN_ADDRESSES.USDC;
  return side === "buy"
    ? { sellToken: usdc, buyToken: token.address, sellSymbol: "USDC", buySymbol: token.symbol }
    : { sellToken: token.address, buyToken: usdc, sellSymbol: token.symbol, buySymbol: "USDC" };
};

const toSmallestUnits = (value: string, decimals: number): string | null => {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
  const trimmed = scaled.replace(/^0+(?=\d)/, "");
  return trimmed === "" ? "0" : trimmed;
};

const fromSmallestUnits = (amount: string, decimals: number): string => {
  if (!/^\d+$/.test(amount)) {
    return amount;
  }
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction.slice(0, 6)}` : whole;
};

const quoteBest = async (params: SwapQuoteParams): Promise<SwapQuote> => {
  try {
    return await avnu.quoteSwap(params);
  } catch {
    return await ekubo.quoteSwap(params);
  }
};

const buildCalls = (params: SwapParams) =>
  params.quote.protocol === "ekubo" ? ekubo.buildSwapCalls(params) : avnu.buildSwapCalls(params);

const describeQuote = (quote: SwapQuote, buySymbol: string): string => {
  const human = fromSmallestUnits(quote.buyAmount, decimalsFor(buySymbol));
  return `≈ ${human} ${buySymbol} via ${quote.protocol.toUpperCase()}`;
};

const camel = (attr: string): string =>
  attr.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const bindSubTabs = (host: HTMLElement, attr: string, panelAttr: string): void => {
  const buttons = host.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`);
  const key = camel(attr);
  const panelKey = camel(panelAttr);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const active = button.dataset[key];
      if (active === undefined) {
        return;
      }
      buttons.forEach((other) => {
        other.setAttribute("aria-selected", String(other.dataset[key] === active));
      });
      host.querySelectorAll<HTMLElement>(`[data-${panelAttr}]`).forEach((element) => {
        const node = element;
        node.hidden = node.dataset[panelKey] !== active;
      });
    });
  });
};

const bindSwap = (host: HTMLElement, token: TokenListItem, status: WalletStatus): void => {
  const input = host.querySelector<HTMLInputElement>("[data-token-amount]");
  const quoteEl = host.querySelector<HTMLElement>("[data-token-quote]");
  const submit = host.querySelector<HTMLButtonElement>("[data-token-swap]");
  const payLabel = host.querySelector<HTMLElement>("[data-token-pay-label]");
  const sideButtons = host.querySelectorAll<HTMLButtonElement>("[data-token-side]");
  let side: SwapSide = "buy";
  let lastQuote: SwapQuote | null = null;

  const refreshQuote = async (): Promise<void> => {
    if (!input || !quoteEl) {
      return;
    }
    lastQuote = null;
    if (submit) {
      submit.disabled = true;
    }
    const raw = input.value.trim();
    if (raw === "") {
      quoteEl.textContent = "Enter an amount to see a quote.";
      return;
    }
    const taker = activeAddress(status);
    if (!taker) {
      quoteEl.textContent = "Select an account to quote a swap.";
      return;
    }
    const pair = swapPair(token, side);
    const sellAmount = toSmallestUnits(raw, decimalsFor(pair.sellSymbol));
    if (!sellAmount) {
      quoteEl.textContent = "Enter a valid amount.";
      return;
    }
    quoteEl.textContent = "Fetching quote…";
    try {
      const quote = await quoteBest({
        sellToken: pair.sellToken,
        buyToken: pair.buyToken,
        sellAmount,
        takerAddress: taker,
        slippageBps: SLIPPAGE_BPS,
      });
      lastQuote = quote;
      quoteEl.textContent = describeQuote(quote, pair.buySymbol);
      if (submit) {
        submit.disabled = false;
      }
    } catch {
      quoteEl.textContent = "Quote unavailable right now.";
    }
  };

  const setSide = (next: SwapSide): void => {
    side = next;
    sideButtons.forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tokenSide === next));
    });
    if (payLabel) {
      payLabel.textContent = next === "buy" ? "You pay (USDC)" : `You pay (${token.symbol})`;
    }
    void refreshQuote();
  };

  sideButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.tokenSide;
      if (next === "buy" || next === "sell") {
        setSide(next);
      }
    });
  });

  host.querySelectorAll<HTMLButtonElement>("[data-token-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      if (input) {
        input.value = button.dataset.tokenQuick ?? "";
        void refreshQuote();
      }
    });
  });

  input?.addEventListener("input", () => {
    void refreshQuote();
  });

  submit?.addEventListener("click", () => {
    const taker = activeAddress(status);
    if (!lastQuote || !taker || !quoteEl) {
      return;
    }
    try {
      const calls = buildCalls({
        quote: lastQuote,
        takerAddress: taker,
        slippageBps: SLIPPAGE_BPS,
      });
      quoteEl.textContent = `Ready to confirm — ${calls.length} call${calls.length === 1 ? "" : "s"} to sign.`;
    } catch {
      quoteEl.textContent = "Unable to build the swap yet.";
    }
  });
};

/**
 * Binds the Tokens screen. Safe to call on every render; returns immediately
 * when the Tokens tab is not on screen. Drill-in and the detail sub-tabs toggle
 * `hidden` on pre-rendered nodes; drill-in state resets on a full repaint,
 * mirroring the ephemeral home sub-views.
 */
export const bindTokens = (deps: TokensUiDeps): void => {
  const panel = deps.app?.querySelector<HTMLElement>('[data-trade-panel="tokens"]');
  const list = panel?.querySelector<HTMLElement>('[data-tokens-view="list"]');
  if (!panel || !list) {
    return;
  }
  const hosts = panel.querySelectorAll<HTMLElement>("[data-token-detail-host]");
  const showList = (): void => {
    list.hidden = false;
    hosts.forEach((element) => {
      const node = element;
      node.hidden = true;
    });
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-token-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.tokenOpen;
      if (!SAMPLE_TOKENS.some((token) => token.id === id)) {
        return;
      }
      list.hidden = true;
      hosts.forEach((element) => {
        const node = element;
        node.hidden = node.dataset.tokenDetailHost !== id;
      });
    });
  });

  hosts.forEach((host) => {
    const token = SAMPLE_TOKENS.find((candidate) => candidate.id === host.dataset.tokenDetailHost);
    if (!token) {
      return;
    }
    host.querySelector<HTMLButtonElement>("[data-token-back]")?.addEventListener("click", showList);
    bindSubTabs(host, "token-tab", "token-tabpanel");
    bindSwap(host, token, deps.status);
  });
};
