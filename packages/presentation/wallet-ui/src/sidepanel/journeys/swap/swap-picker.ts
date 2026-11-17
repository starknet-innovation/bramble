/**
 * Token source for Swap's two dropdowns (pay and receive).
 *
 * The list is the wallet's shared token dropdown: the tokens this account holds
 * first, then the rest of AVNU's verified catalog for the active network. The
 * catalog is a directory, never a source of truth — choosing a token the wallet
 * does not track yet routes through the add-token flow, which reads the token's
 * facts from the CONTRACT on chain, and the selection is delivered only once it
 * is tracked.
 *
 * Module state (the cached catalog, and a pick waiting on an add) survives shell
 * repaints; ./swap-ui.ts calls {@link bindSwapTokenDropdowns} on every bind.
 */

import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState, SidepanelWallet } from "../../runtime/runtime";
import { errorDetails, showToast } from "../../shared/dom";
import {
  bindTokenDropdown,
  type TokenDropdownGroup,
  tokenDropdownOptions,
} from "../../shared/token-dropdown";
import type { SwapCatalogTokenView, SwapClient } from "./swap-client";

/**
 * State accessors and services the dropdowns close over — a structural subset
 * of the swap screen's deps (kept separate so the modules stay cycle-free).
 */
export type SwapPickerDeps = {
  readonly balances: () => BalanceState;
  readonly preferences: () => WalletPreferences | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly status: () => WalletStatus;
  readonly swap: SwapClient;
  readonly wallet: SidepanelWallet;
};

/** Which side of the swap a dropdown fills. */
export type PickerSide = "buy" | "sell";

const SIDES: readonly PickerSide[] = ["sell", "buy"];

let catalog: readonly SwapCatalogTokenView[] | null = null;
let catalogNetworkId: string | null = null;
let catalogLoading = false;
// The fetch in flight, and the paint of whichever screen is live when it lands.
let catalogRequest = 0;
let repaintLatest: (() => void) | null = null;
// A selected token that first needs tracking; resolved to a token id on the
// bind that follows the add-token render.
let pendingAdd: { readonly address: string; readonly side: PickerSide } | null = null;

/**
 * Clears the panel-local catalog between isolated tests. Production code keeps
 * it so opening the dropdown twice does not fetch the list twice. Bumping the
 * request drops a reply still in flight, so it cannot land in the next case.
 */
export const resetSwapCatalogForTests = (): void => {
  catalog = null;
  catalogNetworkId = null;
  catalogLoading = false;
  pendingAdd = null;
  catalogRequest += 1;
  repaintLatest = null;
};

const trackedTokens = (deps: SwapPickerDeps): readonly TokenConfig[] =>
  (deps.preferences()?.tokens ?? []).filter((token) => token.networkId === deps.status().networkId);

const trackedByAddress = (deps: SwapPickerDeps, address: string): TokenConfig | undefined =>
  trackedTokens(deps).find((token) => sameFelt(token.address, address));

const ensureCatalog = (deps: SwapPickerDeps, root: Element): void => {
  const networkId = deps.status().networkId;
  if (catalogNetworkId !== networkId) {
    catalog = null;
    catalogNetworkId = networkId;
    // The fetch still in flight belonged to the previous network. It is no
    // longer loading this one, and its answer is discarded when it lands.
    catalogLoading = false;
  }
  // Always the live screen. A shell refresh while the list is loading rebuilds
  // the panel, and the paint captured by the first bind would write into the
  // one that was thrown away.
  repaintLatest = () => {
    if (root.isConnected) fillPanels(deps, root);
  };
  if (catalog !== null || catalogLoading) {
    return;
  }
  catalogLoading = true;
  const request = ++catalogRequest;
  const settle = (tokens: readonly SwapCatalogTokenView[]): void => {
    // A later fetch, or a network switch, has already replaced this request;
    // pinning its list here would show another network's tokens.
    if (request !== catalogRequest || catalogNetworkId !== networkId) {
      return;
    }
    catalogLoading = false;
    catalog = tokens;
    repaintLatest?.();
  };
  deps.swap.tokens().then(
    (tokens) => settle(tokens),
    () => {
      // A catalog this wallet cannot reach leaves the tracked tokens, which are
      // enough to swap between; nothing here is worth interrupting the screen.
      settle([]);
    },
  );
};

