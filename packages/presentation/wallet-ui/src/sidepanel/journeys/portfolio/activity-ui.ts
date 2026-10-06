/**
 * Activity refresh, CSV-export and feed-filter bindings. Export always labels
 * degraded history honestly so local-only records are never mistaken for a
 * complete on-chain account history. The filter, sort and search controls write
 * only the ephemeral view state; the filter and the search are applied to the
 * rendered rows, while the sort changes the feed's shape and asks the shell for
 * a local repaint of the data it already holds.
 */

import { activityToCsv } from "@bramble/transactions/activity";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast, type ToastTone } from "../../shared/dom";
import {
  activityPartySummary,
  activityPartySummaryParts,
  activityRowFacts,
  activityRowMatches,
  activitySummaryRow,
} from "./activity-filter";
import { activityViewState, setActivityViewState } from "./activity-view-state";

/**
 * Dependencies used by the activity controls. All wallet reads stay behind the
 * permissioned runtime client and failures surface without mutating local data.
 * `render` is the shell's status-driven repaint (the refresh button needs a
 * fresh read); `repaint` re-renders the current screen from the data the shell
 * already holds, so changing the sort never waits on the wallet.
 */
export type ActivityUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly repaint: () => void;
  readonly wallet: SidepanelWallet;
};

/**
 * Chooses the toast for a completed CSV export. A degraded export explicitly
 * names its device-only scope; a complete feed reads as plain success.
 */
export const activityExportToast = (
  historyUnavailable: boolean,
): { readonly message: string; readonly tone: ToastTone } =>
  historyUnavailable
    ? {
        message: "Exported this device's records only — on-chain history was unavailable.",
        tone: "error",
      }
    : { message: "Activity exported", tone: "success" };

// The search box keeps its caret across a repaint (a background refresh rebuilds
// the screen string). Set while the field has focus, cleared on a real blur, so a
// repaint does not steal focus back after the user has moved on.
let searchCaret: number | null = null;

const datasetOf = (element: HTMLElement): Readonly<Record<string, string | undefined>> =>
  element.dataset;

/**
 * Applies the view state to the rendered feed: toggles each row, drops a day
 * heading whose rows are all hidden, reports the visible count, and shows the
 * per-counterparty summary when the search resolves one party. Reads the state
 * module rather than the controls, so a control that the DOM has not yet
 * reflected cannot desynchronise the feed.
 */
const applyActivityView = (app: Element | null): void => {
  const feed = app?.querySelector<HTMLElement>("#activity-feed");
  if (!app || !feed) return;
  const filter = activityViewState();
  const query = filter.query.trim().toLowerCase();
  const rows = [...feed.querySelectorAll<HTMLElement>("li.tx-row")];
  const visible: HTMLElement[] = [];
  for (const row of rows) {
    const matches = activityRowMatches(activityRowFacts(datasetOf(row)), filter);
    row.toggleAttribute("hidden", !matches);
    if (matches) visible.push(row);
  }
  for (const day of feed.querySelectorAll<HTMLElement>(".tx-day")) {
    const shown = [...day.querySelectorAll<HTMLElement>("li.tx-row")].some(
      (row) => !row.hasAttribute("hidden"),
    );
    day.toggleAttribute("hidden", !shown);
  }
  app
    .querySelector("#activity-no-matches")
    ?.toggleAttribute("hidden", !(rows.length > 0 && visible.length === 0));
  const filtered =
    query.length > 0 ||
    filter.action !== "all" ||
    filter.status !== "all" ||
    filter.token !== "all";
  const result = app.querySelector("#activity-result");
  if (result)
    result.textContent = filtered ? `${visible.length} of ${rows.length} transactions` : "";
  const summaryEl = app.querySelector<HTMLElement>("#activity-party-summary");
  if (!summaryEl) return;
  const summary =
    query.length > 0 && visible.length > 0
      ? activityPartySummary(visible.map((row) => activitySummaryRow(datasetOf(row))))
      : null;
  summaryEl.replaceChildren();
  if (summary) {
    const parts = activityPartySummaryParts(summary);
    const title = summaryEl.ownerDocument.createElement("strong");
    title.className = "activity-summary-title";
    title.textContent = parts.label;
    const body = summaryEl.ownerDocument.createElement("span");
    body.className = "activity-summary-body";
    body.textContent = parts.body;
    summaryEl.append(title, body);
  }
  summaryEl.toggleAttribute("hidden", summary === null);
};

