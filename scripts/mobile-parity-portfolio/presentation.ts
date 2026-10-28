/**
 * Presentation parity blocks: Activity rows through the real `activityRowModel` and
 * `transactionGroups` renderers, header freshness copy, UTC timestamps, sparklines and explorer
 * links.
 */
import { friendlyNetworkError } from "@bramble/core/network-error";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { explorerAccountUrl, explorerTransactionUrl } from "@bramble/wallet-model/networks";
import { withTokenId } from "@bramble/wallet-model/preferences";
import {
  activityRowModel,
  compactSummary,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-format";
import {
  activityEmptyCopy,
  transactionGroups,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-tabs";
import {
  sparklinePath,
  sparklineTrend,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/sparkline";
import { networkDataIssue } from "../../packages/presentation/wallet-ui/src/sidepanel/shared/network-status";
import {
  formatUtcClock,
  formatUtcDate,
  formatUtcDay,
  utcDayKey,
} from "../../packages/presentation/wallet-ui/src/sidepanel/shared/timestamp";
import { HISTORY_ACCOUNT } from "./history";
import { firstMatch, readGlyph, unescapeHtml } from "./shared";

const ACCOUNT_ID = `SN_MAIN:${HISTORY_ACCOUNT}`;
const PEER = "0x5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";
const STRK = withTokenId({
  address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
});
const ETH = withTokenId({
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
});
const DUP_A = withTokenId({
  address: "0x0aaa",
  decimals: 6,
  name: "Dup A",
  networkId: "SN_MAIN",
  symbol: "DUP",
});
const DUP_B = withTokenId({
  address: "0x0bbb",
  decimals: 6,
  name: "Dup B",
  networkId: "SN_MAIN",
  symbol: "DUP",
});
const SEPOLIA_STRK = withTokenId({
  address: STRK.address,
  decimals: 18,
  name: "Sepolia Starknet Token",
  networkId: "SN_SEPOLIA",
  symbol: "STRK",
});
const DAY = 86_400_000;
/** The fixed "now" the Activity groups are rendered at (2026-09-24T12:00:00Z). */
export const ACTIVITY_NOW = 1_790_251_200_000;

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  accountId: ACCOUNT_ID,
  hash: "0x1",
  kind: "invoke",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: ACTIVITY_NOW - 1_000,
  summary: "Interacted",
  ...over,
});

const corpus = (): ActivityEntry[] => [
  entry({
    amount: "1.5",
    counterparty: PEER,
    hash: "0xa1",
    kind: "transfer",
    summary: `Received 1.5 STRK from 0x5a1b…7e8f`,
    token: "STRK",
  }),
  entry({
    amount: "0.123456789",
    counterparty: "0x12",
    hash: "0xa2",
    kind: "transfer",
    status: "pending",
    summary: "Sent 0.123456789 ETH to 0x12…0x12",
    token: "ETH",
  }),
  entry({
    amount: "1",
    hash: "0xa3",
    status: "preconfirmed",
    summary: "Swap 1 STRK for ~2.5 USDC via AVNU",
    token: "STRK",
  }),
  entry({ amount: "100", hash: "0xa4", summary: "Stake 100 STRK with Karnot", token: "strk" }),
  entry({
    amount: "50",
    hash: "0xa5",
    submittedAt: ACTIVITY_NOW - DAY,
    summary: "Unstake 50 STRK",
    token: "STRK",
  }),
  entry({
    amount: "1.23456789",
    hash: "0xa6",
    submittedAt: ACTIVITY_NOW - DAY - 5_000,
    summary: "Claimed staking rewards 1.23456789 STRK",
    token: "STRK",
  }),
  entry({
    amount: "5",
    hash: "0xa7",
    submittedAt: ACTIVITY_NOW - 2 * DAY,
    summary: "Shield 5 STRK",
    token: "STRK",
  }),
  entry({
    amount: "5",
    hash: "0xa8",
    submittedAt: ACTIVITY_NOW - 2 * DAY,
    summary: "Unshield 5 STRK to 0x1234…abcd",
    token: "STRK",
  }),
  entry({
    amount: "3",
    hash: "0xa9",
    submittedAt: ACTIVITY_NOW - 2 * DAY,
    summary: "Send 3 STRK privately to 0xabc…1234",
    token: "STRK",
  }),
  entry({
    counterparty: PEER,
    hash: "0xaa",
    submittedAt: ACTIVITY_NOW - 9 * DAY,
    summary: "Approve unlimited USDC for 0x5a1b…7e8f",
  }),
  entry({
    hash: "0xab",
    status: "rejected",
    submittedAt: ACTIVITY_NOW - 9 * DAY,
    summary: "Revoke approval for USDC",
  }),
  entry({
    hash: "0xac",
    kind: "deploy",
    status: "reverted",
    submittedAt: ACTIVITY_NOW - 40 * DAY,
    summary: "Deploy account",
  }),
  entry({
    hash: "0xad",
    kind: "declare",
    submittedAt: ACTIVITY_NOW - 400 * DAY,
    summary: "Declare class 0x123",
  }),
  entry({
    hash: "0xae",
    submittedAt: ACTIVITY_NOW - 400 * DAY,
    summary: "Called 12.3456789 things on 0x1234 and v1.23456",
  }),
  entry({
    amount: "1234.123456789",
    counterparty: PEER,
    hash: "0xaf",
    kind: "transfer",
    submittedAt: 0,
    summary: "Received 1234.123456789 ETH from 0x5a1b…7e8f",
    token: "ETH",
  }),
  entry({
    amount: "7",
    hash: "0xb0",
    kind: "transfer",
    submittedAt: 0,
    summary: "Sent 7 DUP to 0x9",
    token: "DUP",
  }),
  entry({
    amount: "abc",
    hash: "0xb1",
    kind: "transfer",
    submittedAt: 0,
    summary: "received something",
    token: "STRK",
  }),
  entry({
    hash: "0xB2",
    kind: "transfer",
    submittedAt: 0,
    summary: "Delegated 10 STRK",
    token: "STRK",
  }),
  entry({
    amount: " 2 ",
    counterparty: "  ",
    hash: "0xb3",
    kind: "transfer",
    submittedAt: 0,
    summary: "Swapping 2 ETH for at least 5000 STRK",
    token: " ETH ",
  }),
];

// One attribute of a tag, whatever order the renderer writes them in.
const attr = (tag: string, name: string): string | null =>
  firstMatch(tag, new RegExp(`\\s${name}="([^"]*)"`));

// The inline copy control inside `html`: its accessible name and the value it copies.
const copyControl = (html: string) => {
  const tag = /<button[^>]*\bcopy-inline\b[^>]*>/.exec(html)?.[0] ?? "";
  return { label: attr(tag, "aria-label"), value: attr(tag, "data-copy") };
};

// A `<dt>label</dt><dd>…</dd>` fact from the row's expansion.
const fact = (body: string, label: string): string | null => {
  const dd = new RegExp(`<div><dt>${label}</dt><dd>([\\s\\S]*?)</dd></div>`).exec(body)?.[1];
  return dd === undefined ? null : unescapeHtml(dd.replace(/<[^>]+>/g, "").trim());
};

// The row as `transactionRow` renders it: a disclosure whose summary carries the heading, the
// status word and the token mark, and whose body holds the hash and its copy control (the
// "Transaction" fact, since 93826d23), the counterparty (or detail), the submission time and the
// provisional-status hint.
const readRow = (html: string) => {
  const summaryTag = /<summary[^>]*>/.exec(html)?.[0] ?? "";
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "";
  const body = /<div class="disclosure-body">([\s\S]*?)<\/div>\s*<\/details>/.exec(html)?.[1] ?? "";
  const hashRow = /<dd class="tx-hash-row">([\s\S]*?)<\/dd>/.exec(body)?.[1] ?? "";
  const facts = body.replace(/<dd class="tx-hash-row">[\s\S]*?<\/dd>/, "");
  const hashLink = /<a class="tx-hash"[^>]*>/.exec(hashRow)?.[0] ?? "";
  const counterparty = /<div><dt>([A-Z][a-z]+)<\/dt><dd><code title="([^"]*)">([^<]*)<\/code>/.exec(
    body,
  );
  const hash = copyControl(hashRow);
  const peer = copyControl(facts);
  return {
    accessible: attr(summaryTag, "aria-label"),
    avatar: readGlyph(
      /<span class="tx-avatar">([\s\S]*?)<\/span>\s*<span class="disclosure-mark">/.exec(
        summary,
      )?.[1] ?? "",
    ),
    counterparty: counterparty
      ? {
          address: unescapeHtml(counterparty[2] ?? ""),
          copyLabel: peer.label,
          copyValue: peer.value,
          label: unescapeHtml(counterparty[3] ?? ""),
          role: counterparty[1] ?? "",
        }
      : null,
    detail: fact(body, "Detail"),
    glyphTitle: firstMatch(
      summary,
      /<span class="tx-kind-icon[^"]*" aria-hidden="true" title="([^"]*)"/,
    ),
    hash: firstMatch(hashRow, /class="tx-hash(?: is-plain)?"[^>]*>(?:<code>)?([^<]*)</),
    hashCopyLabel: hash.label,
    hashCopyValue: hash.value,
    href: attr(hashLink, "href"),
    meta: firstMatch(summary, /<span class="tx-meta [a-z]+">([^<]*)<\/span>/),
    statusHint: fact(body, "Status"),
    submitted: fact(body, "Submitted"),
    timing: firstMatch(html, /<li class="tx-row" data-live-group title="([^"]*)"/),
    title: firstMatch(summary, /<strong class="tx-title">([^<]*)<\/strong>/),
  };
};

