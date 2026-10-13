/**
 * Bindings for the avnu catalog screen: fetch the verified list for the active
 * network, search it, and act on one entry.
 *
 * The catalog is a directory. Adding an entry calls the same `wallet.addToken`
 * path as "Add by contract", which reads the token's facts from the contract on
 * chain, so nothing this list claims is stored on its word. Hiding and showing
 * act on the wallet's own tracked registry, never on the catalog.
 *
 * Module state (the fetched catalog and the search text) survives shell
 * repaints, so a repaint after adding a token neither refetches the list nor
 * clears what was typed.
 */

import { escapeHtml } from "@bramble/core/html";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorMessage, showToast } from "../../shared/dom";
import { rankTokenQueryMatch } from "../../shared/token-search";
import type { SwapCatalogTokenView } from "../swap/swap-client";
import { CATALOG_EMPTY_TEXT, CATALOG_LOADING_TEXT } from "./token-catalog-view";
import { tokenGlyph } from "./token-row";

/**
 * State accessors and services the catalog screen closes over.
 */
export type TokenCatalogUiDeps = {
  readonly app: Element | null;
  /** Reads the verified catalog for the active network (the swap client's own call). */
  readonly catalog: () => Promise<readonly SwapCatalogTokenView[]>;
  readonly preferences: () => WalletPreferences | null;
  readonly refresh: () => Promise<WalletStatus>;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly status: () => WalletStatus;
  readonly wallet: Pick<SidepanelWallet, "addToken" | "setTokenHidden">;
};

let catalog: readonly SwapCatalogTokenView[] | null = null;
let catalogNetworkId: string | null = null;
let catalogLoading = false;
let catalogError: string | null = null;
let searchText = "";
// The fetch in flight, and the paint of whichever screen is live when it lands.
let catalogRequest = 0;
let repaintLatest: (() => void) | null = null;

/**
 * Clears the panel-local catalog and search between isolated tests. Production
 * code keeps both so a repaint neither refetches nor clears what was typed.
 */
export const resetTokenCatalogForTests = (): void => {
  catalog = null;
  catalogNetworkId = null;
  catalogLoading = false;
  catalogError = null;
  searchText = "";
  repaintLatest = null;
};

/**
 * Drops the cached list when the active network changes. A fetch still in
 * flight belonged to the old network: it is no longer "loading" this one, and
 * its answer is discarded when it lands.
 */
const resetForNetwork = (networkId: string): void => {
  if (catalogNetworkId !== networkId) {
    catalog = null;
    catalogError = null;
    catalogLoading = false;
    catalogNetworkId = networkId;
  }
};

const ensureCatalog = (deps: TokenCatalogUiDeps, repaint: () => void): void => {
  const networkId = deps.status().networkId;
  resetForNetwork(networkId);
  // Always the live screen's paint. A shell refresh while the list is loading
  // rebuilds the results element, and the paint captured by the first bind
  // would write into the one that was thrown away.
  repaintLatest = repaint;
  if (catalog !== null || catalogLoading) {
    return;
  }
  catalogLoading = true;
  const request = ++catalogRequest;
  const settle = (tokens: readonly SwapCatalogTokenView[], error: string | null): void => {
    // A later fetch, or a network switch, has already replaced this request;
    // pinning its list here would show another network's tokens.
    if (request !== catalogRequest || catalogNetworkId !== networkId) {
      return;
    }
    catalogLoading = false;
    catalog = tokens;
    catalogError = error;
    repaintLatest?.();
  };
  deps.catalog().then(
    (tokens) => settle(tokens, null),
    (error: unknown) => settle([], errorMessage(error, "Token list unavailable")),
  );
};

const trackedToken = (deps: TokenCatalogUiDeps, address: string): TokenConfig | undefined =>
  (deps.preferences()?.tokens ?? []).find(
    (token) => token.networkId === deps.status().networkId && sameFelt(token.address, address),
  );

// The button reflects exactly what it controls: the user's own hidden list. The
// spam heuristic can also keep a token off Home, but nothing here toggles it, so
// it must not decide this label.
const isUserHidden = (deps: TokenCatalogUiDeps, token: TokenConfig): boolean =>
  (deps.preferences()?.hiddenTokens ?? []).includes(token.id);

const matchesQuery = (entry: SwapCatalogTokenView, query: string): boolean =>
  query.length === 0 ||
  rankTokenQueryMatch(entry, query) !== null ||
  entry.address.toLowerCase().includes(query);

