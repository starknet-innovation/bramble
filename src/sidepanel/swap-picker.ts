/**
 * Token picker sheet for the swap flow: the full AVNU verified catalog for the
 * active network (not just tracked tokens), searchable by name, symbol, or
 * address, with quick chips for the majors. Selecting a token the wallet does
 * not track yet routes through the existing add-token path — which reads the
 * token's name/symbol/decimals from the CONTRACT on-chain — so the swap trust
 * boundary (tokens only ever resolve from the tracked registry) is preserved;
 * the catalog is a directory, never a source of truth. On networks without a
 * catalog (devnet, empty sepolia list) the sheet falls back to tracked tokens.
 *
 * Module state (open side, search text, cached catalog, pending add) survives
 * shell repaints; ./swap-ui.ts calls {@link bindSwapPicker} on every bind and
 * receives selections through its callback.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type { TokenConfig, WalletPreferences } from "../storage/preferences-store";
import { errorMessage, showToast } from "./dom";
import { icon } from "./icons";
import { accountLabel } from "./parts";
import type { BalanceState, SidepanelWallet } from "./runtime";
import type { SwapCatalogTokenView, SwapClient } from "./swap-client";
import { compactAmount, tokenGlyph } from "./token-row";

/**
 * State accessors and services the picker closes over — a structural subset of
 * the swap screen's deps (kept separate so the modules stay cycle-free).
 */
export type SwapPickerDeps = {
  readonly balances: () => BalanceState;
  readonly preferences: () => WalletPreferences | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly status: () => WalletStatus;
  readonly swap: SwapClient;
  readonly wallet: SidepanelWallet;
};

const QUICK_CHIP_SYMBOLS = ["ETH", "STRK", "USDC"];

type PickerSide = "buy" | "sell";

let picking: PickerSide | null = null;
let searchText = "";
let catalog: readonly SwapCatalogTokenView[] | null = null;
let catalogNetworkId: string | null = null;
let catalogLoading = false;
let catalogError: string | null = null;
// A selected token that first needs tracking; resolved to a token id on the
// bind that follows the add-token render.
let pendingAdd: { readonly address: string; readonly side: PickerSide } | null = null;

/**
 * Which side the sheet is currently picking for, or null when closed.
 */
export const pickerSide = (): PickerSide | null => picking;

/**
 * Opens the sheet for one side (fetching the catalog on first use) or closes
 * it. Search resets on open so every pick starts from the full list.
 */
export const setPickerSide = (side: PickerSide | null): void => {
  picking = side;
  searchText = "";
};

const isAddressText = (value: string): boolean => /^0x[0-9a-fA-F]{3,64}$/.test(value.trim());

const trackedByAddress = (deps: SwapPickerDeps, address: string): TokenConfig | undefined =>
  (deps.preferences()?.tokens ?? []).find(
    (token) => token.networkId === deps.status().networkId && sameFelt(token.address, address),
  );

const ensureCatalog = (deps: SwapPickerDeps, repaint: () => void): void => {
  const networkId = deps.status().networkId;
  if (catalogNetworkId !== networkId) {
    catalog = null;
    catalogError = null;
    catalogNetworkId = networkId;
  }
  if (catalog !== null || catalogLoading) {
    return;
  }
  catalogLoading = true;
  deps.swap.tokens().then(
    (tokens) => {
      catalogLoading = false;
      catalog = tokens;
      repaint();
    },
    (error: unknown) => {
      catalogLoading = false;
      catalog = [];
      catalogError = errorMessage(error, "Token list unavailable");
      repaint();
    },
  );
};

// The sheet's entries: the verified catalog merged with tracked tokens (so a
// custom token the user added by hand is still findable), tracked-first when
// the catalog is empty.
const pickerEntries = (deps: SwapPickerDeps): readonly SwapCatalogTokenView[] => {
  const tracked = (deps.preferences()?.tokens ?? []).filter(
    (token) => token.networkId === deps.status().networkId,
  );
  const fromCatalog = catalog ?? [];
  const extras = tracked
    .filter((token) => !fromCatalog.some((entry) => sameFelt(entry.address, token.address)))
    .map((token) => ({
      address: token.address,
      decimals: token.decimals,
      name: token.name,
      symbol: token.symbol,
    }));
  return [...fromCatalog, ...extras];
};

const filteredEntries = (deps: SwapPickerDeps): readonly SwapCatalogTokenView[] => {
  const entries = pickerEntries(deps);
  const query = searchText.trim().toLowerCase();
  if (query.length === 0) {
    return entries;
  }
  if (isAddressText(query)) {
    return entries.filter(
      (entry) => sameFelt(entry.address, query) || entry.address.startsWith(query),
    );
  }
  return entries.filter(
    (entry) =>
      entry.symbol.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query),
  );
};

const entryRow = (deps: SwapPickerDeps, entry: SwapCatalogTokenView): string => {
  const tracked = trackedByAddress(deps, entry.address);
  const state = deps.balances();
  const balance =
    tracked && !("error" in state)
      ? (state.balances.find((item) => item.id === tracked.id) ?? null)
      : null;
  return `<button class="option-row" role="option" type="button" data-swap-pick-address="${escapeHtml(entry.address)}">
      ${tokenGlyph(entry.address, entry.symbol)}
      <span class="option-copy">
        <strong>${escapeHtml(entry.name)} <span class="swap-verified">${icon("check")}</span></strong>
        <span class="option-sub">${escapeHtml(entry.symbol)}</span>
      </span>
      <span class="menu-value">${balance ? escapeHtml(compactAmount(balance.formatted)) : ""}</span>
    </button>`;
};

