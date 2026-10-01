/**
 * History parity blocks: the real Starkscan client and `getStarkscanTransactionHistory` over
 * scripted pages (request shape, parsing, rows, cooldowns), `parseRetryAfterMilliseconds`,
 * `decodeTransferEvent`, `collectTransactionHistory` over a scripted chain, and the activity
 * id/validator/merge rules.
 */
import { WalletError } from "@bramble/core/errors";
import { parseRetryAfterMilliseconds } from "@bramble/core/http-json";
import { isActivityEntry } from "@bramble/transactions/activity";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { getStarkscanTransactionHistory } from "@bramble/transactions/starkscan-wallet";
import type { HistoryEvent } from "@bramble/transactions/tx-history";
import {
  decodeTransferEvent,
  mergeActivity,
  onChainActivityEntry,
  TRANSFER_EVENT_KEY,
} from "@bramble/transactions/tx-history";
import {
  collectTransactionHistory,
  type HistoryEventFilter,
} from "@bramble/transactions/tx-history-scan";
import { canonicalAccountId } from "@bramble/wallet-model/accounts";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { DEFAULT_EXPLORER_API_URL } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { scriptedClock } from "./shared";

/** The account every history case is read for (the published E2E account; public). */
export const HISTORY_ACCOUNT = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";
const ACCOUNT_ID = `SN_MAIN:${HISTORY_ACCOUNT}`;
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
const PEER = "0x5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";
const TRACKED = [STRK, ETH];

const transfer = (over: Record<string, unknown> = {}) => ({
  actionContext: null,
  amount: "1500000000000000000",
  blockNumber: 900,
  fromAddress: PEER,
  logIndex: 0,
  rawValue: "1500000000000000000",
  sourceTier: "finalized",
  standard: "erc20",
  timestampIso: "2026-09-20T10:15:30.250Z",
  toAddress: HISTORY_ACCOUNT,
  tokenAddress: STRK.address,
  tokenDecimals: 18,
  tokenId: null,
  tokenName: "Starknet Token",
  tokenSymbol: "STRK",
  transferIndex: 0,
  txHash: "0x0abc",
  txIndex: 1,
  ...over,
});
const page = (items: readonly unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ items, nextCursor: null, ...extra });

