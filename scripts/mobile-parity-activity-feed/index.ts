/**
 * The Activity feed's CSV export, filter, amount sort and per-counterparty summary, from the
 * extension's own code over one fixed feed (`./feed.ts`), for the mobile core's port (wallet-core
 * P10: `activity::csv`, `history::filter`, `history::party`):
 *
 * - `feed`: one line holding the feed (`entries`, newest first), the tracked tokens (`tracked`,
 *   the feed's `pricing.tokens`) and the names a search resolves (`contacts`). Every other case
 *   names its rows by `hashes` (the whole feed when absent);
 * - `csv`: `activityToCsv` over the rows: the header, quoting, the formula guard on every cell,
 *   fixed-UTC dates, the value at submission and the rebuilt transfer summary;
 * - `options`: `activityFilterOptions` (with or without the tracked tokens): the actions, the
 *   statuses in lifecycle order, and the tokens by label then key, a shared ticker named by its
 *   short address;
 * - `view`: one filter the person chose (`filter`) over the rows, as `activity-views.ts` and
 *   `activity-ui.ts` apply it: `reconcileActivityFilter` against the rows' options (`reconciled`,
 *   the stale-axis reset), the rows sorted by `activityAmountComparator` for the amount sort, then
 *   kept by `activityRowMatches` over each row's `activityRowAttributes` (`visible`, hashes in
 *   order), and `activityPartySummary` over the kept rows' facts with its
 *   `activityPartySummaryParts` (`summary`, `parts`; null when they name no single
 *   counterparty). The extension shows the summary only while the search is not blank; that gate
 *   is `activity-ui.ts`'s, so the summary is recorded for every case.
 *
 * Left out: `activityContacts` (it reads preferences; the core takes the contacts as given) and
 * the toolbar's markup. `bun run mobile:parity` writes it; `bun run check` fails on drift.
 */
import { type ActivityEntry, activityToCsv } from "@bramble/transactions/activity";
// Not a package export: the feed's filter is a side-panel module, read here only to pin the port.
import {
  type ActivityFilter,
  activityAmountComparator,
  activityFilterOptions,
  activityPartySummary,
  activityPartySummaryParts,
  activityRowAttributes,
  activityRowFacts,
  activityRowMatches,
  activitySummaryRow,
  EMPTY_ACTIVITY_FILTER,
  reconcileActivityFilter,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-filter";
import type { ActivityPricing } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-format";
import { CONTACTS, FEED, KEYS, TRACKED, without } from "./feed";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const ACTIVITY_FEED_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-activity-feed.jsonl";

const PRICING: ActivityPricing = { currency: "usd", prices: {}, tokens: TRACKED };

// The browser's half of `data-*` attributes: `activityRowAttributes` writes them escaped into a
// tag, and the binding reads them back off `element.dataset`, unescaped and camel-cased.
const ENTITIES: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};
const datasetOf = (attributes: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, name = "", value = ""]) => [
      name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value.replace(/&(?:#39|amp|gt|lt|quot);/g, (entity) => ENTITIES[entity] ?? entity),
    ]),
  );

const hashesOf = (rows: readonly ActivityEntry[]) => rows.map((entry) => entry.hash);
// Only a subset is named; the whole feed is the default.
const subset = (rows: readonly ActivityEntry[]) =>
  rows.length === FEED.length ? {} : { hashes: hashesOf(rows) };

const csvCases = () =>
  [
    { name: "the whole feed", rows: FEED },
    { name: "no rows: the header alone", rows: [] },
  ].map(({ name, rows }) => ({ name, ...subset(rows), csv: activityToCsv(rows) }));

const optionsCases = () =>
  [
    { name: "with the tracked tokens", pricing: PRICING, rows: FEED },
    { name: "without tracked tokens: legacy rows keyed by symbol", pricing: undefined, rows: FEED },
    { name: "after the bridged USDC row left", pricing: PRICING, rows: without(17) },
  ].map(({ name, pricing, rows }) => ({
    name,
    ...subset(rows),
    options: activityFilterOptions(rows, pricing),
    tracked: pricing !== undefined,
  }));