const rankedEntries = (
  entries: readonly SwapCatalogTokenView[],
  query: string,
): readonly SwapCatalogTokenView[] => {
  const matching = entries.filter((entry) => matchesQuery(entry, query));
  if (query.length === 0) {
    return matching;
  }
  // Ties keep the catalog's own order, which avnu returns by volume.
  return [...matching].sort(
    (left, right) =>
      (rankTokenQueryMatch(left, query) ?? 4) - (rankTokenQueryMatch(right, query) ?? 4),
  );
};

const entryAction = (deps: TokenCatalogUiDeps, entry: SwapCatalogTokenView): string => {
  const tracked = trackedToken(deps, entry.address);
  if (!tracked) {
    return button({
      attributes: { "data-catalog-add": entry.address },
      label: "Add",
      size: "small",
      variant: "secondary",
    });
  }
  const hidden = isUserHidden(deps, tracked);
  return button({
    attributes: {
      "data-catalog-hidden": String(hidden),
      "data-catalog-toggle": tracked.id,
    },
    label: hidden ? "Show" : "Hide",
    size: "small",
    variant: "secondary",
  });
};

const entryRow = (deps: TokenCatalogUiDeps, entry: SwapCatalogTokenView): string => `
  <li class="token-row">
    ${tokenGlyph(entry.address, entry.symbol)}
    <div class="token-copy">
      <strong>${escapeHtml(entry.symbol)}</strong>
      <p>${escapeHtml(entry.name)}</p>
    </div>
    ${entryAction(deps, entry)}
  </li>`;

const statusText = (shown: number, total: number): string => {
  if (catalogLoading && catalog === null) {
    return CATALOG_LOADING_TEXT;
  }
  if (catalogError) {
    return catalogError;
  }
  if (total === 0) {
    return CATALOG_EMPTY_TEXT;
  }
  return shown === total
    ? `${total} token${total === 1 ? "" : "s"} verified by avnu.`
    : `${shown} of ${total} shown.`;
};

const rerender = async (deps: TokenCatalogUiDeps): Promise<void> => {
  await deps.render(await deps.refresh());
};

const bindAdd = (deps: TokenCatalogUiDeps, container: Element): void => {
  container.querySelectorAll<HTMLButtonElement>("[data-catalog-add]").forEach((control) => {
    control.addEventListener("click", () => {
      const address = control.dataset["catalogAdd"];
      if (!address) {
        return;
      }
      buttonBusy(control, true);
      void deps.wallet.addToken(address).then(
        async () => {
          showToast("Token added", "success", control);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Add token failed"), "error", control);
          buttonBusy(control, false);
        },
      );
    });
  });
};

const bindToggle = (deps: TokenCatalogUiDeps, container: Element): void => {
  container.querySelectorAll<HTMLButtonElement>("[data-catalog-toggle]").forEach((control) => {
    control.addEventListener("click", () => {
      const tokenId = control.dataset["catalogToggle"];
      if (!tokenId) {
        return;
      }
      const hidden = control.dataset["catalogHidden"] === "true";
      buttonBusy(control, true);
      void deps.wallet.setTokenHidden(tokenId, !hidden).then(
        async () => {
          showToast(hidden ? "Token shown" : "Token hidden", "success", control);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Token update failed"), "error", control);
          buttonBusy(control, false);
        },
      );
    });
  });
};

/**
 * Binds the avnu catalog screen when the current render shows it. Returns
 * without side effects on every other screen, so the list is fetched only once
 * a user opens it.
 */
export const bindTokenCatalog = (deps: TokenCatalogUiDeps): void => {
  const results = deps.app?.querySelector("#token-catalog-results");
  const status = deps.app?.querySelector<HTMLElement>("#token-catalog-result");
  const search = deps.app?.querySelector<HTMLInputElement>("#token-catalog-search");
  if (!results) {
    return;
  }

  const paint = (): void => {
    const entries = catalog ?? [];
    const shown = rankedEntries(entries, searchText.trim().toLowerCase());
    // No entries at all means the list is loading or failed; the status line
    // says which, so the results region stays empty rather than reporting a
    // search that matched nothing.
    results.innerHTML =
      shown.length === 0
        ? entries.length === 0
          ? ""
          : emptyState("No token matches that search.")
        : `<ul class="token-list">${shown.map((entry) => entryRow(deps, entry)).join("")}</ul>`;
    bindAdd(deps, results);
    bindToggle(deps, results);
    if (status) {
      status.textContent = statusText(shown.length, entries.length);
    }
  };

  if (search) {
    search.value = searchText;
    search.addEventListener("input", () => {
      searchText = search.value;
      paint();
    });
  }
  ensureCatalog(deps, paint);
  paint();
};