/** Starkscan request, pages, rows, cooldowns, and Retry-After. */
export const starkscanBlock = async () => {
  const input = {
    account: HISTORY_ACCOUNT,
    accountId: ACCOUNT_ID,
    networkId: "SN_MAIN" as const,
    rpcUrls: [],
    tokens: TRACKED,
  };
  // `repeat`: the page's single item is served that many times (kept out of the fixture text).
  const pages: { name: string; body: string; status?: number; repeat?: number }[] = [
    {
      body: page([
        transfer(),
        transfer({
          fromAddress: HISTORY_ACCOUNT,
          toAddress: PEER,
          txHash: "0x0def",
          amount: null,
          rawValue: "250000000000000000",
          timestampIso: "2026-09-21T08:00:00Z",
          tokenAddress: ETH.address.replace("0x0", "0x"),
        }),
        transfer({
          tokenAddress: "0x0777",
          tokenDecimals: 6,
          amount: "1234567",
          txHash: "0x1111",
          timestampIso: "2026-09-19T00:00:00+02:00",
        }),
        transfer({ tokenAddress: "0x0778", tokenDecimals: null, txHash: "0x2222" }),
        transfer({ standard: "erc721", txHash: "0x3333" }),
        transfer({ fromAddress: PEER, toAddress: "0x99", txHash: "0x4444" }),
        transfer(),
        transfer({ txHash: "0X0ABC", amount: "2", timestampIso: "2026-09-20" }),
        transfer({
          fromAddress: "4660",
          toAddress: HISTORY_ACCOUNT.replace("0x", "0X"),
          txHash: "0x5555",
        }),
      ]),
      name: "mixed rows",
    },
    { body: page([]), name: "empty page" },
    { body: page([transfer({ txHash: "0xzz" })]), name: "bad felt" },
    { body: page([transfer({ amount: "01" })]), name: "bad decimal" },
    { body: page([transfer({ tokenSymbol: "x".repeat(65) })]), name: "long symbol" },
    { body: page([transfer({ blockNumber: 1.5 })]), name: "fractional block" },
    { body: page([transfer({ standard: "erc404" })]), name: "unknown standard" },
    { body: JSON.stringify({ items: [transfer()] }), name: "missing cursor" },
    { body: page([transfer()]), name: "too many items", repeat: 201 },
    { body: page([transfer({ timestampIso: "not a date" })]), name: "unparseable time" },
    { body: "not json", name: "not json" },
    { body: page([transfer()]), name: "http 404", status: 404 },
  ];
  const seen: string[] = [];
  const headers: Record<string, string>[] = [];
  const results = [];
  for (const c of pages) {
    const client = createStarkscanClient({
      baseUrl: DEFAULT_EXPLORER_API_URL,
      http: async (url, init) => {
        seen.push(url);
        headers.push({ ...(init.headers as Record<string, string>) });
        const served =
          c.repeat === undefined
            ? c.body
            : page(Array.from({ length: c.repeat }, () => transfer()));
        return new Response(served, { status: c.status ?? 200 });
      },
    });
    try {
      results.push({ ...c, out: await getStarkscanTransactionHistory(client, input) });
    } catch {
      results.push({ ...c, out: null });
    }
  }
  const probes = [1, 11_999, 12_000, 29_999, 30_000, 59_999, 60_000, 299_999, 300_000];
  const outcomes: {
    name: string;
    status: number | null;
    retryAfter: string | null;
    body: string;
  }[] = [
    { body: "{}", name: "rate limited", retryAfter: "12", status: 429 },
    { body: "{}", name: "rate limited, no header", retryAfter: null, status: 429 },
    { body: "{}", name: "rate limited, long", retryAfter: "3600", status: 429 },
    {
      body: "{}",
      name: "unavailable, date",
      retryAfter: "Thu, 01 Jan 1970 00:01:00 GMT",
      status: 503,
    },
    { body: "{}", name: "server error", retryAfter: null, status: 500 },
    { body: "{}", name: "not found", retryAfter: "12", status: 404 },
    { body: "{}", name: "bad request", retryAfter: null, status: 400 },
    { body: "not json", name: "invalid body", retryAfter: "12", status: 200 },
    { body: "", name: "transport", retryAfter: null, status: null },
  ];
  const cooldowns = [];
  for (const outcome of outcomes) {
    const blocked = [];
    for (const offset of probes) {
      const clock = scriptedClock(0);
      let calls = 0;
      const client = createStarkscanClient({
        baseUrl: DEFAULT_EXPLORER_API_URL,
        http: async () => {
          calls += 1;
          if (outcome.status === null) throw new TypeError("fetch failed");
          return new Response(outcome.body, {
            headers: outcome.retryAfter === null ? {} : { "retry-after": outcome.retryAfter },
            status: outcome.status,
          });
        },
        now: clock.read,
        wallClock: clock.read,
      });
      await getStarkscanTransactionHistory(client, input).catch(() => undefined);
      clock.now = offset;
      await getStarkscanTransactionHistory(client, input).catch(() => undefined);
      blocked.push(calls === 1);
    }
    cooldowns.push({ ...outcome, blocked });
  }
  return {
    cooldowns,
    pages: results,
    probes,
    request: { headers: headers[0], url: seen[0] },
    // `narrowed`: an HTTP-date spelling other than IMF-fixdate, which mobile reads as absent
    // (the 30 s default) where JavaScriptCore's `Date.parse` may accept it (design §3.5).
    retryAfter: [
      ["12", false],
      [" 7 ", false],
      ["0", false],
      ["012", false],
      ["1.5", false],
      ["0x10", false],
      ["", false],
      ["Thu, 01 Jan 1970 00:20:00 GMT", false],
      ["Thu, 01 Jan 1970 00:00:00 GMT", false],
      ["soon", false],
      ["99999999999999999999", false],
      ["Thursday, 01-Jan-70 00:20:00 GMT", true],
    ].map(([value, narrowed]) => ({
      narrowed,
      out: parseRetryAfterMilliseconds(String(value), 1_000_000),
      value,
    })),
    tracked: TRACKED,
  };
};

const event = (over: Record<string, unknown> = {}) => ({
  block_number: 100,
  data: ["0x10", "0x0"],
  keys: [TRANSFER_EVENT_KEY, PEER, HISTORY_ACCOUNT],
  transaction_hash: "0x0aaa",
  ...over,
});

