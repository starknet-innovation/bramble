/**
 * The one place discovered-account rows are written into the DOM and their
 * selection is read back.
 *
 * Both surfaces that offer these accounts — setup and the accounts screen — use
 * this, so a discovered account is rendered, toggled, and counted identically on
 * each, and only one file writes string HTML for them. Every interpolation comes
 * from ./discovered-accounts-view, which escapes all dynamic text; the only values
 * this module adds are a fixed label and an integer index.
 *
 * Selection lives in each row's `aria-pressed` and is read back from the DOM, so
 * there is no second copy of it to fall out of step with what the user sees.
 */

import type { SeedScanCandidate } from "../popup/responses";
import { button } from "../ui/controls";
import { discoveredAccountList } from "./discovered-accounts-view";

/**
 * A rendered discovered-account list and its current selection.
 */
export type DiscoveredAccountsPanel = {
  /** Empties the list; its selection described a scan that is no longer current. */
  readonly clear: () => void;
  /** Renders `candidates`, preselecting every one not already in the wallet. */
  readonly render: (candidates: readonly SeedScanCandidate[]) => void;
  /** The HD positions currently selected, ascending. */
  readonly selected: () => readonly number[];
};

const SELECTED_ROWS = '[data-discovered-index][aria-pressed="true"]:not([disabled])';

/**
 * Creates the panel over a container element.
 *
 * `onToggle` fires after every selection change, for a caller whose submit control
 * is gated on the count. Supplying `confirm` renders a confirm button inside the
 * list and calls back with the chosen positions — the accounts screen needs one,
 * while setup already has the form's own submit.
 */
export const createDiscoveredAccountsPanel = (options: {
  readonly confirm?: { readonly label: string; readonly onConfirm: () => void };
  readonly container: HTMLElement | null;
  readonly onToggle?: () => void;
}): DiscoveredAccountsPanel => {
  const { confirm, container, onToggle } = options;

  const selected = (): readonly number[] =>
    Array.from(container?.querySelectorAll<HTMLButtonElement>(SELECTED_ROWS) ?? [])
      .flatMap((row) => {
        const index = Number(row.dataset["discoveredIndex"]);
        return Number.isSafeInteger(index) ? [index] : [];
      })
      .sort((left, right) => left - right);

  return {
    clear: () => {
      if (container) {
        container.dataset["discoveredState"] = "idle";
        container.replaceChildren();
      }
    },
    render: (candidates) => {
      if (!container) {
        return;
      }
      const addable = candidates.filter((candidate) => !candidate.alreadyAdded);
      container.dataset["discoveredState"] = candidates.length > 0 ? "found" : "empty";
      container.innerHTML = `${discoveredAccountList(
        candidates,
        new Set(addable.map((candidate) => candidate.accountIndex)),
      )}${
        confirm && addable.length > 0
          ? button({ attributes: { id: "discovered-confirm" }, label: confirm.label })
          : ""
      }`;
      for (const row of container.querySelectorAll<HTMLButtonElement>("[data-discovered-index]")) {
        row.addEventListener("click", () => {
          row.setAttribute("aria-pressed", String(row.getAttribute("aria-pressed") !== "true"));
          onToggle?.();
        });
      }
      container
        .querySelector<HTMLButtonElement>("#discovered-confirm")
        ?.addEventListener("click", () => confirm?.onConfirm());
      onToggle?.();
    },
    selected,
  };
};

/**
 * Renders a setup scan's result into `panel` and returns the copy that explains
 * it, for the caller to place. Returning the text rather than writing it keeps
 * this module's only DOM writes inside the panel it owns.
 *
 * Index 0 is dropped: setup shows it as its own "Primary account" row, and
 * listing it twice invites selecting one account and getting two.
 */
export const renderSetupScan = (
  panel: DiscoveredAccountsPanel,
  candidates: readonly SeedScanCandidate[],
): string => {
  const others = candidates.filter((candidate) => candidate.accountIndex > 0);
  panel.render(others);
  return others.length > 0
    ? "These accounts already exist on chain for this recovery phrase. Unselect any you do not want."
    : "";
};

/**
 * The copy shown when a setup scan could not reach the chain. Setup continues on
 * the primary account rather than blocking, so this names the way back.
 */
export const setupScanFailedMessage = (): string =>
  "Could not check for your other accounts. You can add them later from Accounts & groups.";
