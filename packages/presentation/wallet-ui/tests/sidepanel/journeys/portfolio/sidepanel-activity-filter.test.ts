/**
 * Behavioural coverage for the Activity feed's filter, search and sort controls
 * (the view layer of `bindActivity`), driven through the real rendered screen
 * under happy-dom. The pure axes are covered in activity-filter.test.ts; here
 * the point is that the controls write the view state, that the rendered rows
 * are toggled and reported, and that the sort repaints the screen through the
 * wallet's status. The stub render repaints and rebinds exactly as the shell
 * does, so a sort change is observed in the feed's own shape.
 *
 * Control preselection is asserted against the rendered markup, not the parsed
 * `select.value`: happy-dom misplaces a `<option selected>` on the last option
 * of some lists, which is a parser quirk rather than anything the browser does.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  type ActivityContact,
  type ActivityFilter,
  activityContacts,
  EMPTY_ACTIVITY_FILTER,
} from "../../../../src/sidepanel/journeys/portfolio/activity-filter";
import type { ActivityPricing } from "../../../../src/sidepanel/journeys/portfolio/activity-format";
import { bindActivity } from "../../../../src/sidepanel/journeys/portfolio/activity-ui";
import {
  activityViewState,
  resetActivityViewState,
  setActivityViewState,
} from "../../../../src/sidepanel/journeys/portfolio/activity-view-state";
import { activityScreen } from "../../../../src/sidepanel/journeys/portfolio/activity-views";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { flush, makeWallet, paint, walletStatus } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

beforeEach(() => {
  resetActivityViewState();
});

// The screen renders from the same module, so a leaked filter would steer every
// later activity render in this process.
afterEach(() => {
  resetActivityViewState();
});

const CONTACT = "0x0000000000000000000000000000000000000000000000000000000000000abc";
const CONTACT_SHORT = "0xabc";
const OTHER = "0x0000000000000000000000000000000000000000000000000000000000000def";

const strk: TokenConfig = {
  address: STRK_TOKEN_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const pricing: ActivityPricing = { currency: "usd", prices: {}, tokens: [strk] };

const contacts = activityContacts(
  {
    ...preferences,
    addressBook: [
      { address: CONTACT, id: `SN_MAIN:${CONTACT}`, label: "Ada", networkId: "SN_MAIN" },
    ],
  },
  "SN_MAIN",
  [account],
);

// Newest first, as the app hands the feed to the screen. Two UTC days so the
// day heading's own hiding is exercised, and one row whose counterparty has no
// saved name so a search resolves exactly one party.
const entries: readonly ActivityEntry[] = [
  {
    accountId: account.id,
    amount: "5",
    hash: "0x3",
    kind: "invoke",
    networkId: "SN_MAIN",
    status: "pending",
    submittedAt: 1752502020000,
    summary: "Swap 5 STRK",
    token: "STRK",
  },
  {
    accountId: account.id,
    amount: "2",
    counterparty: CONTACT_SHORT,
    hash: "0x2",
    kind: "transfer",
    networkId: "SN_MAIN",
    status: "preconfirmed",
    submittedAt: 1752501960000,
    summary: "Receive 2 STRK",
    token: "STRK",
  },
  {
    accountId: account.id,
    amount: "1.5",
    counterparty: CONTACT_SHORT,
    hash: "0x1",
    kind: "transfer",
    networkId: "SN_MAIN",
    status: "accepted",
    submittedAt: 1752501900000,
    summary: "Send 1.5 STRK",
    token: "STRK",
  },
  {
    accountId: account.id,
    amount: "9",
    counterparty: OTHER,
    hash: "0x0",
    kind: "transfer",
    networkId: "SN_MAIN",
    status: "accepted",
    submittedAt: 1752415500000,
    summary: "Send 9 STRK",
    token: "STRK",
  },
];

type Mounted = {
  readonly app: HTMLElement;
  readonly calls: ReturnType<typeof makeWallet>["calls"];
  readonly renderCalls: WalletStatus[];
};

const mountActivity = (
  filter: ActivityFilter = EMPTY_ACTIVITY_FILTER,
  viewContacts: readonly ActivityContact[] = contacts,
): Mounted => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const { calls, wallet } = makeWallet();
  const renderCalls: WalletStatus[] = [];
  // Mirrors the shell: rebuild the whole screen string and rebind, which is
  // what makes a sort change visible in the feed's own shape.
  const paintWith = (status: WalletStatus): void => {
    paint(app, activityScreen([], status, entries, false, null, pricing, null, viewContacts));
    bindActivity({
      app,
      render: async (next: WalletStatus): Promise<void> => {
        renderCalls.push(next);
        paintWith(next);
      },
      wallet: wallet as unknown as Parameters<typeof bindActivity>[0]["wallet"],
    });
  };
  setActivityViewState(filter);
  paintWith(walletStatus);
  return { app, calls, renderCalls };
};

const rows = (app: HTMLElement): HTMLElement[] => [
  ...app.querySelectorAll<HTMLElement>("#activity-feed li.tx-row"),
];
const visible = (app: HTMLElement): HTMLElement[] =>
  rows(app).filter((row) => !row.hasAttribute("hidden"));
const days = (app: HTMLElement): HTMLElement[] => [
  ...app.querySelectorAll<HTMLElement>("#activity-feed .tx-day"),
];
const visibleDays = (app: HTMLElement): HTMLElement[] =>
  days(app).filter((day) => !day.hasAttribute("hidden"));
const control = <T extends HTMLElement>(app: HTMLElement, selector: string): T => {
  const element = app.querySelector<T>(selector);
  if (!element) throw new Error(`control ${selector} missing`);
  return element;
};
// Chooses a select option by value; happy-dom resolves the value from the
// assigned string rather than the possibly misplaced parsed selection.
const choose = (app: HTMLElement, selector: string, value: string): void => {
  const select = control<HTMLSelectElement>(app, selector);
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

describe("activity feed axis controls", () => {
  test("filters rows by the visible verb, hides an emptied day, and reports the count", () => {
    const { app } = mountActivity();
    expect(visible(app)).toHaveLength(4);
    expect(visibleDays(app)).toHaveLength(2);

    choose(app, "#activity-type", "Received");

    const shown = visible(app);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.dataset["activityAction"]).toBe("Received");
    expect(visibleDays(app)).toHaveLength(1);
    expect(app.querySelector("#activity-result")?.textContent).toBe("1 of 4 transactions");
  });

  test("searches by saved name, by address and by a partial address", () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");

    search.value = "ada";
    search.dispatchEvent(new Event("input"));
    expect(visible(app)).toHaveLength(2);
    expect(app.querySelector("#activity-result")?.textContent).toBe("2 of 4 transactions");

    search.value = "0xabc";
    search.dispatchEvent(new Event("input"));
    expect(visible(app)).toHaveLength(2);

    search.value = "0xde";
    search.dispatchEvent(new Event("input"));
    expect(visible(app)).toHaveLength(1);
  });

  test("summarises the one counterparty a search resolves and clears it otherwise", () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");
    const summary = control<HTMLElement>(app, "#activity-party-summary");
    expect(summary.hasAttribute("hidden")).toBe(true);

    search.value = "ada";
    search.dispatchEvent(new Event("input"));
    expect(summary.hasAttribute("hidden")).toBe(false);
    expect(summary.textContent).toContain("Ada");
    expect(summary.textContent).toContain("2 transactions");
    expect(summary.textContent).toContain("Sent 1.5 STRK");
    expect(summary.textContent).toContain("Received 2 STRK");

    // Two counterparties match "0x", so no single-party summary is shown.
    search.value = "0x";
    search.dispatchEvent(new Event("input"));
    expect(summary.hasAttribute("hidden")).toBe(true);
  });

  test("shows the all-filtered state instead of an empty feed", () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");

    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(app.querySelector("#activity-no-matches")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#activity-result")?.textContent).toBe("0 of 4 transactions");
  });

  test("the token and status axes each cut the feed", () => {
    const { app } = mountActivity();

    choose(app, "#activity-token", "STRK");
    expect(visible(app)).toHaveLength(4);

    choose(app, "#activity-status", "accepted");
    expect(visible(app)).toHaveLength(2);
    expect(visible(app).every((row) => row.dataset["activityStatus"] === "accepted")).toBe(true);
  });
});

describe("activity counterparty summary", () => {
  test("heads the summary with the matched name and totals both directions", () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");
    search.value = "ada";
    search.dispatchEvent(new Event("input"));

    const summary = app.querySelector<HTMLElement>("#activity-party-summary");
    expect(summary?.hasAttribute("hidden")).toBe(false);
    expect(summary?.querySelector(".activity-summary-title")?.textContent).toBe("Ada");
    expect(summary?.querySelector(".activity-summary-body")?.textContent).toBe(
      "2 transactions · Sent 1.5 STRK · Received 2 STRK · 14 Jul 2025",
    );
  });

  test("writes a contact name as text rather than markup", () => {
    const { app } = mountActivity({ ...EMPTY_ACTIVITY_FILTER, query: "img" }, [
      { address: CONTACT, label: "<img src=x>" },
    ]);
    const summary = app.querySelector<HTMLElement>("#activity-party-summary");
    expect(summary?.querySelector("img")).toBeNull();
    expect(summary?.querySelector(".activity-summary-title")?.textContent).toBe("<img src=x>");
  });
});

describe("activity feed sort control", () => {
  test("renders the amount sort as one list ordered by amount, with the control pressed", () => {
    const { app } = mountActivity({ ...EMPTY_ACTIVITY_FILTER, sort: "amount" });
    expect(days(app)).toHaveLength(0);
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.map((row) => row.dataset["activityAmount"])).toEqual(["9", "5", "2", "1.5"]);
    expect(app.querySelector("[data-activity-sort='amount']")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("repaints into one amount-ordered list, then back into day groups", async () => {
    const { app, calls, renderCalls } = mountActivity();
    expect(days(app)).toHaveLength(2);

    control<HTMLElement>(app, "[data-activity-sort='amount']").click();
    await flush();

    expect(calls.loadStatus).toBe(1);
    expect(renderCalls).toHaveLength(1);
    expect(activityViewState().sort).toBe("amount");
    expect(days(app)).toHaveLength(0);
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.map((row) => row.dataset["activityAmount"])).toEqual(["9", "5", "2", "1.5"]);
    expect(app.querySelector("[data-activity-sort='amount']")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    // Asking for the sort already in force repaints nothing.
    control<HTMLElement>(app, "[data-activity-sort='amount']").click();
    await flush();
    expect(calls.loadStatus).toBe(1);

    control<HTMLElement>(app, "[data-activity-sort='date']").click();
    await flush();
    expect(calls.loadStatus).toBe(2);
    expect(activityViewState().sort).toBe("date");
    expect(days(app)).toHaveLength(2);
  });

  test("keeps a search in force across the sort repaint", async () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");
    search.value = "ada";
    search.dispatchEvent(new Event("input"));
    expect(visible(app)).toHaveLength(2);

    control<HTMLElement>(app, "[data-activity-sort='amount']").click();
    await flush();

    expect(control<HTMLInputElement>(app, "#activity-search").value).toBe("ada");
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.filter((row) => !row.hasAttribute("hidden"))).toHaveLength(2);
  });

  test("renders the controls from the view state", () => {
    const { app } = mountActivity({
      action: "Sent",
      query: "ada",
      sort: "date",
      status: "accepted",
      token: "STRK",
    });
    expect(control<HTMLInputElement>(app, "#activity-search").value).toBe("ada");
    // Asserted on the rendered string, since happy-dom misparses a selection.
    const html = activityScreen([], walletStatus, entries, false, null, pricing, null, contacts);
    expect(html).toContain('value="Sent" selected');
    expect(html).toContain('value="accepted" selected');
    expect(html).toContain('value="STRK" selected');
    expect(visible(app)).toHaveLength(1);
  });
});

describe("activity view state", () => {
  test("merges a patch and clears on reset", () => {
    setActivityViewState({ action: "Sent", query: "ada" });
    setActivityViewState({ sort: "amount" });
    expect(activityViewState()).toEqual({
      ...EMPTY_ACTIVITY_FILTER,
      action: "Sent",
      query: "ada",
      sort: "amount",
    });
    resetActivityViewState();
    expect(activityViewState()).toEqual(EMPTY_ACTIVITY_FILTER);
  });
});
