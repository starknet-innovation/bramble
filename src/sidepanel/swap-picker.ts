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

/**
 * Ranks how well a catalog entry matches a text query: exact symbol first,
 * then symbol prefix, name prefix, and finally substring hits — null when it
 * does not match. Ties keep the catalog's volume order, so "usdc" surfaces
 * USDC before Bridged USDC before the long tail.
 */
export const rankTokenQueryMatch = (
  entry: { readonly name: string; readonly symbol: string },
  query: string,
): number | null => {
  const symbol = entry.symbol.toLowerCase();
  const name = entry.name.toLowerCase();
  if (symbol === query) {
    return 0;
  }
  if (symbol.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (symbol.includes(query) || name.includes(query)) {
    return 3;
  }
  return null;
};

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

type PickerEntry = SwapCatalogTokenView & {
  readonly balanceText: string | null;
  readonly tracked: boolean;
};

// The sheet's entries in the catalog's volume order (majors first), each
// annotated with whether the wallet already tracks it and its balance —
// tracked tokens the catalog misses (hand-added customs) are appended so
// everything the user owns stays findable, and networks without a catalog
// fall back to the tracked list alone.
const pickerEntries = (deps: SwapPickerDeps): readonly PickerEntry[] => {
  const tracked = (deps.preferences()?.tokens ?? []).filter(
    (token) => token.networkId === deps.status().networkId,
  );
  const state = deps.balances();
  const annotate = (entry: SwapCatalogTokenView): PickerEntry => {
    const match = tracked.find((token) => sameFelt(token.address, entry.address));
    const balance =
      match && !("error" in state)
        ? (state.balances.find((item) => item.id === match.id) ?? null)
        : null;
    return {
      ...entry,
      balanceText: balance ? compactAmount(balance.formatted) : null,
      tracked: match !== undefined,
    };
  };
  const fromCatalog = (catalog ?? []).map(annotate);
  const extras = tracked
    .filter((token) => !fromCatalog.some((entry) => sameFelt(entry.address, token.address)))
    .map((token) =>
      annotate({
        address: token.address,
        decimals: token.decimals,
        name: token.name,
        symbol: token.symbol,
      }),
    );
  return [...fromCatalog, ...extras];
};

const filteredEntries = (deps: SwapPickerDeps): readonly PickerEntry[] => {
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
  return entries
    .map((entry, index) => ({ entry, index, rank: rankTokenQueryMatch(entry, query) }))
    .filter(
      (item): item is { entry: PickerEntry; index: number; rank: number } => item.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.entry);
};

// One catalog row. The sub-line pairs the symbol with the truncated contract
// address — the definitive disambiguator when one brand ships twice (native
// USDC vs the StarkGate-bridged USDC.e share a mark but never an address).
const entryRow = (
  entry: PickerEntry,
): string => `<button class="option-row" role="option" type="button" data-swap-pick-address="${escapeHtml(entry.address)}">
      ${tokenGlyph(entry.address, entry.symbol)}
      <span class="option-copy">
        <strong>${escapeHtml(entry.name)} <span class="swap-verified">${icon("check")}</span></strong>
        <span class="option-sub">${escapeHtml(entry.symbol)} · <code>${escapeHtml(accountLabel(entry.address))}</code></span>
      </span>
      <span class="menu-value">${entry.balanceText ? escapeHtml(entry.balanceText) : ""}</span>
    </button>`;

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
    const group = (rows: string): string => `<div class="swap-sheet-group">${rows}</div>`;
    const searching = searchText.trim().length > 0;
    const mine = entries.filter((entry) => entry.tracked);
    const rest = entries.filter((entry) => !entry.tracked);
    // Resting order communicates structure: what you hold first, then the
    // whole verified catalog in volume order. A search flattens to one ranked
    // list so the best match is always the first row.
    list.innerHTML =
      searching || mine.length === 0 || rest.length === 0
        ? group(entries.map(entryRow).join("") + addFallback)
        : `<p class="eyebrow swap-sheet-label">Your tokens</p>${group(mine.map(entryRow).join(""))}
           <p class="eyebrow swap-sheet-label">All tokens</p>${group(rest.map(entryRow).join(""))}`;
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
