/**
 * Pure filtering, sorting and summarising for the Activity feed. No DOM, no
 * clock: the caller passes the entries, the tracked tokens and the contact
 * names, and this module returns matches, a comparator and an escaped summary
 * fragment. The binding owns the ephemeral filter state; nothing here persists.
 */
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ActivityEntry, ActivityStatus } from "@bramble/transactions/activity";
import { shortAddress } from "@bramble/transactions/verify-decode";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalAddress, canonicalFelt } from "@bramble/wallet-model/networks";
import { formatUtcDate } from "../../shared/timestamp";
import {
  type ActivityPricing,
  activityAppearance,
  activityRowModel,
  activityTrackedToken,
} from "./activity-format";

/** Sort orders the Activity feed offers. */
type ActivitySortOrder = "amount" | "date";

/**
 * The Activity feed's display filters. `action` holds the visible verb
 * (`activityAppearance(entry).title`), the unit the user actually sees; `all`
 * disables that axis. The whole object is ephemeral UI state.
 */
export type ActivityFilter = {
  readonly action: string;
  readonly query: string;
  readonly sort: ActivitySortOrder;
  readonly status: ActivityStatus | "all";
  readonly token: string;
};

/** The unfiltered feed, newest first. */
export const EMPTY_ACTIVITY_FILTER: ActivityFilter = {
  action: "all",
  query: "",
  sort: "date",
  status: "all",
  token: "all",
};

/**
 * One resolvable name for the feed's search: an address book contact or one of
 * the user's own labelled accounts, on the feed's network.
 */
export type ActivityContact = {
  readonly address: string;
  readonly label: string;
};

/**
 * One token the feed's token control offers. `key` identifies the token (see
 * {@link activityTokenKey}); `label` is the symbol the reader sees.
 */
type ActivityTokenOption = {
  readonly key: string;
  readonly label: string;
};

/** The filter axes that are actually present in the feed, for the controls. */
export type ActivityFilterOptions = {
  readonly actions: readonly string[];
  readonly statuses: readonly ActivityStatus[];
  readonly tokens: readonly ActivityTokenOption[];
};

/**
 * The identity a row's token is grouped, filtered, sorted and totalled by: its
 * canonical address, so two tokens that share a symbol are never one token. A
 * row records that address (issue 643); a legacy row with only a symbol takes
 * the address of the one tracked token on its network with that symbol, and
 * otherwise keeps a `symbol:` key of its own, which can never equal an address
 * key. `""` when the row names no token.
 */
export const activityTokenKey = (
  entry: Pick<ActivityEntry, "networkId" | "token" | "tokenAddress">,
  pricing?: ActivityPricing,
): string => {
  const symbol = entry.token?.trim();
  if (!symbol) return "";
  const address = entry.tokenAddress ?? activityTrackedToken(entry, pricing)?.address;
  const canonical = address ? canonicalFelt(address) : null;
  return canonical ?? `symbol:${symbol.toLowerCase()}`;
};

// Status order the filter offers, so the list reads by lifecycle rather than
// alphabetically. Only the statuses present in the feed are shown.
const STATUS_ORDER: readonly ActivityStatus[] = [
  "accepted",
  "pending",
  "preconfirmed",
  "rejected",
  "reverted",
];

// Deterministic, locale-independent ordering for control option lists.
const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The distinct filter values present in a feed. Derived from the entries so a
 * control never offers a value that would match nothing.
 */
export const activityFilterOptions = (
  entries: readonly ActivityEntry[],
  pricing?: ActivityPricing,
): ActivityFilterOptions => {
  const actions = new Set<string>();
  const statuses = new Set<ActivityStatus>();
  const tokens = new Map<string, string>();
  for (const entry of entries) {
    actions.add(activityAppearance(entry).title);
    statuses.add(entry.status);
    const key = activityTokenKey(entry, pricing);
    const label = entry.token?.trim();
    if (key && label && !tokens.has(key)) tokens.set(key, label);
  }
  // Two contracts can share a ticker (issue 643). Where labels collide, each
  // option keyed by an address names it ("USDC · 0x053c…68a8"); unique labels
  // and older symbol-keyed rows read as before.
  const labelCounts = new Map<string, number>();
  for (const label of tokens.values()) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  const optionLabel = (key: string, label: string): string => {
    if ((labelCounts.get(label) ?? 0) < 2 || key.startsWith("symbol:")) return label;
    return `${label} · ${shortAddress(canonicalAddress(key) ?? key)}`;
  };
  return {
    actions: [...actions].sort(byText),
    statuses: STATUS_ORDER.filter((status) => statuses.has(status)),
    tokens: [...tokens]
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) => byText(left.label, right.label) || byText(left.key, right.key))
      .map(({ key, label }) => ({ key, label: optionLabel(key, label) })),
  };
};