/**
 * The two groups the dropdown shows: what this account holds, then the rest of
 * the verified catalog. A tracked token the catalog omits (a hand-added custom)
 * still appears, so nothing the user owns becomes unreachable.
 */
const dropdownGroups = (deps: SwapPickerDeps): readonly TokenDropdownGroup[] => {
  const tracked = trackedTokens(deps);
  const mine = tracked.map((token) => ({
    address: token.address,
    id: token.id,
    name: token.name,
    symbol: token.symbol,
  }));
  const rest = (catalog ?? [])
    .filter((entry) => !tracked.some((token) => sameFelt(token.address, entry.address)))
    .map((entry) => ({
      address: entry.address,
      // Untracked tokens have no wallet id yet; the address stands in and is
      // resolved to a tracked id when the pick is applied.
      id: `address:${entry.address}`,
      name: entry.name,
      symbol: entry.symbol,
    }));
  return [
    { label: "Your tokens", options: mine },
    { label: "More tokens", options: rest, search: true },
  ];
};

const panelId = (side: PickerSide): string => `swap-${side}-options`;

const fillPanels = (deps: SwapPickerDeps, root: Element): void => {
  const groups = dropdownGroups(deps);
  for (const side of SIDES) {
    const panel = root.querySelector<HTMLElement>(`#${panelId(side)}`);
    if (!panel) {
      continue;
    }
    const typed = panel.querySelector<HTMLInputElement>("[data-token-search]")?.value ?? "";
    panel.innerHTML = tokenDropdownOptions(groups, panelId(side));
    const search = panel.querySelector<HTMLInputElement>("[data-token-search]");
    if (search && typed) {
      search.value = typed;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
};

const addThenSelect = (
  deps: SwapPickerDeps,
  root: Element,
  side: PickerSide,
  address: string,
  onSelect: (side: PickerSide, tokenId: string) => void,
): void => {
  pendingAdd = { address, side };
  deps.wallet
    .addToken(address)
    .then(async () => {
      await deps.render(await deps.wallet.loadStatus());
      const added = trackedByAddress(deps, address);
      if (added && pendingAdd && sameFelt(pendingAdd.address, address)) {
        pendingAdd = null;
        onSelect(side, added.id);
      }
    })
    .catch((error: unknown) => {
      pendingAdd = null;
      showToast(errorDetails(error, "Could not add that token"), "error", root);
    });
};

/**
 * Binds both token dropdowns on the swap screen. `onSelect` receives the chosen
 * TRACKED token id for its side; an untracked catalog pick is added on-chain
 * first and delivered once the wallet tracks it.
 */
export const bindSwapTokenDropdowns = (
  deps: SwapPickerDeps,
  root: Element,
  onSelect: (side: PickerSide, tokenId: string) => void,
): void => {
  ensureCatalog(deps, root);
  fillPanels(deps, root);

  // Deliver a selection that was waiting on the add-token render.
  if (pendingAdd) {
    const tracked = trackedByAddress(deps, pendingAdd.address);
    if (tracked) {
      const { side } = pendingAdd;
      pendingAdd = null;
      onSelect(side, tracked.id);
    }
  }

  for (const side of SIDES) {
    bindTokenDropdown({
      onSelect: (optionId) => {
        const address = optionId.startsWith("address:") ? optionId.slice("address:".length) : null;
        if (!address) {
          onSelect(side, optionId);
          return;
        }
        const tracked = trackedByAddress(deps, address);
        if (tracked) {
          onSelect(side, tracked.id);
          return;
        }
        addThenSelect(deps, root, side, address, onSelect);
      },
      panelId: panelId(side),
      root: root.querySelector(`#swap-${side}-token`)?.closest(".token-dropdown") ?? null,
      triggerId: `swap-${side}-token`,
    });
  }
};
