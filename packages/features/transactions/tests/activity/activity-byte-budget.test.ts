/**
 * The activity log stays writable when its rows outgrow the storage budget
 * (release audit N1). The row caps bound how many rows the log keeps, not how
 * many bytes: a v0.10.5 log of 350 rows fit the budget, but the same rows in
 * v0.10.6 shape (with `tokenAddress`, `direction` and `feePaid`) do not, and
 * every write after the upgrade used to fail with "Invalid JSON value" while
 * its callers absorbed the error. Retention now evicts the oldest settled rows
 * until the log fits, and keeps a row still under observation or owing a
 * failure notice for as long as any settled row is left to evict.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isJsonWithinBudget, type Json } from "@bramble/core/json";
import {
  setReliabilityDiagnosticsEnabled,
  storageDiagnosticsSnapshot,
} from "@bramble/starknet/rpc-diagnostics";
import { createMemoryStore, type KeyValueStore, storageBudgetFor } from "@bramble/store/kv";
import { type ActivityEntry, createActivityLog } from "@bramble/transactions/activity";
import { withinByteBudget } from "../../src/activity/activity-retention";

const KEY = "bramble:activity";
const BUDGET = storageBudgetFor(KEY);
// A full-width felt below the Stark prime, as real hashes and addresses are.
const felt = (seed: number): string => `0x7${seed.toString(16).padStart(62, "5")}`;
const accountId = (account: number): string => `SN_MAIN:${felt(0xa000 + account)}`;
const scope = (account: number) => ({
  accountId: accountId(account),
  networkId: "SN_MAIN" as const,
});
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// A row as v0.10.5 wrote it: no token address, direction or fee.
const legacyRow = (account: number, row: number, submittedAt: number): ActivityEntry => ({
  accountId: accountId(account),
  amount: "12.345678",
  counterparty: felt(0xc000 + row),
  hash: felt(account * 100_000 + row),
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt,
  summary: `Sent 12.345678 STRK to ${felt(0xc000 + row).slice(0, 10)}…`,
  token: "STRK",
});

// The same row as v0.10.6 records it.
const currentRow = (account: number, row: number, submittedAt: number): ActivityEntry => ({
  ...legacyRow(account, row, submittedAt),
  direction: "out",
  feePaid: { amount: "0x2386f26fc10000", unit: "FRI" },
  tokenAddress: STRK,
});

// A v0.10.5 log at the caps the audit measured: one full scope of 200 rows and
// 150 rows of a second account, the oldest of which is still pending.
const legacyStore = async (): Promise<{
  readonly store: KeyValueStore;
  readonly pending: ActivityEntry;
}> => {
  const rows = [
    ...Array.from({ length: 200 }, (_, row) => legacyRow(0, row, 10_000 + row)),
    ...Array.from({ length: 150 }, (_, row) => legacyRow(1, row, 20_000 + row)),
  ];
  const pending: ActivityEntry = { ...legacyRow(1, 999, 1), status: "pending" };
  rows.push(pending);
  const store = createMemoryStore();
  // The memory store holds a write to the same budget the browser adapter does.
  await store.set(KEY, rows as unknown as Json);
  return { pending, store };
};

afterEach(() => setReliabilityDiagnosticsEnabled(false));

describe("a v0.10.5 activity log after the upgrade", () => {
  test("fit the budget in v0.10.5 shape and does not in v0.10.6 shape", () => {
    const rows = (make: typeof legacyRow) => [
      ...Array.from({ length: 200 }, (_, row) => make(0, row, row)),
      ...Array.from({ length: 151 }, (_, row) => make(1, row, row)),
    ];
    expect(isJsonWithinBudget(rows(legacyRow), BUDGET)).toBe(true);
    expect(isJsonWithinBudget(rows(currentRow), BUDGET)).toBe(false);
  });

  test("keeps accepting a history sync and new rows, and keeps the pending row", async () => {
    const { pending, store } = await legacyStore();
    const log = createActivityLog({ now: () => 50_000, store });

    // History sync rewrites the full scope in v0.10.6 shape.
    const synced = Array.from({ length: 200 }, (_, row) => currentRow(0, row, 30_000 + row));
    const kept = await log.replaceScope?.(synced, scope(0));
    expect(kept?.length).toBeGreaterThan(0);

    const recorded = Array.from({ length: 5 }, (_, index) => felt(0xf000 + index));
    for (const [index, hash] of recorded.entries()) {
      await log.record({
        accountId: accountId(1),
        direction: "out",
        hash,
        kind: "transfer",
        networkId: "SN_MAIN",
        summary: `Sent 1 STRK (${index})`,
        token: "STRK",
        tokenAddress: STRK,
      });
    }
    const stored = await store.get(KEY);
    expect(isJsonWithinBudget(stored, BUDGET)).toBe(true);

    const list = await log.list();
    expect(list.filter((entry) => recorded.includes(entry.hash))).toHaveLength(5);
    expect(list.some((entry) => entry.hash === pending.hash && entry.status === "pending")).toBe(
      true,
    );
    // Only the oldest settled rows went: the newest synced row and every new row stayed.
    expect(list.some((entry) => entry.hash === synced[199]?.hash)).toBe(true);

    // Status reconciliation (which adds a fee) and notice delivery still write.
    await log.updateStatuses(
      { [pending.hash]: { feePaid: { amount: "0x1", unit: "FRI" }, status: "accepted" } },
      scope(1),
    );
    const settled = (await log.list()).find((entry) => entry.hash === pending.hash);
    expect(settled?.status).toBe("accepted");
  });

  test("counts a trimmed write and a failed write in the opt-in diagnostics", async () => {
    setReliabilityDiagnosticsEnabled(true);
    const { store } = await legacyStore();
    await createActivityLog({ store }).replaceScope?.(
      Array.from({ length: 200 }, (_, row) => currentRow(0, row, 30_000 + row)),
      scope(0),
    );
    const failing: KeyValueStore = {
      ...createMemoryStore(),
      set: () => Promise.reject(new Error("quota")),
    };
    await expect(
      createActivityLog({ store: failing }).record({
        accountId: accountId(2),
        hash: "0x1",
        kind: "invoke",
        networkId: "SN_MAIN",
        summary: "Invoke",
      }),
    ).rejects.toThrow("quota");
    expect(storageDiagnosticsSnapshot()).toEqual([
      { count: 1, outcome: "trimmed", store: "activity" },
      { count: 1, outcome: "write-failed", store: "activity" },
    ]);
  });
});

describe("withinByteBudget", () => {
  const tiny = { ...BUDGET, maxBytes: 0 };
  const sized = (rows: readonly ActivityEntry[]) => ({ ...BUDGET, maxBytes: bytesOf(rows) });
  // The smallest maxBytes that admits `rows`, found by the same accounting.
  const bytesOf = (rows: readonly ActivityEntry[]): number => {
    let low = 0;
    let high = BUDGET.maxBytes;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (isJsonWithinBudget(rows, { ...BUDGET, maxBytes: middle })) high = middle;
      else low = middle + 1;
    }
    return high;
  };

  test("returns the log itself when it fits", () => {
    const rows = [currentRow(0, 0, 1)];
    expect(withinByteBudget(rows, BUDGET)).toBe(rows);
  });

  test("evicts the oldest settled rows before any owed row, and never the kept row", () => {
    const pending = { ...currentRow(0, 0, 1), status: "pending" as const };
    const notice = {
      ...currentRow(0, 1, 2),
      failureNotice: "pending" as const,
      status: "reverted" as const,
    };
    const settled = [3, 4, 5, 6].map((at) => currentRow(0, at, at));
    const kept = currentRow(0, 9, 0);
    const rows = [pending, notice, ...settled, kept];
    // Room for every row but two settled ones.
    const budget = sized([pending, notice, settled[2], settled[3], kept] as ActivityEntry[]);
    expect(withinByteBudget(rows, budget, kept)).toEqual([
      pending,
      notice,
      settled[2],
      settled[3],
      kept,
    ] as ActivityEntry[]);
    // Owed rows go only once every settled row has; the kept row stays even then.
    expect(withinByteBudget(rows, sized([notice, kept]), kept)).toEqual([notice, kept]);
    expect(withinByteBudget(rows, tiny, kept)).toEqual([kept]);
  });
});