/** A scripted chain: getEvents pages by (token, filter, from block, continuation) and timestamps. */
export type ScriptedChain = {
  readonly latest: number;
  readonly pages: Readonly<
    Record<
      string,
      { readonly events: readonly unknown[]; readonly continuation_token?: string } | "semantic"
    >
  >;
  readonly timestamps: Readonly<Record<string, number | null>>;
};

// The key a scripted chain answers a `getEvents` filter by.
const chainKey = (
  address: string,
  keysLength: number,
  fromBlock: number,
  continuation: string | undefined,
): string => `${address}|${keysLength - 2}|${fromBlock}|${continuation ?? ""}`;

const runChain = async (chain: ScriptedChain, tokens: readonly (typeof STRK)[]) =>
  collectTransactionHistory(
    {
      async getBlockTimestamp(block) {
        return chain.timestamps[String(block)] ?? null;
      },
      async getEvents(filter: HistoryEventFilter) {
        const found =
          chain.pages[
            chainKey(
              filter.address,
              filter.keys.length,
              filter.from_block,
              filter.continuation_token,
            )
          ];
        if (found === "semantic") throw new WalletError("node error");
        return (found ?? { events: [] }) as { readonly events: readonly HistoryEvent[] };
      },
      async getLatestBlockNumber() {
        return chain.latest;
      },
    },
    { account: HISTORY_ACCOUNT, accountId: ACCOUNT_ID, networkId: "SN_MAIN", tokens },
  );

/** `decodeTransferEvent` cases and scripted-chain scans. */
export const eventsBlock = async () => {
  const latest = 500_000;
  const from = latest - 200_000;
  const recent = latest - 20_000;
  const out = (block: number, hash: string, amount = "0x10") =>
    event({
      block_number: block,
      data: [amount, "0x0"],
      keys: [TRANSFER_EVENT_KEY, HISTORY_ACCOUNT, PEER],
      transaction_hash: hash,
    });
  const into = (block: number, hash: string) =>
    event({ block_number: block, transaction_hash: hash });
  const full: ScriptedChain = {
    latest,
    pages: {
      [chainKey(STRK.address, 2, from, undefined)]: {
        events: [out(450_000, "0x1"), event({ keys: [TRANSFER_EVENT_KEY, PEER, PEER] })],
      },
      [chainKey(STRK.address, 3, from, undefined)]: {
        events: [
          into(460_000, "0x2"),
          event({
            block_number: 470_000,
            keys: [TRANSFER_EVENT_KEY, HISTORY_ACCOUNT, HISTORY_ACCOUNT],
            transaction_hash: "0x3",
          }),
        ],
      },
      [chainKey(ETH.address, 2, from, undefined)]: {
        continuation_token: "a",
        events: [out(310_000, "0x4")],
      },
      [chainKey(ETH.address, 2, from, "a")]: {
        continuation_token: "b",
        events: [out(320_000, "0x5")],
      },
      [chainKey(ETH.address, 2, from, "b")]: {
        continuation_token: "c",
        events: [out(330_000, "0x6")],
      },
      [chainKey(ETH.address, 2, recent, undefined)]: {
        events: [out(490_000, "0x7", "0x1bc16d674ec80000")],
      },
      [chainKey(ETH.address, 3, from, undefined)]: "semantic",
    },
    timestamps: {
      "450000": 1_788_000_000,
      "460000": 1_788_100_000,
      "470000": 1_788_200_000,
      "490000": 1_788_300_000,
    },
  };
  const many: ScriptedChain = {
    latest,
    pages: {
      [chainKey(STRK.address, 2, from, undefined)]: {
        events: Array.from({ length: 30 }, (_, i) =>
          out(400_000 + i, `0x${(i + 16).toString(16)}`),
        ),
      },
    },
    timestamps: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        String(400_000 + i),
        i === 29 ? null : i === 28 ? -5 : 1_788_000_000 + i,
      ]),
    ),
  };
  const bad = withTokenId({
    address: "0x0",
    decimals: 18,
    name: "Zero",
    networkId: "SN_MAIN",
    symbol: "ZERO",
  });
  return {
    decode: [
      event(),
      event({ keys: [TRANSFER_EVENT_KEY], data: [PEER, HISTORY_ACCOUNT, "0x5", "0x0"] }),
      event({ keys: [TRANSFER_EVENT_KEY, HISTORY_ACCOUNT, "0x0"] }),
      event({ data: [`0x1${"0".repeat(32)}`, "0x0"] }),
      event({ data: ["0x1", `0x1${"0".repeat(32)}`] }),
      event({ data: ["-1", "0x0"] }),
      event({ keys: ["0x1234", PEER, HISTORY_ACCOUNT] }),
      event({ transaction_hash: 12 }),
      event({ block_number: -1 }),
      event({ block_number: "7" }),
      event({ keys: "nope" }),
      event({
        keys: [TRANSFER_EVENT_KEY, "171", HISTORY_ACCOUNT.toUpperCase().replace("0X", "0x")],
        transaction_hash: "4660",
      }),
      event({ keys: [TRANSFER_EVENT_KEY, PEER, "0x99"] }),
      event({ keys: [TRANSFER_EVENT_KEY, `0x${"f".repeat(64)}`, HISTORY_ACCOUNT] }),
    ].map((value) => ({ event: value, out: decodeTransferEvent(value, HISTORY_ACCOUNT) })),
    scans: [
      {
        chain: full,
        name: "two tokens, truncation, semantic skip",
        out: await runChain(full, [STRK, ETH]),
        tokens: [STRK, ETH],
      },
      { chain: many, name: "cap and undated", out: await runChain(many, [STRK]), tokens: [STRK] },
      {
        chain: { latest: 10, pages: {}, timestamps: {} },
        name: "skipped token",
        out: await runChain({ latest: 10, pages: {}, timestamps: {} }, [bad]),
        tokens: [bad],
      },
    ],
  };
};

