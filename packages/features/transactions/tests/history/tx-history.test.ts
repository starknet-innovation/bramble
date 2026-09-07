/**
 * Pure on-chain history checks: decoding real ERC20 `Transfer` events (both the
 * Cairo 1 indexed-key layout and the legacy data-only layout) into direction,
 * counterparty, and amount; folding a decoded transfer into a canonical activity
 * entry; and merging chain history with the local log de-duplicated by hash.
 */
import { describe, expect, test } from "bun:test";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { isActivityEntry } from "@bramble/transactions/activity";
import {
  decodeTransferEvent,
  type HistoryEvent,
  mergeActivity,
  onChainActivityEntry,
  TRANSFER_EVENT_KEY,
} from "@bramble/transactions/tx-history";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER = "0x0777000000000000000000000000000000000000000000000000000000000abc";
const ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const eth: TokenConfig = {
  address: ETH_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH_ADDRESS}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

// A Cairo 1 ERC20 Transfer event: from/to are indexed keys, the uint256 amount
// (1.5 ETH) sits in data as [low, high].
const cairo1Transfer = (from: string, to: string, hash: string): HistoryEvent => ({
  block_number: 42,
  data: ["1500000000000000000", "0"],
  keys: [TRANSFER_EVENT_KEY, from, to],
  transaction_hash: hash,
});

// A legacy ERC20 Transfer event: only the selector is a key, from/to/amount sit
// in data.
const legacyTransfer = (from: string, to: string, hash: string): HistoryEvent => ({
  block_number: 7,
  data: [from, to, "2000000000000000000", "0"],
  keys: [TRANSFER_EVENT_KEY],
  transaction_hash: hash,
});

describe("decodeTransferEvent", () => {
  test("decodes an outgoing Cairo 1 transfer relative to the account", () => {
    const decoded = decodeTransferEvent(cairo1Transfer(ACCOUNT, OTHER, "0x7ab"), ACCOUNT);
    expect(decoded).not.toBeNull();
    expect(decoded?.direction).toBe("out");
    expect(sameFelt(decoded?.counterparty ?? "", OTHER)).toBe(true);
    expect(decoded?.amountRaw).toBe("1500000000000000000");
    expect(decoded?.blockNumber).toBe(42);
    expect(decoded?.hash).toBe("0x7ab");
  });

  test("decodes an incoming legacy transfer relative to the account", () => {
    const decoded = decodeTransferEvent(legacyTransfer(OTHER, ACCOUNT, "0x7cd"), ACCOUNT);
    expect(decoded?.direction).toBe("in");
    expect(sameFelt(decoded?.counterparty ?? "", OTHER)).toBe(true);
    expect(decoded?.amountRaw).toBe("2000000000000000000");
  });

  test("ignores events that do not touch the account or are not transfers", () => {
    expect(decodeTransferEvent(cairo1Transfer(OTHER, OTHER, "0x1"), ACCOUNT)).toBeNull();
    expect(
      decodeTransferEvent(
        { ...cairo1Transfer(ACCOUNT, OTHER, "0x1"), keys: ["0xdead", ACCOUNT, OTHER] },
        ACCOUNT,
      ),
    ).toBeNull();
  });

  test("is total over a structurally malformed event (non-array keys/data) — skipped, not thrown", () => {
    // A hostile RPC returning keys/data that are not arrays must be skipped like
    // any non-transfer, never throw (which would be misread as a transport error
    // and blank the whole token's history).
    const bad = { block_number: 1, transaction_hash: "0x1" };
    expect(
      decodeTransferEvent(
        { ...bad, keys: null, data: ["1", "0"] } as unknown as HistoryEvent,
        ACCOUNT,
      ),
    ).toBeNull();
    expect(
      decodeTransferEvent(
        {
          ...bad,
          keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER],
          data: null,
        } as unknown as HistoryEvent,
        ACCOUNT,
      ),
    ).toBeNull();
  });

  test("rejects a transfer whose counterparty is not a Stark field element", () => {
    // An out-of-field-range (oversized) counterparty felt is canonicalizable but
    // not a valid field element; it must be rejected like an invalid hash.
    const oversized = `0x${"f".repeat(70)}`;
    expect(decodeTransferEvent(cairo1Transfer(ACCOUNT, oversized, "0x1"), ACCOUNT)).toBeNull();
  });

  test("keeps a mint (zero-address counterparty) as valid received activity", () => {
    const decoded = decodeTransferEvent(cairo1Transfer("0x0", ACCOUNT, "0x1"), ACCOUNT);
    expect(decoded?.direction).toBe("in");
    expect(sameFelt(decoded?.counterparty ?? "x", "0x0")).toBe(true);
  });

  test("rejects malformed events (bad amount, missing hash, no block)", () => {
    expect(
      decodeTransferEvent(
        {
          block_number: 1,
          data: ["notanum", "0"],
          keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER],
          transaction_hash: "0x1",
        },
        ACCOUNT,
      ),
    ).toBeNull();
    expect(
      decodeTransferEvent(
        { block_number: 1, data: ["1", "0"], keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER] },
        ACCOUNT,
      ),
    ).toBeNull();
    expect(
      decodeTransferEvent(
        { data: ["1", "0"], keys: [TRANSFER_EVENT_KEY, ACCOUNT, OTHER], transaction_hash: "0x1" },
        ACCOUNT,
      ),
    ).toBeNull();
  });
});