/** Activity rows and day groups for a summary corpus covering every appearance rule. */
export const appearanceBlock = () => {
  const entries = corpus();
  const tokens = [STRK, ETH, DUP_A, DUP_B, SEPOLIA_STRK];
  return (["usd", "gbp"] as const).map((currency) => {
    const prices = { [STRK.address]: 0.5, [ETH.address]: 2500.25, [DUP_A.address]: 1 };
    const pricing = { currency, prices, tokens };
    const html = transactionGroups(entries, pricing, utcDayKey(ACTIVITY_NOW));
    const headings = [...html.matchAll(/<h3 class="tx-day-label">([^<]*)<\/h3>/g)].map((m) =>
      unescapeHtml(m[1] ?? ""),
    );
    const rows = html
      .split('<li class="tx-row"')
      .slice(1)
      .map((part) => readRow(`<li class="tx-row"${part}`));
    return {
      currency,
      entries,
      headings,
      models: entries.map((e) => activityRowModel(e, pricing)),
      prices,
      rows,
      sizes: [...html.matchAll(/<ul class="tx-list">([\s\S]*?)<\/ul><\/section>/g)].map(
        (m) => (m[1]?.match(/<li class="tx-row"/g) ?? []).length,
      ),
      tokens,
    };
  });
};

/** Header freshness copy, friendly errors, empty copy, timestamps, sparklines, links, summaries. */
export const statusBlock = () => ({
  compactSummary: [
    "Received 1.234567 STRK and 0.1234567 ETH",
    "v1.23456 build",
    "Sent 1,234.567891 STRK",
    "1.23456.",
    "x1.23456",
    "Nothing to trim 1.2345",
  ].map((value) => ({ out: compactSummary(value), value })),
  empty: [true, false].map((unavailable) => ({ out: activityEmptyCopy(unavailable), unavailable })),
  explorer: ["0x00ab", "0xab", "0x0", "0xAB", "ab", `0x${"f".repeat(64)}`].flatMap((felt) =>
    (["SN_MAIN", "SN_SEPOLIA"] as const).map((networkId) => ({
      account: explorerAccountUrl(networkId, felt),
      felt,
      networkId,
      tx: explorerTransactionUrl(networkId, felt),
    })),
  ),
  friendly: [
    "TypeError: Failed to fetch",
    "fetch failed",
    "Request timed out",
    "invalid add token request",
    "ECONNREFUSED 127.0.0.1",
    "",
  ].map((raw) => ({ out: friendlyNetworkError(raw), raw })),
  issues: [
    { balances: { error: "x" }, hasPrices: false, priceAsOf: null, priceStale: false },
    {
      balances: { asOf: 1_790_000_000_000, balances: [], stale: true },
      hasPrices: true,
      priceAsOf: 1_789_990_000_000,
      priceStale: true,
    },
    {
      balances: { balances: [], stale: true },
      hasPrices: false,
      priceAsOf: null,
      priceStale: true,
    },
    { balances: { balances: [] }, hasPrices: true, priceAsOf: null, priceStale: true },
    { balances: { balances: [] }, hasPrices: true, priceAsOf: 5, priceStale: false },
  ].map((c) => ({
    ...c,
    out: networkDataIssue(c.balances as never, c.priceStale, c.priceAsOf, c.hasPrices).join(" "),
  })),
  sparklines: [
    [1, 3, 2],
    [1, 1, 1],
    [5],
    [2, Number.NaN, 1],
    [0.1, 0.2, 0.30000000000000004, 0.15],
    [3, 2, 1, 0.5, 0.25, 0.125, 7],
  ].map((points) => ({
    path: sparklinePath(points, 100, 32),
    points: points.map((p) => (Number.isFinite(p) ? p : null)),
    trend: sparklineTrend(points),
  })),
  times: [
    1, 86_399_999, 1_788_566_820_000, 951_782_400_000, 253_402_300_799_000, 253_402_300_800_000, 0,
    -5, 8.64e15, 1.5, 1_790_251_199_999,
  ].map((ms) => ({
    clock: formatUtcClock(ms),
    date: formatUtcDate(ms),
    day: formatUtcDay(ms),
    ms,
  })),
});