/**
 * Contacts the feed's search can resolve: address book entries and the user's
 * own labelled accounts on the feed's network, de-duplicated by address. A
 * contact with no label is dropped, since it adds nothing a raw address does
 * not already provide.
 */
export const activityContacts = (
  preferences: WalletPreferences | null,
  networkId: string,
  accounts: readonly AccountRef[] = [],
): readonly ActivityContact[] => {
  const byAddress = new Map<string, string>();
  for (const entry of preferences?.addressBook ?? []) {
    if (entry.networkId !== networkId) continue;
    byAddress.set(entry.address.toLowerCase(), entry.label);
  }
  const labels = preferences?.accountLabels ?? {};
  for (const account of accounts) {
    if (account.networkId !== networkId) continue;
    const label = labels[account.id];
    if (label) byAddress.set(account.address.toLowerCase(), label);
  }
  return [...byAddress].map(([address, label]) => ({ address, label }));
};

// The recorded counterparty matched to a contact by field-element comparison,
// never by substring, because the same address may be written with or without
// leading zeros. Reuses the shared felt canonicaliser.
const contactFor = (
  counterparty: string | undefined,
  contacts: readonly ActivityContact[],
): ActivityContact | null => {
  if (!counterparty) return null;
  const canonical = canonicalFelt(counterparty);
  if (canonical === null) return null;
  return contacts.find((contact) => canonicalFelt(contact.address) === canonical) ?? null;
};

/**
 * The lowercased haystack a row matches a search query against: the contact
 * name (when one resolves) plus the counterparty address in its recorded,
 * canonical and padded spellings, so a full address, a partial one, a paste of
 * the padded address the address book shows, or a saved name all match. Never
 * includes the display hash, which is truncated.
 */
export const activitySearchIndex = (
  counterparty: string | undefined,
  label: string | null,
): string => {
  const parts: string[] = [];
  if (label) parts.push(label);
  if (counterparty) {
    parts.push(counterparty);
    const canonical = canonicalFelt(counterparty);
    if (canonical !== null && canonical !== counterparty) parts.push(canonical);
    // The address book stores and copies the zero-padded spelling, so a pasted
    // address must match a record that kept the short one, and the reverse.
    const padded = canonicalAddress(counterparty);
    if (padded !== null && !parts.some((part) => part.toLowerCase() === padded)) {
      parts.push(padded);
    }
  }
  return parts.join(" ").toLowerCase();
};

/**
 * The data attributes one Activity row carries so the binding can filter and
 * sort it without re-deriving the display model. Derived from the same
 * `activityRowModel` the row renders, so there is one classification source.
 * Escaped for embedding inside an element tag.
 */
export const activityRowAttributes = (
  entry: ActivityEntry,
  pricing: ActivityPricing | undefined,
  contacts: readonly ActivityContact[],
): string => {
  const model = activityRowModel(entry, pricing);
  const token = model.tokenAddress
    ? pricing?.tokens.find((candidate) => candidate.address === model.tokenAddress)
    : undefined;
  const contact = contactFor(entry.counterparty, contacts);
  const attributes: Readonly<Record<string, string>> = {
    "data-activity-action": model.title,
    "data-activity-amount": entry.amount?.trim() ?? "",
    "data-activity-counterparty": entry.counterparty?.trim().toLowerCase() ?? "",
    "data-activity-counterparty-label": contact?.label ?? "",
    "data-activity-decimals": token ? String(token.decimals) : "",
    "data-activity-direction": model.direction ?? "",
    "data-activity-search": activitySearchIndex(entry.counterparty, contact?.label ?? null),
    "data-activity-status": entry.status,
    "data-activity-token": entry.token?.trim() ?? "",
    "data-activity-token-key": activityTokenKey(entry, pricing),
    "data-activity-ts": String(entry.submittedAt),
  };
  return Object.entries(attributes)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(" ");
};

/** The subset of a row's dataset the filter reads. */
export type ActivityRowFacts = {
  readonly action: string;
  readonly search: string;
  readonly status: string;
  readonly token: string;
};

/**
 * Reads the filter-relevant facts off a row's dataset. Absent attributes read
 * as empty strings, which match only the `all` axis.
 */
export const activityRowFacts = (
  dataset: Readonly<Record<string, string | undefined>>,
): ActivityRowFacts => ({
  action: dataset["activityAction"] ?? "",
  search: dataset["activitySearch"] ?? "",
  status: dataset["activityStatus"] ?? "",
  // The axis compares the token's identity, never its symbol: two tokens that
  // share a symbol are filtered apart.
  token: dataset["activityTokenKey"] ?? "",
});

