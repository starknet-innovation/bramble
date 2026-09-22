/**
 * The wallet's one token picker: a dropdown anchored under its trigger, listing
 * tickers in labelled groups.
 *
 * Send and Swap each used to leave the screen to choose a token — Send pushed a
 * whole stage, Swap opened a modal sheet — and the two lists drifted apart. This
 * renders the same list, the same way, in place: the caller supplies the groups
 * and owns the trigger, this owns the panel, its keyboard model, and what a
 * selection means.
 *
 * Pure markup plus a binding over it; no wallet access and no module state, so
 * two dropdowns (Swap's pay and receive sides) can live on one screen.
 */

import { escapeHtml } from "@bramble/core/html";
import { inputControl } from "@bramble/ui-kit/fields";
import { tokenGlyph } from "../journeys/portfolio/token-row";
import { rankTokenQueryMatch } from "./token-search";

/** One selectable token: the id the caller acts on, and what a user sees. */
type TokenDropdownOption = {
  readonly address: string;
  /** Returned to the caller on selection; unique within the dropdown. */
  readonly id: string;
  /** Display name. Search matches it; a missing name matches on the symbol. */
  readonly name?: string;
  readonly symbol: string;
};

/** A labelled run of options, rendered in the order given. */
export type TokenDropdownGroup = {
  readonly label: string;
  readonly options: readonly TokenDropdownOption[];
  /**
   * Gives this group a search field between its label and its first option.
   * Set it on a long group (a catalog); a handful of held tokens is faster to
   * read than to search.
   */
  readonly search?: boolean;
};

const optionRow = (
  option: TokenDropdownOption,
  selectedId: string | null,
  order: number,
): string => `
  <button class="token-dropdown-option" type="button" role="option"
    aria-selected="${String(option.id === selectedId)}"
    data-token-option="${escapeHtml(option.id)}"
    data-token-symbol="${escapeHtml(option.symbol)}"
    data-token-name="${escapeHtml(option.name ?? "")}"
    data-token-address="${escapeHtml(option.address)}"
    data-token-order="${String(order)}">
    ${tokenGlyph(option.address, option.symbol)}
    <strong>${escapeHtml(option.symbol)}</strong>
  </button>`;

const searchField = (label: string): string =>
  inputControl({
    ariaLabel: `Search ${label.toLowerCase()}`,
    attributes: { "data-token-search": "" },
    autocomplete: "off",
    className: "token-dropdown-search",
    placeholder: "Search",
    spellcheck: false,
    type: "search",
  });

// Each group owns its own listbox, labelled by its heading: a search field
// between the two would otherwise sit inside a listbox, where only options and
// groups belong.
const groupMarkup = (
  group: TokenDropdownGroup,
  index: number,
  panelId: string,
  selectedId: string | null,
): string => {
  const labelId = `${panelId}-group-${index}`;
  return `
  <div class="token-dropdown-group">
    <p class="eyebrow token-dropdown-label" id="${escapeHtml(labelId)}">${escapeHtml(group.label)}</p>
    ${group.search ? searchField(group.label) : ""}
    <div class="token-dropdown-options" role="listbox" aria-labelledby="${escapeHtml(labelId)}">
      ${group.options.map((option, index) => optionRow(option, selectedId, index)).join("")}
    </div>
    ${group.search ? '<p class="token-dropdown-empty" data-token-search-empty hidden>No token matches that search.</p>' : ""}
  </div>`;
};

/**
 * Renders the dropdown panel. It is placed next to its trigger inside a
 * positioned wrapper by the caller's markup, starts hidden, and shows only
 * groups that hold options, so an empty group never prints a bare heading.
 *
 * `action` adds one row under the groups — a way out of the dropdown for a
 * token it does not list. It is not an option: search never hides it, the
 * arrow keys do not walk onto it, and it reports through `onAction`.
 */
