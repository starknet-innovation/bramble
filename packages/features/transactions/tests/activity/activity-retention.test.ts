/**
 * Which rows the activity log keeps once it is full.
 *
 * - Sherlock 203: the per-scope cap keeps the newest rows by `submittedAt`,
 *   whichever order the scope was last written in. `replaceScope` stores a
 *   scope newest-first and `record` appends, so a positional slice evicted the
 *   newest row after a history scan.
 * - Sherlock 158: the log keeps at most `MAX_ACTIVITY_SCOPES` account/network
 *   scopes, so its size no longer grows with every account ever used. The
 *   scope just written stays, and a scope still observing a transaction is
 *   evicted only after every settled one.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type ActivityEntry,
  type ActivityLog,
  createActivityLog,
  memoryActivityLog,
} from "@bramble/transactions/activity";
import { MAX_ACTIVITY_SCOPES, MAX_ENTRIES_PER_SCOPE } from "../../src/activity/activity-retention";

const accountId = (index: number): string => `SN_MAIN:0x${(0x1000 + index).toString(16)}`;
const scope = (index: number) => ({ accountId: accountId(index), networkId: "SN_MAIN" as const });
const hash = (index: number): string => `0x${(index + 1).toString(16)}`;

const settled = (account: number, row: number, submittedAt: number): ActivityEntry => ({
  accountId: accountId(account),
  hash: hash(account * 1_000 + row),
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt,
  summary: `Received 1 STRK (${row})`,
});

const logs: ReadonlyArray<readonly [string, (now: () => number) => ActivityLog]> = [
  ["persistent", (now) => createActivityLog({ now, store: createMemoryStore() })],
  ["memory", (now) => memoryActivityLog(now)],
];

describe.each(logs)("%s activity log", (_name, makeLog) => {
  test("keeps the newest rows of a full scope that a history scan wrote newest-first", async () => {
    let clock = 0;
    const log = makeLog(() => clock);
    // A full scope as replaceScope stores it: newest first.
    const rows = Array.from({ length: MAX_ENTRIES_PER_SCOPE }, (_, row) =>
      settled(0, row, 1_000 + row),
    );
    await log.replaceScope?.(rows, scope(0));

    clock = 10_000;
    await log.record({
      accountId: accountId(0),
      hash: "0xfeed",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1 STRK",
    });

    const kept = await log.list();
    expect(kept).toHaveLength(MAX_ENTRIES_PER_SCOPE);
    expect(kept[0]?.hash).toBe("0xfeed");
    // The newest scanned row survives; the oldest one is the row evicted.
    expect(kept.some((entry) => entry.submittedAt === 1_000 + MAX_ENTRIES_PER_SCOPE - 1)).toBe(
      true,
    );
    expect(kept.some((entry) => entry.submittedAt === 1_000)).toBe(false);
  });

  test("keeps at most the scope limit, evicting the least recently used scope", async () => {
    const log = makeLog(() => 0);
    for (let account = 0; account <= MAX_ACTIVITY_SCOPES; account += 1) {
      await log.replaceScope?.([settled(account, 0, 100 + account)], scope(account));
    }

    const kept = await log.list();
    const accounts = new Set(kept.map((entry) => entry.accountId));
    expect(accounts.size).toBe(MAX_ACTIVITY_SCOPES);
    expect(accounts.has(accountId(0))).toBe(false);
    expect(accounts.has(accountId(MAX_ACTIVITY_SCOPES))).toBe(true);
  });

  test("evicts a settled scope before one still observing a transaction", async () => {
    let clock = 1;
    const log = makeLog(() => clock);
    // The oldest scope holds a pending transaction.
    await log.record({
      accountId: accountId(0),
      hash: "0xabc",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1 STRK",
    });
    clock = 2;
    for (let account = 1; account <= MAX_ACTIVITY_SCOPES; account += 1) {
      await log.replaceScope?.([settled(account, 0, 100 + account)], scope(account));
    }

    const accounts = new Set((await log.list()).map((entry) => entry.accountId));
    expect(accounts.size).toBe(MAX_ACTIVITY_SCOPES);
    expect(accounts.has(accountId(0))).toBe(true);
    expect(accounts.has(accountId(1))).toBe(false);
  });

  test("keeps the scope being recorded even when it is the oldest", async () => {
    const log = makeLog(() => 0);
    for (let account = 1; account <= MAX_ACTIVITY_SCOPES; account += 1) {
      await log.replaceScope?.([settled(account, 0, 100 + account)], scope(account));
    }
    await log.record({
      accountId: accountId(0),
      hash: "0xabc",
      kind: "transfer",
      networkId: "SN_MAIN",
      summary: "Send 1 STRK",
    });

    const accounts = new Set((await log.list()).map((entry) => entry.accountId));
    expect(accounts.size).toBe(MAX_ACTIVITY_SCOPES);
    expect(accounts.has(accountId(0))).toBe(true);
  });
});