/**
 * Whether one row survives the current filter. Every axis is conjunctive; the
 * `all` sentinel on an axis disables it, and an empty query disables search.
 */
export const activityRowMatches = (facts: ActivityRowFacts, filter: ActivityFilter): boolean => {
  if (filter.action !== "all" && facts.action !== filter.action) return false;
  if (filter.status !== "all" && facts.status !== filter.status) return false;
  if (filter.token !== "all" && facts.token !== filter.token) return false;
  const query = filter.query.trim().toLowerCase();
  return query.length === 0 || facts.search.includes(query);
};

const numericAmount = (amount: string | undefined): number | null => {
  const trimmed = amount?.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

/**
 * Comparator for the amount sort. A recorded amount is only comparable within
 * its own token (1 ETH is not less than 2 USDC), so rows group by token
 * identity ({@link activityTokenKey}, ordered by symbol) and each token's rows
 * order by recorded amount descending, then most recent first. A token-less row
 * sorts last, and an entry with no numeric amount sorts last within its token
 * rather than being dropped. Without `pricing`, a legacy row without an address
 * is told apart by symbol alone.
 */
export const activityAmountComparator =
  (pricing?: ActivityPricing) =>
  (
    left: Pick<ActivityEntry, "amount" | "networkId" | "submittedAt" | "token" | "tokenAddress">,
    right: Pick<ActivityEntry, "amount" | "networkId" | "submittedAt" | "token" | "tokenAddress">,
  ): number => {
    const leftKey = activityTokenKey(left, pricing);
    const rightKey = activityTokenKey(right, pricing);
    if (leftKey !== rightKey) {
      if (leftKey.length === 0) return 1;
      if (rightKey.length === 0) return -1;
      const bySymbol = byText(
        left.token?.trim().toLowerCase() ?? "",
        right.token?.trim().toLowerCase() ?? "",
      );
      return bySymbol || byText(leftKey, rightKey);
    }
    const leftAmount = numericAmount(left.amount);
    const rightAmount = numericAmount(right.amount);
    if (leftAmount === null && rightAmount === null) return right.submittedAt - left.submittedAt;
    if (leftAmount === null) return 1;
    if (rightAmount === null) return -1;
    if (leftAmount !== rightAmount) return rightAmount - leftAmount;
    return right.submittedAt - left.submittedAt;
  };

/** The amount sort with tokens told apart by symbol, for callers without pricing. */
export const compareActivityByAmount = activityAmountComparator();

/**
 * Reconciles a stored filter against the options the current feed offers: an
 * axis whose chosen value is no longer present resets to `all`. Without this a
 * repaint can leave the state filtering on a value the toolbar no longer shows
 * (the select falls back to its first option), hiding every row while the
 * control reads "All", and nothing the user picks fires a change. The query and
 * the sort are not options and pass through unchanged. Returns the same object
 * when nothing is stale, so a caller can skip writing unchanged state.
 */
export const reconcileActivityFilter = (
  filter: ActivityFilter,
  options: ActivityFilterOptions,
): ActivityFilter => {
  const action =
    filter.action === "all" || options.actions.includes(filter.action) ? filter.action : "all";
  const status =
    filter.status === "all" || options.statuses.includes(filter.status) ? filter.status : "all";
  const token =
    filter.token === "all" || options.tokens.some((candidate) => candidate.key === filter.token)
      ? filter.token
      : "all";
  if (action === filter.action && status === filter.status && token === filter.token) return filter;
  return { ...filter, action, status, token };
};

/** One visible row's facts as the per-counterparty summary needs them. */
export type ActivitySummaryRow = {
  readonly amount: string;
  readonly counterparty: string;
  readonly decimals: number | null;
  readonly direction: string;
  readonly label: string;
  /** The row's status; only a settled transfer adds to the totals. */
  readonly status: string;
  readonly submittedAt: number | null;
  readonly token: string;
  /** The token's identity ({@link activityTokenKey}); totals are keyed by it. */
  readonly tokenKey: string;
};

/** A per-token subtotal of one counterparty's activity. */
type ActivityTokenTotal = {
  readonly received: string;
  readonly sent: string;
  readonly symbol: string;
};

/** The summary shown above the feed when a search resolves one counterparty. */
export type ActivityPartySummary = {
  readonly count: number;
  readonly firstAt: number | null;
  readonly label: string;
  readonly lastAt: number | null;
  readonly totals: readonly ActivityTokenTotal[];
};

// Tolerant decimal reader: the summary must skip a legacy or malformed amount,
// never throw on one. Mirrors parseTokenAmount's grammar without its errors.
const DECIMAL_AMOUNT = /^\d+(?:\.\d+)?$/;
const parseAmountSafe = (amount: string, decimals: number): bigint | null => {
  const trimmed = amount.trim();
  if (!DECIMAL_AMOUNT.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return raw > 0n ? raw : null;
};

/**
 * Summarises the visible rows when they share exactly one counterparty: how
 * many transactions, the total sent and received per token, and the first and
 * last dates. Returns null when the rows name no counterparty or more than one,
 * which is the caller's signal to show no summary. Every visible row is counted,
 * but only an accepted or pre-confirmed one adds to the totals: a reverted,
 * rejected or still pending send moved nothing. A row whose amount cannot be
 * parsed against its token's decimals is counted but contributes no total, and
 * a token with no resolvable decimals is omitted from the totals.
 */
export const activityPartySummary = (
  rows: readonly ActivitySummaryRow[],
): ActivityPartySummary | null => {
  // One counterparty written two ways (with or without leading zeros) is still
  // one counterparty, so the set is keyed by the canonical felt.
  const counterpartyKey = (value: string): string =>
    value ? (canonicalFelt(value) ?? value.toLowerCase()) : "";
  const counterparties = new Set(
    rows.map((row) => counterpartyKey(row.counterparty)).filter(Boolean),
  );
  if (counterparties.size !== 1) return null;
  const first = rows.find((row) => row.counterparty)?.counterparty ?? "";
  const label = rows.find((row) => row.label)?.label ?? first;
  const totals = new Map<string, { readonly key: string; received: bigint; sent: bigint }>();
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const row of rows) {
    if (row.submittedAt !== null) {
      firstAt = firstAt === null ? row.submittedAt : Math.min(firstAt, row.submittedAt);
      lastAt = lastAt === null ? row.submittedAt : Math.max(lastAt, row.submittedAt);
    }
    const movable = row.direction === "in" || row.direction === "out";
    const settled = row.status === "accepted" || row.status === "preconfirmed";
    if (!settled || !row.tokenKey || row.decimals === null || !movable) continue;
    const raw = parseAmountSafe(row.amount, row.decimals);
    if (raw === null) continue;
    const key = row.tokenKey;
    const entry = totals.get(key) ?? { key, received: 0n, sent: 0n };
    if (row.direction === "in") entry.received += raw;
    else entry.sent += raw;
    totals.set(key, entry);
  }
  const decimalsFor = (key: string): number =>
    rows.find((row) => row.tokenKey === key && row.decimals !== null)?.decimals ?? 0;
  const symbolFor = (key: string): string => rows.find((row) => row.tokenKey === key)?.token ?? key;
  return {
    count: rows.length,
    firstAt,
    label,
    lastAt,
    totals: [...totals.values()].map((entry) => ({
      received: formatTokenAmount(entry.received, decimalsFor(entry.key)),
      sent: formatTokenAmount(entry.sent, decimalsFor(entry.key)),
      symbol: symbolFor(entry.key),
    })),
  };
};

/** Reads the summary facts off one visible row's dataset. */
export const activitySummaryRow = (
  dataset: Readonly<Record<string, string | undefined>>,
): ActivitySummaryRow => {
  const decimals = dataset["activityDecimals"];
  const ts = dataset["activityTs"];
  return {
    amount: dataset["activityAmount"] ?? "",
    counterparty: dataset["activityCounterparty"] ?? "",
    decimals: decimals === undefined || decimals === "" ? null : Number(decimals),
    direction: dataset["activityDirection"] ?? "",
    label: dataset["activityCounterpartyLabel"] ?? "",
    status: dataset["activityStatus"] ?? "",
    submittedAt: ts === undefined || ts === "" ? null : Number(ts),
    token: dataset["activityToken"] ?? "",
    tokenKey: dataset["activityTokenKey"] ?? "",
  };
};

/**
 * The per-counterparty summary as plain text: the resolved name (or the
 * counterparty address when no name resolves) and the joined detail lines. The
 * caller writes both with `textContent`, so no markup path is involved.
 */
export const activityPartySummaryParts = (
  summary: ActivityPartySummary,
): { readonly body: string; readonly label: string } => {
  const lines = [`${summary.count} transaction${summary.count === 1 ? "" : "s"}`];
  for (const total of summary.totals) {
    if (total.sent !== "0") lines.push(`Sent ${total.sent} ${total.symbol}`);
    if (total.received !== "0") lines.push(`Received ${total.received} ${total.symbol}`);
  }
  const from = summary.firstAt === null ? null : formatUtcDate(summary.firstAt);
  const to = summary.lastAt === null ? null : formatUtcDate(summary.lastAt);
  if (from && to) lines.push(from === to ? from : `${from} to ${to}`);
  return { body: lines.join(" · "), label: summary.label };
};
