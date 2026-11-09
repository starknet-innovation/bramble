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
import { canonicalFelt, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
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
import { makeWallet, paint, walletStatus } from "../../../support/transfer-ui-harness";

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
// The token filter's value is the tracked token's canonical address.
const STRK_KEY = canonicalFelt(STRK_TOKEN_ADDRESS) ?? "";

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
  readonly repaints: number[];
};

const mountActivity = (
  filter: ActivityFilter = EMPTY_ACTIVITY_FILTER,
  viewContacts: readonly ActivityContact[] = contacts,
  feed: readonly ActivityEntry[] = entries,
): Mounted => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const { calls, wallet } = makeWallet();
  const repaints: number[] = [];
  // Mirrors the shell: the sort asks for a local repaint that rebuilds the
  // screen string from the data already on hand, never a wallet status read,
  // which is what makes a sort change visible in the feed's own shape.
  const paintWith = (status: WalletStatus, entries_: readonly ActivityEntry[]): void => {
    paint(app, activityScreen([], status, entries_, false, null, pricing, null, viewContacts));
    bindActivity({
      app,
      repaint: (): void => {
        repaints.push(1);
        paintWith(status, entries_);
      },
      render: async (next: WalletStatus): Promise<void> => paintWith(next, entries_),
      wallet: wallet as unknown as Parameters<typeof bindActivity>[0]["wallet"],
    });
  };
  setActivityViewState(filter);
  paintWith(walletStatus, feed);
  return { app, calls, repaints };
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

    choose(app, "#activity-token", STRK_KEY);
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

  test("repaints locally into one amount-ordered list, then back into day groups", () => {
    const { app, calls, repaints } = mountActivity();
    expect(days(app)).toHaveLength(2);

    control<HTMLElement>(app, "[data-activity-sort='amount']").click();

    // The sort repaints from the data already on screen: no wallet read, so no
    // failed status round trip can desync the pressed control from the state.
    expect(calls.loadStatus).toBe(0);
    expect(repaints).toHaveLength(1);
    expect(activityViewState().sort).toBe("amount");
    expect(days(app)).toHaveLength(0);
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.map((row) => row.dataset["activityAmount"])).toEqual(["9", "5", "2", "1.5"]);
    expect(app.querySelector("[data-activity-sort='amount']")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    // Asking for the sort already in force repaints nothing.
    control<HTMLElement>(app, "[data-activity-sort='amount']").click();
    expect(repaints).toHaveLength(1);

    control<HTMLElement>(app, "[data-activity-sort='date']").click();
    expect(repaints).toHaveLength(2);
    expect(calls.loadStatus).toBe(0);
    expect(activityViewState().sort).toBe("date");
    expect(days(app)).toHaveLength(2);
  });

  test("groups rows by token so a raw amount is never compared across tokens", () => {
    const usdc: ActivityEntry = {
      accountId: account.id,
      amount: "2",
      hash: "0x4",
      kind: "transfer",
      networkId: "SN_MAIN",
      status: "accepted",
      submittedAt: 1752415500000,
      summary: "Send 2 USDC",
      token: "USDC",
    };
    const eth: ActivityEntry = {
      accountId: account.id,
      amount: "1",
      hash: "0x5",
      kind: "transfer",
      networkId: "SN_MAIN",
      status: "accepted",
      submittedAt: 1752415500000,
      summary: "Send 1 ETH",
      token: "ETH",
    };
    // Raw amounts order 2 (USDC) above 1 (ETH), but grouping keeps each token's
    // own order and never crosses tokens.
    const { app } = mountActivity({ ...EMPTY_ACTIVITY_FILTER, sort: "amount" }, contacts, [
      eth,
      usdc,
      ...entries,
    ]);
    const flat = [...app.querySelectorAll<HTMLElement>("#activity-feed .tx-list-flat li.tx-row")];
    expect(flat.map((row) => row.dataset["activityToken"])).toEqual([
      "ETH",
      "STRK",
      "STRK",
      "STRK",
      "STRK",
      "USDC",
    ]);
    expect(flat.map((row) => row.dataset["activityAmount"])).toEqual([
      "1",
      "9",
      "5",
      "2",
      "1.5",
      "2",
    ]);
  });

  test("keeps a search in force across the sort repaint", () => {
    const { app } = mountActivity();
    const search = control<HTMLInputElement>(app, "#activity-search");
    search.value = "ada";
    search.dispatchEvent(new Event("input"));
    expect(visible(app)).toHaveLength(2);

    control<HTMLElement>(app, "[data-activity-sort='amount']").click();

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
      token: STRK_KEY,
    });
    expect(control<HTMLInputElement>(app, "#activity-search").value).toBe("ada");
    // Asserted on the rendered string, since happy-dom misparses a selection.
    const html = activityScreen([], walletStatus, entries, false, null, pricing, null, contacts);
    expect(html).toContain('value="Sent" selected');
    expect(html).toContain('value="accepted" selected');
    expect(html).toContain(`value="${STRK_KEY}" selected`);
    expect(visible(app)).toHaveLength(1);
  });
});

describe("activity filter reconciliation", () => {
  // The stored filter can outlive the option it names: a pending transaction
  // settles between paints, so "pending" is no longer offered while the state
  // still filters on it. Before the toolbar renders, the stale axis must reset
  // so the control, the state and the rows agree instead of the feed emptying
  // behind a control that reads "All statuses".
  const settled = entries.map((entry) =>
    entry.status === "pending" ? { ...entry, status: "accepted" as const } : entry,
  );
  const selectHtml = (html: string, name: string): string => {
    const start = html.indexOf(`name="${name}"`);
    return html.slice(start, html.indexOf("</select>", start));
  };

  test("resets a stale axis and shows the whole feed", () => {
    const { app } = mountActivity(
      { ...EMPTY_ACTIVITY_FILTER, status: "pending" },
      contacts,
      settled,
    );

    expect(activityViewState().status).toBe("all");
    expect(visible(app)).toHaveLength(4);
    expect(app.querySelector("#activity-result")?.textContent).toBe("");
    const html = activityScreen([], walletStatus, settled, false, null, pricing, null, contacts);
    expect(selectHtml(html, "activity-status")).toContain('value="all" selected');
  });

  test("keeps an axis whose value the feed still offers", () => {
    const { app } = mountActivity({ ...EMPTY_ACTIVITY_FILTER, status: "accepted" });
    expect(activityViewState().status).toBe("accepted");
    expect(visible(app)).toHaveLength(2);
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
