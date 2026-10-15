/**
 * A retired send keeps its unresolved status (the wallet never learned the
 * outcome) and owes the user one failure notice. Once that notice is
 * delivered it is owed nothing more, so it must not outrank settled rows, and
 * hundreds of them must not push out a send still under observation (#677).
 * Every cap prefers the rows still owed.
 */
import { describe, expect, test } from "bun:test";
import { storageBudgetFor } from "@bramble/store/kv";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  entriesAfterRecord,
  MAX_ENTRIES_PER_SCOPE,
  scopeSnapshot,
  withinByteBudget,
} from "../../src/activity/activity-retention";

const felt = (seed: number): string => `0x7${seed.toString(16).padStart(62, "5")}`;
const scope = { accountId: `SN_MAIN:${felt(0xa001)}`, networkId: "SN_MAIN" as const };

const row = (seed: number, submittedAt: number, extra: Partial<ActivityEntry>): ActivityEntry => ({
  ...scope,
  amount: "12.345678",
  counterparty: felt(0xc000 + seed),
  hash: felt(seed),
  kind: "transfer",
  origin: "wallet",
  status: "accepted",
  submittedAt,
  summary: `Sent 12.345678 STRK to ${felt(0xc000 + seed).slice(0, 10)}…`,
  token: "STRK",
  ...extra,
});

// The oldest row: a send the wallet is still observing.
const observing = row(1, 1, { status: "pending" });
// Newer sends that were retired and whose failure notice was already shown.
const delivered = (count: number): readonly ActivityEntry[] =>
  Array.from({ length: count }, (_, index) =>
    row(1_000 + index, 10 + index, { failureNotice: "delivered", status: "pending" }),
  );

describe("retired-and-delivered rows", () => {
  test("the byte trim evicts them before a send still under observation", () => {
    const entries = [observing, ...delivered(320)];
    const budget = { ...storageBudgetFor("bramble:activity"), maxBytes: 40_000 };

    const trimmed = withinByteBudget(entries, budget);

    expect(trimmed.length).toBeLessThan(entries.length);
    expect(trimmed).toContain(observing);
  });

  test("a record at the count cap keeps the send still under observation", () => {
    const entries = [observing, ...delivered(MAX_ENTRIES_PER_SCOPE + 120)];
    const next = row(9_999, 10_000, {});

    const kept = entriesAfterRecord(entries, next);

    expect(kept).toHaveLength(MAX_ENTRIES_PER_SCOPE);
    expect(kept).toContain(observing);
    expect(kept).toContain(next);
  });

  test("a scope snapshot keeps every owed row, newest first", () => {
    const owedNotice = row(2, 2, { failureNotice: "pending", status: "pending" });
    const entries = [observing, owedNotice, ...delivered(MAX_ENTRIES_PER_SCOPE + 120)];

    const snapshot = scopeSnapshot(entries, scope);

    expect(snapshot).toHaveLength(MAX_ENTRIES_PER_SCOPE);
    expect(snapshot).toContain(observing);
    expect(snapshot).toContain(owedNotice);
    expect(snapshot.map((entry) => entry.submittedAt)).toEqual(
      [...snapshot.map((entry) => entry.submittedAt)].sort((left, right) => right - left),
    );
  });
});
