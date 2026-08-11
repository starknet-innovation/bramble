/**
 * `"declare"` is its own activity kind (MCW-V09-120), and adding it needed no
 * stored-schema migration. This suite is the evidence for that claim.
 *
 * The alternative was to record a dapp declare as an `"invoke"` and reuse the
 * existing union. That was rejected: a declare and a call are different
 * transaction types on chain, the feed and the CSV export are what a user reads
 * back when reconciling what their wallet did, and a kind that lies makes the
 * export wrong in exactly the situation it exists for. Naming the domain rather
 * than the nearest existing mechanism is the repo's stated preference.
 *
 * Widening the union is safe without a migration because the activity log is
 * not the versioned vault schema (`CURRENT_SCHEMA_VERSION` /
 * `VAULT_MIGRATIONS`, which are untouched): it is an unversioned local log that
 * validates every stored row on read and drops what does not validate. So the
 * only three cases that matter are pinned here — rows written before the change
 * still validate, a `"declare"` row round-trips, and an unrecognized kind is
 * still refused rather than silently rendered.
 */
import { describe, expect, test } from "bun:test";
import {
  type ActivityEntry,
  activityToCsv,
  createActivityLog,
  isActivityEntry,
} from "../../src/storage/activity-store";
import { createMemoryStore } from "../../src/storage/kv";

const ACCOUNT = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const entry = (kind: string): Record<string, unknown> => ({
  accountId: ACCOUNT,
  hash: "0x7cd",
  kind,
  networkId: "SN_MAIN",
  status: "pending",
  submittedAt: 1,
  summary: "Declare contract class 0x5abc",
});

describe("the widened activity kind union", () => {
  test("accepts a declare row", () => {
    expect(isActivityEntry(entry("declare"))).toBe(true);
  });

  // Backward compatibility: every kind that could already be on disk before
  // "declare" existed must still read back, or the widening would have silently
  // erased a user's history on upgrade.
  for (const kind of ["deploy", "invoke", "transfer"]) {
    test(`still accepts a ${kind} row written before the change`, () => {
      expect(isActivityEntry(entry(kind))).toBe(true);
    });
  }

  test("still refuses a kind it does not recognize", () => {
    expect(isActivityEntry(entry("declare "))).toBe(false);
    expect(isActivityEntry(entry("upgrade"))).toBe(false);
    expect(isActivityEntry(entry(""))).toBe(false);
  });
});

describe("a declared class survives the store", () => {
  test("round-trips through the persistent log and its CSV export", async () => {
    const store = createMemoryStore();
    const log = createActivityLog({ now: () => 1, store });

    await log.record({
      accountId: ACCOUNT,
      hash: "0x7cd",
      kind: "declare",
      networkId: "SN_MAIN",
      summary: "Declare contract class 0x5abc",
    });

    // Read back through a second log over the same store, so the row goes
    // through `isActivityEntry` on the way out rather than being served from
    // anything the writer kept in memory.
    const entries = await createActivityLog({ now: () => 2, store }).list();
    expect(entries.map((stored: ActivityEntry) => stored.kind)).toEqual(["declare"]);
    expect(activityToCsv(entries)).toContain(',"declare",');
  });
});