// Renders the sheet from module state: title, chips for the majors, the
// filtered list, and an add-by-address fallback when the search is a valid
// address with no catalog hit.
const applyPickerUi = (deps: SwapPickerDeps, root: Element): void => {
  const sheet = root.querySelector<HTMLElement>("#swap-picker");
  if (!sheet) {
    return;
  }
  sheet.hidden = picking === null;
  if (picking === null) {
    return;
  }
  const title = sheet.querySelector("#swap-picker-title");
  if (title) {
    title.textContent = picking === "sell" ? "Pay with" : "Receive";
  }
  const search = sheet.querySelector<HTMLInputElement>("#swap-picker-search");
  if (search && search.value !== searchText && search.ownerDocument.activeElement !== search) {
    search.value = searchText;
  }
  const entries = filteredEntries(deps);
  const chips = sheet.querySelector("#swap-picker-chips");
  if (chips) {
    chips.innerHTML = QUICK_CHIP_SYMBOLS.map((symbol) => {
      const entry = pickerEntries(deps).find((candidate) => candidate.symbol === symbol);
      return entry
        ? `<button class="swap-chip" type="button" data-swap-pick-address="${escapeHtml(entry.address)}">${tokenGlyph(entry.address, entry.symbol)}${escapeHtml(entry.symbol)}</button>`
        : "";
    }).join("");
  }
  const list = sheet.querySelector("#swap-picker-list");
  if (list) {
    const addFallback =
      entries.length === 0 && isAddressText(searchText)
        ? `<button class="option-row" role="option" type="button" data-swap-pick-address="${escapeHtml(searchText.trim().toLowerCase())}">
            <span class="option-copy">
              <strong>Use this address</strong>
              <span class="option-sub"><code>${escapeHtml(accountLabel(searchText.trim()))}</code></span>
            </span>
            <span class="menu-value">Adds the token</span>
          </button>`
        : "";
    list.innerHTML = entries.map((entry) => entryRow(deps, entry)).join("") + addFallback;
  }
  const status = sheet.querySelector<HTMLElement>("#swap-picker-status");
  if (status) {
    const message = catalogLoading
      ? "Loading verified tokens…"
      : (catalogError ??
        (entries.length === 0 && !isAddressText(searchText) ? "No tokens match that search." : ""));
    status.textContent = message;
    status.hidden = message.length === 0;
  }
};

/**
 * Repaints the sheet from module state without (re)attaching listeners — the
 * chip-toggle path uses this so listeners bind exactly once per render.
 */
export const repaintSwapPicker = (deps: SwapPickerDeps, root: Element): void => {
  if (picking !== null) {
    ensureCatalog(deps, () => applyPickerUi(deps, root));
  }
  applyPickerUi(deps, root);
};

/**
 * Binds the picker sheet and repaints it from module state. `onSelect`
 * receives the chosen TRACKED token id for the side being picked; untracked
 * catalog picks are added on-chain first (via the wallet's add-token flow)
 * and delivered on the bind that follows the resulting re-render.
 */
export const bindSwapPicker = (
  deps: SwapPickerDeps,
  root: Element,
  onSelect: (side: PickerSide, tokenId: string) => void,
): void => {
  repaintSwapPicker(deps, root);
  // Deliver a selection that was waiting on the add-token render.
  if (pendingAdd) {
    const tracked = trackedByAddress(deps, pendingAdd.address);
    if (tracked) {
      const { side } = pendingAdd;
      pendingAdd = null;
      onSelect(side, tracked.id);
    }
  }

  root.querySelector("#swap-picker-close")?.addEventListener("click", () => {
    setPickerSide(null);
    applyPickerUi(deps, root);
  });
  root
    .querySelector<HTMLInputElement>("#swap-picker-search")
    ?.addEventListener("input", (event) => {
      searchText = (event.target as HTMLInputElement).value;
      applyPickerUi(deps, root);
    });
  root.querySelector("#swap-picker")?.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-swap-pick-address]");
    const address = row?.dataset["swapPickAddress"];
    const side = picking;
    if (!address || !side) {
      return;
    }
    const tracked = trackedByAddress(deps, address);
    setPickerSide(null);
    applyPickerUi(deps, root);
    if (tracked) {
      onSelect(side, tracked.id);
      return;
    }
    // Untracked pick: add it through the on-chain-validated token flow, then
    // deliver the selection from the refreshed preferences. Delivery happens
    // right here — a content-identical repaint can skip re-binding, so the
    // bind-time pendingAdd path below is only a fallback.
    pendingAdd = { address, side };
    setResultText(root, "Adding token…");
    deps.wallet
      .addToken(address)
      .then(async () => {
        await deps.render(await deps.wallet.loadStatus());
        const added = trackedByAddress(deps, address);
        if (added && pendingAdd && sameFelt(pendingAdd.address, address)) {
          const target = pendingAdd.side;
          pendingAdd = null;
          onSelect(target, added.id);
        }
      })
      .catch((error: unknown) => {
        pendingAdd = null;
        showToast(errorMessage(error, "Could not add that token"), "error");
        setResultText(root, errorMessage(error, "Could not add that token"));
        applyPickerUi(deps, root);
      });
  });
};

const setResultText = (root: Element, text: string): void => {
  const node = root.querySelector("#swap-result");
  if (node) {
    node.textContent = text;
  }
};