/** Account ids, the entry validator, on-chain rows and the merge. */
export const activityBlock = () => {
  const base = onChainActivityEntry({
    accountId: ACCOUNT_ID,
    decoded: {
      amountRaw: "1234500000000000000000",
      blockNumber: 1,
      counterparty: PEER,
      direction: "in",
      hash: "0xabc",
    },
    networkId: "SN_MAIN",
    timestampMs: 1_788_000_000_000,
    token: STRK,
  });
  const sent = onChainActivityEntry({
    accountId: ACCOUNT_ID,
    decoded: {
      amountRaw: "5",
      blockNumber: 1,
      counterparty: "0x12",
      direction: "out",
      hash: "0xdef",
    },
    networkId: "SN_MAIN",
    timestampMs: 1_788_100_000_000,
    token: withTokenId({
      address: "0x0abc",
      decimals: 0,
      name: "Whole",
      networkId: "SN_MAIN",
      symbol: "WHOLE",
    }),
  });
  const local = {
    ...base,
    hash: "0x0abc",
    status: "pending" as const,
    summary: "Send 1.2345 STRK to 0x5a1b…7e8f",
    submittedAt: 1_700_000_000_000,
  };
  const failed = {
    ...sent,
    hash: "0xdef",
    status: "reverted" as const,
    summary: "Swap 1 STRK for ~2 USDC",
  };
  return {
    entries: [
      base,
      { ...base, accountId: "SN_MAIN:0x0208" },
      { ...base, accountId: "SN_SEPOLIA:0x208" },
      { ...base, hash: "0xABC" },
      { ...base, summary: "" },
      { ...base, summary: "x".repeat(201) },
      { ...base, token: "" },
      { ...base, submittedAt: -1 },
      { ...base, submittedAt: 1.5 },
      { ...base, extra: 1 },
      { ...base, status: "unknown" },
      { ...base, failureNotice: "pending", finalizedOnL1: true, notFoundCount: 3 },
      { ...base, notFoundCount: -1 },
      { ...base, kind: "declare" },
    ].map((value) => ({ out: isActivityEntry(value), value })),
    ids: [
      "SN_MAIN:0x00ab",
      "SN_MAIN:0xab",
      "SN_SEPOLIA:0x0",
      "SN_DEVNET:0xab",
      "SN_MAIN:0xAB",
      "SN_MAIN",
      "SN_MAIN:0xab:x",
      "0xab",
    ].map((value) => ({ out: canonicalAccountId(value), value })),
    merge: [
      {
        local: [local],
        onChain: [base, { ...base, amount: "9", summary: "Received 9 STRK from 0x5a1b…7e8f" }],
      },
      { local: [failed], onChain: [sent, base, base, { ...base, token: "ETH" }] },
      { local: [], onChain: [sent, base] },
    ].map((c) => ({ ...c, out: mergeActivity(c.local, c.onChain) })),
    onChain: [base, sent],
  };
};