export const tokenDropdownOptions = (
  groups: readonly TokenDropdownGroup[],
  panelId: string,
  selectedId: string | null = null,
  action: string | null = null,
): string => {
  const filled = groups.filter((group) => group.options.length > 0);
  const body =
    filled.length === 0
      ? '<p class="token-dropdown-empty">No tokens available.</p>'
      : filled.map((group, index) => groupMarkup(group, index, panelId, selectedId)).join("");
  return action === null
    ? body
    : `${body}<button class="token-dropdown-action" type="button" data-token-action>${escapeHtml(action)}</button>`;
};

/**
 * Renders an empty panel for a caller that fills it later — Swap, whose
 * catalog arrives after the first paint. The panel keeps its identity across
 * repaints, so the binding can attach to it before any option exists.
 */
export const tokenDropdownShell = (panelId: string, label: string): string => `
  <div class="token-dropdown-panel" id="${escapeHtml(panelId)}"
    aria-label="${escapeHtml(label)}" hidden></div>`;

/**
 * Renders the dropdown panel with its options. It is placed next to its trigger
 * inside a positioned wrapper by the caller's markup, starts hidden, and shows
 * only groups that hold options, so an empty group never prints a bare heading.
 */
export const tokenDropdown = ({
  action = null,
  groups,
  label,
  panelId,
  selectedId = null,
}: {
  /** Label of the row under the groups, e.g. "Manage tokens"; none by default. */
  readonly action?: string | null;
  readonly groups: readonly TokenDropdownGroup[];
  /** Accessible name of the list, e.g. "Tokens you can send". */
  readonly label: string;
  readonly panelId: string;
  readonly selectedId?: string | null;
}): string => `
  <div class="token-dropdown-panel" id="${escapeHtml(panelId)}"
    aria-label="${escapeHtml(label)}" hidden>
    ${tokenDropdownOptions(groups, panelId, selectedId, action)}
  </div>`;

/**
 * Collaborators for one bound dropdown.
 */
export type TokenDropdownDeps = {
  /** The positioned wrapper holding both the trigger and the panel. */
  readonly root: Element | null;
  /** Runs when the action row is pressed, after the panel closes. */
  readonly onAction?: () => void;
  readonly onSelect: (optionId: string) => void;
  readonly panelId: string;
  readonly triggerId: string;
};

// The outside-click listener each bound dropdown keeps on its document, by
// panel id. A caller that rebuilds its screen on every paint (Swap) binds again
// each time; without this the listeners of every panel it threw away would pile
// up on the document for the life of the page.
const outsideClickListeners = new WeakMap<Document, Map<string, (event: Event) => void>>();

const options = (panel: Element): readonly HTMLButtonElement[] =>
  [...panel.querySelectorAll<HTMLButtonElement>("[data-token-option]")].filter(
    (option) => !option.hasAttribute("hidden"),
  );

// Address-only hits sort after every symbol or name hit. Ties keep catalog order.
const ADDRESS_MATCH_RANK = 4;

const matchRank = (option: HTMLElement, query: string): number | null => {
  if (query.length === 0) {
    return 0;
  }
  const symbol = option.dataset["tokenSymbol"] ?? "";
  const name = option.dataset["tokenName"] ?? "";
  const ranked = rankTokenQueryMatch({ name, symbol }, query);
  if (ranked !== null) {
    return ranked;
  }
  const address = (option.dataset["tokenAddress"] ?? "").toLowerCase();
  return address.includes(query) ? ADDRESS_MATCH_RANK : null;
};

// Filters one group's options against its own field, ranked so the best match
// leads, and says so when nothing matches rather than showing an empty group.
const filterGroup = (search: HTMLInputElement): void => {
  const group = search.closest(".token-dropdown-group");
  const list = group?.querySelector<HTMLElement>(".token-dropdown-options");
  const query = search.value.trim().toLowerCase();
  const ranked = [...(list?.querySelectorAll<HTMLElement>("[data-token-option]") ?? [])].map(
    (option, index) => ({
      option,
      order: Number(option.dataset["tokenOrder"] ?? index),
      rank: matchRank(option, query),
    }),
  );
  ranked.sort((left, right) => {
    if (query.length === 0) {
      return left.order - right.order;
    }
    const byRank = (left.rank ?? ADDRESS_MATCH_RANK + 1) - (right.rank ?? ADDRESS_MATCH_RANK + 1);
    return byRank !== 0 ? byRank : left.order - right.order;
  });
  let shown = 0;
  for (const row of ranked) {
    const matches = row.rank !== null;
    row.option.toggleAttribute("hidden", !matches);
    if (matches) shown += 1;
    list?.append(row.option);
  }
  group?.querySelector("[data-token-search-empty]")?.toggleAttribute("hidden", shown > 0);
};

