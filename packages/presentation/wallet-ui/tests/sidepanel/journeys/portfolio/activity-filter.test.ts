/**
 * Coverage for the Activity feed's pure filter, sort and summary layer: which
 * filter values a feed offers, how an address-book name and an address both
 * match a search, the amount order, and the per-counterparty summary. The
 * binding that applies all of this to the rendered rows is covered separately.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  canonicalAddress,
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import {
  isAddressBookEntry,
  isTokenConfig,
  type TokenConfig,
} from "@bramble/wallet-model/preferences";
import {
  type ActivityFilter,
  type ActivitySummaryRow,
  activityAmountComparator,
  activityContacts,
  activityFilterOptions,
  activityPartySummary,
  activityPartySummaryParts,
  activityRowAttributes,
  activityRowFacts,
  activityRowMatches,
  activitySearchIndex,
  activityTokenKey,
  compareActivityByAmount,
  EMPTY_ACTIVITY_FILTER,
  reconcileActivityFilter,
} from "../../../../src/sidepanel/journeys/portfolio/activity-filter";

// Address book entries are stored in the padded canonical spelling the
// validator enforces, while an entry records the short one, so name resolution
// has to bridge the two spellings.
const CONTACT = "0x0000000000000000000000000000000000000000000000000000000000000abc";
const CONTACT_SHORT = "0xabc";
const OTHER_NETWORK = "0x0000000000000000000000000000000000000000000000000000000000000def";

const strk: TokenConfig = {
  address: STRK_TOKEN_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

const sent: ActivityEntry = {
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
};

const received: ActivityEntry = {
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
};

const swapped: ActivityEntry = {
  accountId: account.id,
  amount: "5",
  hash: "0x3",
  kind: "invoke",
  networkId: "SN_MAIN",
  status: "pending",
  submittedAt: 1752502020000,
  summary: "Swap 5 STRK",
};

const filter = (patch: Partial<ActivityFilter>): ActivityFilter => ({
  ...EMPTY_ACTIVITY_FILTER,
  ...patch,
});

const summaryRow = (patch: Partial<ActivitySummaryRow> = {}): ActivitySummaryRow => ({
  amount: "1",
  counterparty: CONTACT_SHORT,
  decimals: 18,
  direction: "out",
  label: "",
  submittedAt: 1752501900000,
  token: "STRK",
  tokenKey: "symbol:strk",
  ...patch,
});

describe("activity fixtures", () => {
  // The views hand these fixtures straight to the filter, bypassing the wire
  // readers, so the validators are called here instead.
  test("satisfy the production validators", () => {
    expect(
      isAddressBookEntry({
        address: CONTACT,
        id: `SN_MAIN:${CONTACT}`,
        label: "Ada",
        networkId: "SN_MAIN",
      }),
    ).toBe(true);
    expect(isTokenConfig(strk)).toBe(true);
  });
});

describe("activityFilterOptions", () => {
  test("offers only the values the feed contains, in lifecycle and text order", () => {
    const options = activityFilterOptions([swapped, sent, received]);
    expect(options.actions).toEqual(["Received", "Sent", "Swapped"]);
    expect(options.statuses).toEqual(["accepted", "pending", "preconfirmed"]);
    expect(options.tokens).toEqual([{ key: "symbol:strk", label: "STRK" }]);
  });

  test("omits a token axis the feed never records", () => {
    expect(activityFilterOptions([swapped]).tokens).toEqual([]);
  });
});

describe("activityContacts", () => {
  const withContacts: WalletPreferences = {
    ...preferences,
    accountLabels: { [account.id]: "Spending" },
    addressBook: [
      { address: CONTACT, id: `SN_MAIN:${CONTACT}`, label: "Ada", networkId: "SN_MAIN" },
      {
        address: OTHER_NETWORK,
        id: `SN_SEPOLIA:${OTHER_NETWORK}`,
        label: "Other network",
        networkId: "SN_SEPOLIA",
      },
    ],
  };

  test("resolves address-book names and labelled accounts on the feed's network", () => {
    const contacts = activityContacts(withContacts, "SN_MAIN", [account]);
    expect(contacts).toContainEqual({ address: CONTACT, label: "Ada" });
    expect(contacts).toContainEqual({ address: account.address, label: "Spending" });
    expect(contacts.map((contact) => contact.label)).not.toContain("Other network");
  });

  test("drops an unlabelled account and tolerates absent preferences", () => {
    expect(activityContacts(preferences, "SN_MAIN", [account])).toEqual([]);
    expect(activityContacts(null, "SN_MAIN", [account])).toEqual([]);
  });
});

describe("activitySearchIndex", () => {
  test("carries the saved name and the address in every stored spelling", () => {
    const index = activitySearchIndex(CONTACT_SHORT, "Ada");
    expect(index.startsWith("ada 0xabc ")).toBe(true);
    // The zero-padded spelling the address book stores and copies.
    expect(index).toContain(CONTACT);
    expect(activitySearchIndex(CONTACT, null)).toBe(`${CONTACT} 0xabc`);
    expect(activitySearchIndex(undefined, null)).toBe("");
    expect(activitySearchIndex("not-a-felt", null)).toBe("not-a-felt");
  });

  test("matches a padded address and a padded partial against a short-spelled record", () => {
    const recipient = "0x4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const padded = canonicalAddress(recipient) ?? "";
    const index = activitySearchIndex(recipient, "Research treasury");
    const matches = (query: string): boolean =>
      activityRowMatches(activityRowFacts({ activitySearch: index }), {
        ...EMPTY_ACTIVITY_FILTER,
        query,
      });

    expect(padded.length).toBe(66);
    expect(padded).not.toBe(recipient);
    expect(matches(padded)).toBe(true);
    expect(matches(padded.slice(0, 10))).toBe(true);
    expect(matches("0x4567890a")).toBe(true);
    expect(matches("Research Treasury")).toBe(true);
    expect(matches("0x9999")).toBe(false);
  });
});

describe("activityRowAttributes", () => {
  const attributes = activityRowAttributes(sent, { currency: "usd", prices: {}, tokens: [strk] }, [
    { address: CONTACT, label: "Ada" },
  ]);

  test("describe the row for the binding without repeating the render model", () => {
    expect(attributes).toContain('data-activity-action="Sent"');
    expect(attributes).toContain('data-activity-amount="1.5"');
    expect(attributes).toContain('data-activity-counterparty="0xabc"');
    expect(attributes).toContain('data-activity-counterparty-label="Ada"');
    expect(attributes).toContain('data-activity-decimals="18"');
    expect(attributes).toContain('data-activity-direction="out"');
    expect(attributes).toContain(`data-activity-search="ada 0xabc ${CONTACT}"`);
    expect(attributes).toContain('data-activity-status="accepted"');
    expect(attributes).toContain('data-activity-token="STRK"');
    expect(attributes).toContain('data-activity-ts="1752501900000"');
  });

  test("omits absent facts rather than writing empty attributes", () => {
    const sparse = activityRowAttributes(swapped, undefined, []);
    expect(sparse).not.toContain("data-activity-token");
    expect(sparse).not.toContain("data-activity-counterparty");
    expect(sparse).not.toContain("data-activity-decimals");
    expect(sparse).toContain('data-activity-action="Swapped"');
  });
});

describe("activityRowMatches", () => {
  const facts = activityRowFacts({
    activityAction: "Sent",
    activitySearch: "ada 0xabc",
    activityStatus: "accepted",
    activityToken: "STRK",
    activityTokenKey: "symbol:strk",
  });

  test("passes the unfiltered feed", () => {
    expect(activityRowMatches(facts, EMPTY_ACTIVITY_FILTER)).toBe(true);
  });

  test("applies every axis conjunctively", () => {
    expect(activityRowMatches(facts, filter({ action: "Received" }))).toBe(false);
    expect(activityRowMatches(facts, filter({ status: "accepted" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ status: "pending" }))).toBe(false);
    expect(activityRowMatches(facts, filter({ token: "symbol:strk" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ token: "symbol:eth" }))).toBe(false);
    // The axis compares the token's identity, never its symbol.
    expect(activityRowMatches(facts, filter({ token: "STRK" }))).toBe(false);
    expect(activityRowMatches(facts, filter({ action: "Sent", token: "symbol:strk" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ action: "Sent", status: "pending" }))).toBe(false);
  });

  test("matches a full address, a partial one, and a saved name case-insensitively", () => {
    expect(activityRowMatches(facts, filter({ query: "ADA" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ query: "0xabc" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ query: "0xab" }))).toBe(true);
    expect(activityRowMatches(facts, filter({ query: "  ada  " }))).toBe(true);
    expect(activityRowMatches(facts, filter({ query: "0xzzz" }))).toBe(false);
  });

  test("reads an absent attribute as matching only the all axis", () => {
    const bare = activityRowFacts({});
    expect(activityRowMatches(bare, EMPTY_ACTIVITY_FILTER)).toBe(true);
    expect(activityRowMatches(bare, filter({ status: "accepted" }))).toBe(false);
  });
});

describe("compareActivityByAmount", () => {
  // A recorded amount means nothing across tokens (1 ETH is not below 2 USDC),
  // so the sort groups rows by token before it compares amounts.
  const withToken = (entry: ActivityEntry, symbol: string): ActivityEntry => ({
    ...entry,
    token: symbol,
  });

  test("orders one token's rows by recorded amount descending, then newest first", () => {
    const ordered = [sent, withToken(swapped, "STRK"), received].sort(compareActivityByAmount);
    expect(ordered.map((entry) => entry.hash)).toEqual(["0x3", "0x2", "0x1"]);
    const tied: ActivityEntry = { ...received, amount: "1.5" };
    expect(compareActivityByAmount(tied, sent)).toBeLessThan(0);
  });

  test("groups by token so a raw amount is never compared across tokens", () => {
    const eth = withToken({ ...sent, amount: "1", hash: "0xe" }, "ETH");
    const usdc = withToken({ ...sent, amount: "2", hash: "0xu" }, "USDC");
    const ordered = [usdc, eth, sent].sort(compareActivityByAmount);
    // ETH and USDC each keep their own order; 2 USDC never outranks 1 ETH.
    expect(ordered.map((entry) => entry.token)).toEqual(["ETH", "STRK", "USDC"]);
  });

  test("sorts a token-less row, and a row with no numeric amount, last", () => {
    const undated: ActivityEntry = {
      accountId: account.id,
      counterparty: CONTACT_SHORT,
      hash: "0x0",
      kind: "transfer",
      networkId: "SN_MAIN",
      status: "accepted",
      submittedAt: 1752501900000,
      summary: "Send 1 STRK",
      token: "STRK",
    };
    expect(compareActivityByAmount(undated, sent)).toBeGreaterThan(0);
    expect(compareActivityByAmount(sent, undated)).toBeLessThan(0);
    // Two rows with no amount, in one token, keep the feed's newest-first order.
    const newer: ActivityEntry = { ...undated, submittedAt: undated.submittedAt + 1000 };
    expect(compareActivityByAmount(undated, newer)).toBeGreaterThan(0);
    // A row with no token at all sorts after every token-bearing row.
    expect(compareActivityByAmount(swapped, sent)).toBeGreaterThan(0);
    expect(compareActivityByAmount(sent, swapped)).toBeLessThan(0);
  });
});

describe("reconcileActivityFilter", () => {
  const options = activityFilterOptions([swapped, sent, received]);

  test("passes a filter whose values the feed still offers", () => {
    const kept = filter({ action: "Sent", status: "accepted", token: "symbol:strk" });
    expect(reconcileActivityFilter(kept, options)).toBe(kept);
  });

  test("resets only the stale axes, keeping the query and the sort", () => {
    const stale = filter({
      action: "Approved",
      query: "ada",
      sort: "amount",
      status: "reverted",
      token: "symbol:eth",
    });
    expect(reconcileActivityFilter(stale, options)).toEqual({
      action: "all",
      query: "ada",
      sort: "amount",
      status: "all",
      token: "all",
    });
  });

  test("clears every axis when the feed offers no options", () => {
    const stale = filter({ action: "Sent", status: "accepted", token: "STRK", query: "x" });
    expect(reconcileActivityFilter(stale, { actions: [], statuses: [], tokens: [] })).toEqual({
      ...stale,
      action: "all",
      status: "all",
      token: "all",
    });
  });
});

describe("activityPartySummary", () => {
  test("summarises one counterparty's count, totals and date range", () => {
    const summary = activityPartySummary([
      summaryRow({ amount: "1.5", direction: "out" }),
      summaryRow({ amount: "2", direction: "in", label: "Ada", submittedAt: 1752501960000 }),
    ]);
    expect(summary?.count).toBe(2);
    expect(summary?.label).toBe("Ada");
    expect(summary?.totals).toEqual([{ received: "2", sent: "1.5", symbol: "STRK" }]);
    expect(summary?.firstAt).toBe(1752501900000);
    expect(summary?.lastAt).toBe(1752501960000);
  });

  test("returns null unless the visible rows name exactly one counterparty", () => {
    expect(activityPartySummary([])).toBeNull();
    expect(
      activityPartySummary([summaryRow(), summaryRow({ counterparty: OTHER_NETWORK })]),
    ).toBeNull();
  });

  test("keeps one counterparty's totals per token, in arrival order", () => {
    const summary = activityPartySummary([
      summaryRow({ amount: "1", token: "STRK" }),
      summaryRow({ amount: "2", token: "ETH", tokenKey: "symbol:eth" }),
    ]);
    expect(summary?.totals.map((total) => total.symbol)).toEqual(["STRK", "ETH"]);
  });

  test("counts a row it cannot total instead of trusting a bad amount", () => {
    expect(activityPartySummary([summaryRow({ amount: "not-a-number" })])?.totals).toEqual([]);
    expect(activityPartySummary([summaryRow({ amount: "1.0000000000000000001" })])?.totals).toEqual(
      [],
    );
    expect(activityPartySummary([summaryRow({ decimals: null })])?.totals).toEqual([]);
    expect(activityPartySummary([summaryRow({ direction: "internal" })])?.totals).toEqual([]);
    expect(activityPartySummary([summaryRow({ token: "", tokenKey: "" })])?.totals).toEqual([]);
  });
});

describe("activityPartySummaryParts", () => {
  const summary = activityPartySummary([
    summaryRow({ amount: "1.5", direction: "out", label: "Ada" }),
    summaryRow({ amount: "2", direction: "in", label: "Ada", submittedAt: 1752501960000 }),
  ]);

  test("carries the name, the count, both directions and the date", () => {
    const parts = summary === null ? null : activityPartySummaryParts(summary);
    expect(parts?.label).toBe("Ada");
    expect(parts?.body).toBe("2 transactions · Sent 1.5 STRK · Received 2 STRK · 14 Jul 2025");
  });

  test("says one transaction in the singular and heads an unnamed row by its address", () => {
    const single = activityPartySummary([summaryRow({ label: "" })]);
    const parts = single === null ? null : activityPartySummaryParts(single);
    expect(parts?.label).toBe(CONTACT_SHORT);
    expect(parts?.body).toBe("1 transaction · Sent 1 STRK · 14 Jul 2025");
  });

  test("returns the name verbatim, leaving escaping to the writer", () => {
    const hostile = activityPartySummary([summaryRow({ label: "<img src=x>" })]);
    const parts = hostile === null ? null : activityPartySummaryParts(hostile);
    expect(parts?.label).toBe("<img src=x>");
  });
});

describe("token and counterparty identity", () => {
  const pricing = { currency: "usd" as const, prices: {}, tokens: [strk] };

  test("a tracked token is keyed, offered and sorted by its address, never its symbol", () => {
    const key = activityTokenKey(sent, pricing);
    expect(key).toBe(canonicalFelt(STRK_TOKEN_ADDRESS) ?? "");
    expect(activityFilterOptions([sent, received], pricing).tokens).toEqual([
      { key, label: "STRK" },
    ]);
    // A symbol no single tracked token answers to keeps a key of its own, which
    // can never equal an address key.
    expect(activityTokenKey({ ...sent, token: "USDC" }, pricing)).toBe("symbol:usdc");
    const fake = { ...sent, amount: "1000", token: "USDC" };
    const ordered = [fake, sent].sort(activityAmountComparator(pricing));
    expect(ordered.map((entry) => entry.token)).toEqual(["STRK", "USDC"]);
  });

  test("one counterparty written with and without leading zeros is one counterparty", () => {
    const summary = activityPartySummary([
      summaryRow({ amount: "1", counterparty: CONTACT_SHORT }),
      summaryRow({ amount: "2", counterparty: CONTACT, direction: "in" }),
    ]);
    expect(summary?.count).toBe(2);
    expect(summary?.totals).toEqual([{ received: "2", sent: "1", symbol: "STRK" }]);
  });

  test("totals are kept apart per token key even when the symbol is shared", () => {
    const summary = activityPartySummary([
      summaryRow({ amount: "1", token: "USDC", tokenKey: "0x1" }),
      summaryRow({ amount: "2", token: "USDC", tokenKey: "0x2" }),
    ]);
    expect(summary?.totals).toEqual([
      { received: "0", sent: "1", symbol: "USDC" },
      { received: "0", sent: "2", symbol: "USDC" },
    ]);
  });
});
