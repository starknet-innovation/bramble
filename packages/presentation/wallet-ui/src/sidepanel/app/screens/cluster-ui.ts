/**
 * Wiring for the asset cluster: swap, tokens, the AVNU token catalog,
 * allowances, and connected sites. Extracted from the side panel entrypoint to
 * keep it within the size budget; navigation side effects are passed in as
 * callbacks and every state read goes through the shared render cache, so this
 * module holds no module-level state.
 */
import { bindAllowances } from "../../journeys/portfolio/allowance-ui";
import { bindTokenCatalog } from "../../journeys/portfolio/token-catalog-ui";
import { bindTokens } from "../../journeys/portfolio/tokens-ui";
import { bindConnectedSites } from "../../journeys/settings/origins-ui";
import type { SwapClient } from "../../journeys/swap/swap-client";
import { bindSwap } from "../../journeys/swap/swap-ui";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { RenderData } from "../rendering/render-cache";

/**
 * Callbacks and context the cluster screen bindings close over. `cache` is the
 * shell's live render cache, read through accessors at event time rather than
 * captured, so a binding installed on one paint still sees current state.
 */
export type ClusterUiDeps = {
  readonly app: Element | null;
  readonly cache: RenderData;
  /** Leaves the swap screen for a dock screen, from its receipt or its header. */
  readonly leaveSwap: (view: "activity" | "home") => void;
  /**
   * Opens Send or Swap on a chosen asset. Send still asks for the recipient:
   * the asset is the only thing carried over, so the caller sets no intent —
   * an intent names a recipient and would skip that step.
   */
  readonly openWithToken: (view: "send" | "swap", tokenId: string) => void;
  readonly openToken: (tokenId: string) => void;
  readonly render: (status: RenderData["status"]) => Promise<void>;
  readonly swap: SwapClient;
  readonly wallet: SidepanelWallet;
};

// The token detail screen's own Send and Swap. Each seeds the asset and hands
// over to that journey; neither prepares anything itself.
const bindTokenDetailActions = (deps: ClusterUiDeps): void => {
  for (const [attribute, key, view] of [
    ["data-send-token", "sendToken", "send"],
    ["data-swap-token", "swapToken", "swap"],
  ] as const) {
    deps.app?.querySelectorAll<HTMLButtonElement>(`[${attribute}]`).forEach((button) => {
      button.addEventListener("click", () => {
        const tokenId = button.dataset[key];
        if (tokenId) deps.openWithToken(view, tokenId);
      });
    });
  }
};

/**
 * Binds the swap, connected-sites, tokens, catalog, and allowance screens. The
 * NFT bindings remain in their journey while it is parked, but no live screen
 * installs their handlers.
 */
export const bindClusterScreens = (deps: ClusterUiDeps): void => {
  const { app, cache, render, wallet } = deps;
  bindTokenDetailActions(deps);
  bindSwap({
    app,
    balances: () => cache.balances,
    currency: () => cache.preferences?.displayCurrency ?? "usd",
    navigateActivity: () => deps.leaveSwap("activity"),
    navigateHome: () => deps.leaveSwap("home"),
    preferences: () => cache.preferences,
    render,
    status: () => cache.status,
    swap: deps.swap,
    wallet,
  });
  bindConnectedSites({ app, render, wallet });
  bindTokens({
    app,
    openToken: deps.openToken,
    refresh: () => wallet.loadStatus(),
    render,
    wallet,
  });
  bindTokenCatalog({
    app,
    // The catalog AVNU publishes is the swap client's own read; the tokens
    // screen shows the same list rather than fetching a second copy.
    catalog: () => deps.swap.tokens(),
    preferences: () => cache.preferences,
    refresh: () => wallet.loadStatus(),
    render,
    status: () => cache.status,
    wallet,
  });
  bindAllowances({ app, render, wallet });
};