describe("onChainActivityEntry", () => {
  test("builds a canonical, boundary-valid accepted entry with a decoded summary", () => {
    const decoded = decodeTransferEvent(cairo1Transfer(ACCOUNT, OTHER, "0x7ab"), ACCOUNT);
    if (!decoded) {
      throw new Error("expected a decoded transfer");
    }
    const entry = onChainActivityEntry({
      accountId: `SN_MAIN:${ACCOUNT}`,
      decoded,
      networkId: "SN_MAIN",
      timestampMs: 1_700_000_000_000,
      token: eth,
    });
    expect(isActivityEntry(entry)).toBe(true);
    expect(entry.status).toBe("accepted");
    expect(entry.kind).toBe("transfer");
    expect(entry.submittedAt).toBe(1_700_000_000_000);
    expect(entry.amount).toBe("1.5");
    expect(entry.token).toBe("ETH");
    expect(entry.summary).toBe("Sent 1.5 ETH to 0x7770…0abc");
  });

  test("names the counterparty as the sender for an incoming transfer", () => {
    const decoded = decodeTransferEvent(legacyTransfer(OTHER, ACCOUNT, "0x7cd"), ACCOUNT);
    if (!decoded) {
      throw new Error("expected a decoded transfer");
    }
    const entry = onChainActivityEntry({
      accountId: `SN_MAIN:${ACCOUNT}`,
      decoded,
      networkId: "SN_MAIN",
      timestampMs: 1_700_000_000_000,
      token: eth,
    });
    expect(entry.summary).toBe("Received 2 ETH from 0x7770…0abc");
  });
});

const localEntry = (
  hash: string,
  submittedAt: number,
  status: ActivityEntry["status"],
): ActivityEntry => ({
  accountId: `SN_MAIN:${ACCOUNT}`,
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status,
  submittedAt,
  summary: `Send from wallet ${hash}`,
});

const chainEntry = (hash: string, submittedAt: number): ActivityEntry => ({
  accountId: `SN_MAIN:${ACCOUNT}`,
  amount: "1",
  counterparty: OTHER,
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt,
  summary: `Received 1 ETH from 0x7770…0abc`,
  token: "ETH",
});

// One transaction hash, two legs — as a DEX swap emits: an outgoing leg in one
// token and an incoming leg in another.
const swapLeg = (
  token: string,
  amount: string,
  summary: string,
  hash: string,
  submittedAt: number,
): ActivityEntry => ({
  accountId: `SN_MAIN:${ACCOUNT}`,
  amount,
  counterparty: OTHER,
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt,
  summary,
  token,
});

describe("mergeActivity", () => {
  test("unions local and chain entries, newest first", () => {
    const merged = mergeActivity(
      [localEntry("0xaaa", 3000, "accepted")],
      [chainEntry("0xbbb", 5000), chainEntry("0xccc", 1000)],
    );
    expect(merged.map((entry) => entry.hash)).toEqual(["0xbbb", "0xaaa", "0xccc"]);
  });

  test("de-dupes by hash and keeps the local record's summary on a collision", () => {
    // The chain reports the same transaction the wallet submitted (leading-zero
    // spelling); the local, richer summary must win, once. The status is
    // reconciled to accepted because the chain scan proves the transfer was
    // included (its Transfer event was emitted), closing the stuck-pending gap.
    const merged = mergeActivity(
      [localEntry("0x7ab", 4000, "pending")],
      [chainEntry("0x07ab", 4000)],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("Send from wallet 0x7ab");
    expect(merged[0]?.status).toBe("accepted");
  });

  test("leaves a terminal local status untouched even when the chain scan matches", () => {
    // A locally reverted row must not be flipped to accepted: terminal states are
    // set by the authoritative status re-poll, and a reverted transaction emits
    // no Transfer event, so a chain match here can only be a spurious collision.
    const merged = mergeActivity(
      [localEntry("0x7ab", 4000, "reverted")],
      [chainEntry("0x07ab", 4000)],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("reverted");
  });

  test("never returns fewer rows than the local log", () => {
    const local = [localEntry("0xaaa", 1, "accepted"), localEntry("0xbbb", 2, "reverted")];
    expect(mergeActivity(local, [])).toHaveLength(2);
  });

  test("keeps every leg of a multi-transfer chain tx (swap/multicall) sharing one hash", () => {
    // Two Transfer events, same transaction_hash — the exact swap shape that a
    // hash-only key would collapse to a single arbitrary leg.
    const merged = mergeActivity(
      [],
      [
        swapLeg("ETH", "1.5", "Sent 1.5 ETH to 0x7770…0abc", "0xswap", 9000),
        swapLeg("USDC", "3000", "Received 3000 USDC from 0x7770…0abc", "0xswap", 9000),
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.token).sort()).toEqual(["ETH", "USDC"]);
  });

  test("a local record still collapses all chain legs sharing its hash", () => {
    // When the wallet submitted the transaction locally, its richer summary wins
    // and absorbs every chain leg of that hash (one row, the local one).
    const merged = mergeActivity(
      [localEntry("0xswap", 9000, "accepted")],
      [
        swapLeg("ETH", "1.5", "Sent 1.5 ETH to 0x7770…0abc", "0xswap", 9000),
        swapLeg("USDC", "3000", "Received 3000 USDC from 0x7770…0abc", "0xswap", 9000),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("Send from wallet 0xswap");
  });
});