const moveFocus = (panel: Element, from: Element | null, step: number): void => {
  const all = options(panel);
  if (all.length === 0) {
    return;
  }
  const index = from instanceof HTMLButtonElement ? all.indexOf(from) : -1;
  const next = index < 0 ? 0 : (index + step + all.length) % all.length;
  all[next]?.focus();
};

/**
 * Binds one dropdown: the trigger opens and closes it, Escape and a click
 * outside close it, the arrow keys walk the options, and choosing one closes
 * the panel and returns focus to the trigger before the caller acts on it —
 * so focus never lands on a control that the selection removes.
 */
export const bindTokenDropdown = (deps: TokenDropdownDeps): void => {
  const root = deps.root;
  const panel = root?.querySelector<HTMLElement>(`#${deps.panelId}`);
  const trigger = root?.querySelector<HTMLButtonElement>(`#${deps.triggerId}`);
  if (!panel || !trigger || !root || panel.dataset["dropdownBound"] === "true") {
    return;
  }
  panel.dataset["dropdownBound"] = "true";

  const setOpen = (open: boolean): void => {
    panel.toggleAttribute("hidden", !open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      const search = panel.querySelector<HTMLInputElement>("[data-token-search]");
      if (search) {
        search.focus();
      } else {
        options(panel)[0]?.focus();
      }
    }
  };
  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) {
      trigger.focus();
    }
  };

  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-controls", deps.panelId);
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", () => {
    setOpen(panel.hasAttribute("hidden"));
  });

  panel.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("[data-token-action]")) {
      close(false);
      deps.onAction?.();
      return;
    }
    const option = (event.target as Element | null)?.closest<HTMLElement>("[data-token-option]");
    const id = option?.dataset["tokenOption"];
    if (!id) {
      return;
    }
    close(true);
    deps.onSelect(id);
  });

  panel.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveFocus(panel, panel.ownerDocument.activeElement, key === "ArrowDown" ? 1 : -1);
    }
  });

  // Delegated, because a caller may refill this panel after binding (Swap does,
  // when its catalog arrives) — a listener on the field itself dies with it,
  // which is exactly how typing stopped filtering.
  panel.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLInputElement && field.hasAttribute("data-token-search")) {
      filterGroup(field);
    }
  });

  // A click anywhere else dismisses it. Listening on the document covers the
  // rest of the panel surface, which a blur handler would miss while focus
  // moves between the options themselves. The listener of a previous binding
  // for this panel id is dropped first, and a listener whose panel has left the
  // document removes itself, so a rebuilt screen never accumulates them.
  const ownerDocument = panel.ownerDocument;
  const listeners = outsideClickListeners.get(ownerDocument) ?? new Map();
  outsideClickListeners.set(ownerDocument, listeners);
  const previous = listeners.get(deps.panelId);
  if (previous) {
    ownerDocument.removeEventListener("click", previous);
  }
  const onOutsideClick = (event: Event): void => {
    if (!panel.isConnected) {
      ownerDocument.removeEventListener("click", onOutsideClick);
      if (listeners.get(deps.panelId) === onOutsideClick) {
        listeners.delete(deps.panelId);
      }
      return;
    }
    const target = event.target as Node | null;
    if (!panel.hasAttribute("hidden") && target && !root.contains(target)) {
      close(false);
    }
  };
  listeners.set(deps.panelId, onOutsideClick);
  ownerDocument.addEventListener("click", onOutsideClick);
};