// Re-focuses the search box at its remembered caret after a repaint rebuilt it.
const restoreSearchFocus = (app: Element | null): void => {
  if (searchCaret === null) return;
  const search = app?.querySelector<HTMLInputElement>("#activity-search");
  if (!search) return;
  search.focus();
  search.setSelectionRange(searchCaret, searchCaret);
};

/**
 * Wires the Activity filter, sort and search controls. `repaint` re-renders the
 * screen locally so the sort can change the feed's shape; the filter and the
 * search are applied in place. The sort never reads the wallet, so a failed
 * status read can no longer leave the pressed control and the state disagreeing.
 */
const bindActivityView = (app: Element | null, repaint: () => void): void => {
  const search = app?.querySelector<HTMLInputElement>("#activity-search");
  const rememberCaret = (): void => {
    searchCaret = search?.selectionStart ?? search?.value.length ?? null;
  };
  search?.addEventListener("input", () => {
    rememberCaret();
    setActivityViewState({ query: search.value });
    applyActivityView(app);
  });
  search?.addEventListener("focus", rememberCaret);
  search?.addEventListener("click", rememberCaret);
  search?.addEventListener("blur", () => {
    searchCaret = null;
  });
  const bindAxis = (id: string, axis: "action" | "status" | "token"): void => {
    app?.querySelector<HTMLSelectElement>(id)?.addEventListener("change", (event) => {
      const control = event.currentTarget as HTMLSelectElement;
      setActivityViewState({ [axis]: control.value });
      applyActivityView(app);
    });
  };
  bindAxis("#activity-type", "action");
  bindAxis("#activity-status", "status");
  bindAxis("#activity-token", "token");
  app?.querySelectorAll<HTMLElement>("[data-activity-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const sort = button.dataset["activitySort"];
      if (sort !== "amount" && sort !== "date") return;
      if (sort === activityViewState().sort) return;
      setActivityViewState({ sort });
      repaint();
    });
  });
  applyActivityView(app);
  restoreSearchFocus(app);
};

/**
 * Binds the activity screen refresh, CSV export and feed-filter controls.
 */
export const bindActivity = ({ app, render, repaint, wallet }: ActivityUiDeps): void => {
  const refreshButton = app?.querySelector<HTMLButtonElement>("#activity-refresh");
  const exportButton = app?.querySelector<HTMLButtonElement>("#activity-export");

  // The explorer link and the copy control sit inside the row's <summary>, so
  // a click on either would also toggle the row. Both presses mean exactly one
  // thing, so neither doubles as an expander.
  app
    ?.querySelectorAll<HTMLElement>(".tx-disclosure > summary :is(a, button)")
    .forEach((control) => {
      control.addEventListener("click", (event) => event.stopPropagation());
    });

  bindActivityView(app, repaint);

  refreshButton?.addEventListener("click", () => {
    buttonBusy(refreshButton, true);
    const accountId = app?.querySelector<HTMLElement>("[data-activity-account-id]")?.dataset[
      "activityAccountId"
    ];
    void wallet
      .loadActivity(accountId, false, true, true)
      .then(() => wallet.loadStatus())
      .then(render)
      .catch(() => undefined)
      .finally(() => buttonBusy(refreshButton, false));
  });

  exportButton?.addEventListener("click", () => {
    buttonBusy(exportButton, true);
    const accountId = app?.querySelector<HTMLElement>("[data-activity-account-id]")?.dataset[
      "activityAccountId"
    ];
    void wallet.loadActivity(accountId).then(
      ({ entries, historyUnavailable }) => {
        const blob = new Blob([activityToCsv(entries)], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = exportButton.ownerDocument.createElement("a");
        anchor.href = url;
        anchor.download = "bramble-activity.csv";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        const toast = activityExportToast(historyUnavailable);
        showToast(toast.message, toast.tone, exportButton);
        buttonBusy(exportButton, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Export failed"), "error", exportButton);
        buttonBusy(exportButton, false);
      },
    );
  });
};