type ViewCase = {
  readonly filter: Partial<ActivityFilter>;
  readonly name: string;
  readonly pricing?: ActivityPricing | undefined;
  readonly rows?: readonly ActivityEntry[];
};

const VIEWS: readonly ViewCase[] = [
  { filter: {}, name: "no filter, newest first" },
  { filter: { sort: "amount" }, name: "amount order: by token, largest first, ties newest first" },
  {
    filter: { sort: "amount" },
    name: "amount order without tracked tokens: the legacy ETH row after the addressed ones",
    pricing: undefined,
  },
  { filter: { action: "Received" }, name: "one action" },
  { filter: { action: "Approved", status: "accepted" }, name: "an action and a status" },
  { filter: { status: "preconfirmed" }, name: "one status" },
  { filter: { token: KEYS.ETH }, name: "one token by address, a legacy row resolving to it" },
  { filter: { token: "symbol:usdc" }, name: "a legacy symbol no single tracked token answers" },
  { filter: { sort: "amount", token: KEYS.USDC_BRIDGED }, name: "one of two USDC contracts" },
  { filter: { query: "alice" }, name: "a contact's name: the summary takes it" },
  { filter: { query: KEYS.ALICE_PADDED }, name: "the padded upper-case spelling" },
  { filter: { query: "  B0B000 " }, name: "part of an address, padded and upper-case" },
  { filter: { query: "0x" }, name: "a search two counterparties match: no summary" },
  {
    filter: { query: "alice", sort: "amount", status: "accepted" },
    name: "a contact, settled rows only, by amount",
  },
  { filter: { query: "-2+3" }, name: "a counterparty that is not an address" },
  { filter: { query: "nobody" }, name: "a search nothing matches" },
  { filter: { action: "Bridged" }, name: "an action the feed never offered resets" },
  {
    filter: { action: "Sent", status: "pending" },
    name: "the pending row settled: its status resets, the action stays",
    rows: without(6),
  },
  {
    filter: { query: "b0b", token: KEYS.USDC_BRIDGED },
    name: "the token left the feed: it resets, the search stays",
    rows: without(17),
  },
  {
    filter: { query: "b0b", status: "rejected", token: KEYS.STRK },
    name: "the rejected rows left: the status resets, the token stays",
    rows: without(10, 20),
  },
];

const viewCases = () =>
  VIEWS.map((view) => {
    const { filter: chosen, name, rows = FEED } = view;
    // An explicit `pricing: undefined` is the feed without tracked tokens.
    const usePricing = "pricing" in view ? view.pricing : PRICING;
    const filter: ActivityFilter = { ...EMPTY_ACTIVITY_FILTER, ...chosen };
    const reconciled = reconcileActivityFilter(filter, activityFilterOptions(rows, usePricing));
    const ordered =
      reconciled.sort === "amount" ? [...rows].sort(activityAmountComparator(usePricing)) : rows;
    const kept = ordered
      .map((entry) => ({
        entry,
        facts: datasetOf(activityRowAttributes(entry, usePricing, CONTACTS)),
      }))
      .filter(({ facts }) => activityRowMatches(activityRowFacts(facts), reconciled));
    const summary = activityPartySummary(kept.map(({ facts }) => activitySummaryRow(facts)));
    return {
      name,
      ...subset(rows),
      filter,
      parts: summary === null ? null : activityPartySummaryParts(summary),
      reconciled,
      summary,
      tracked: usePricing !== undefined,
      visible: hashesOf(kept.map(({ entry }) => entry)),
    };
  });

/**
 * Runs the extension's code for every case (deterministic) and renders one JSON line per case,
 * `{"block": <block>, "name": .., ...}`.
 */
export const renderActivityFeedParity = (): string => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["feed", [{ contacts: CONTACTS, entries: FEED, name: "the feed", tracked: TRACKED }]],
    ["csv", csvCases()],
    ["options", optionsCases()],
    ["view", viewCases()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
