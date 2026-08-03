/**
 * Observation policy invariants for pre-confirmed transactions.
 *
 * These are the rules that decide when the wallet stops watching a transaction
 * and when it interrupts a user who has already left the Send screen, so each
 * one is pinned here rather than inferred from the reconciler's behaviour:
 * pre-confirmed and pending are watched hot and expire in an hour, L2-accepted
 * transactions are watched slowly until L1 proof, a single not-found is noise,
 * three consecutive not-founds are a failure, and no transaction ever owes the
 * user more than one notice.
 */
import { describe, expect, test } from "bun:test";
import {
  expiredObservations,
  failureNoticeMessage,
  isObserved,
  isObservedAt,
  L1_FINALITY_WINDOW_MS,
  NOT_FOUND_FAILURE_THRESHOLD,
  reconciledOutcome,
  UNRESOLVED_WINDOW_MS,
} from "../../src/background/tx-observation";
import type { TransactionStatusReport } from "../../src/starknet/rpc";
import type { ActivityEntry } from "../../src/storage/activity-store";

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  accountId: "SN_MAIN:0x1",
  hash: "0xabc",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "preconfirmed",
  submittedAt: 0,
  summary: "Sent 1 STRK to 0x2",
  ...overrides,
});

const report = (overrides: Partial<TransactionStatusReport> = {}): TransactionStatusReport => ({
  finalizedOnL1: false,
  found: true,
  status: "accepted",
  ...overrides,
});

describe("observation tiers", () => {
  test("watches unresolved transactions on the fast cadence only", () => {
    for (const status of ["pending", "preconfirmed"] as const) {
      expect(isObservedAt(entry({ status }), "fast", 1_000)).toBe(true);
      expect(isObservedAt(entry({ status }), "slow", 1_000)).toBe(false);
    }
  });

  test("watches an L2-accepted transaction on the slow cadence until L1 proof", () => {
    const accepted = entry({ status: "accepted" });
    expect(isObservedAt(accepted, "slow", 1_000)).toBe(true);
    expect(isObservedAt(accepted, "fast", 1_000)).toBe(false);
    expect(isObservedAt({ ...accepted, finalizedOnL1: true }, "slow", 1_000)).toBe(false);
  });

  test("never watches a terminal failure", () => {
    for (const status of ["rejected", "reverted"] as const) {
      expect(isObserved(entry({ status }), 1_000)).toBe(false);
    }
  });

  test("bounds each tier by its own window", () => {
    expect(isObserved(entry(), UNRESOLVED_WINDOW_MS - 1)).toBe(true);
    expect(isObserved(entry(), UNRESOLVED_WINDOW_MS)).toBe(false);
    const accepted = entry({ status: "accepted" });
    expect(isObserved(accepted, L1_FINALITY_WINDOW_MS - 1)).toBe(true);
    expect(isObserved(accepted, L1_FINALITY_WINDOW_MS)).toBe(false);
  });
});

describe("expired observations", () => {
  test("retires an unresolved transaction once, then stays quiet", () => {
    const stale = entry();
    expect(expiredObservations([stale], UNRESOLVED_WINDOW_MS)).toEqual([stale]);
    // A notice already recorded (pending or delivered) means the user has been
    // told; retiring again would re-alarm them on every later pass.
    expect(
      expiredObservations([{ ...stale, failureNotice: "delivered" }], UNRESOLVED_WINDOW_MS),
    ).toEqual([]);
    expect(
      expiredObservations([{ ...stale, failureNotice: "pending" }], UNRESOLVED_WINDOW_MS),
    ).toEqual([]);
  });

  test("never retires an accepted transaction, however old", () => {
    expect(
      expiredObservations([entry({ status: "accepted" })], L1_FINALITY_WINDOW_MS * 10),
    ).toEqual([]);
  });
});

describe("reconciled outcome", () => {
  test("promotes a pre-confirmed transaction and records L1 finality", () => {
    expect(reconciledOutcome(entry(), report())).toEqual({
      finalizedOnL1: false,
      notFoundCount: 0,
      status: "accepted",
    });
    expect(
      reconciledOutcome(entry({ status: "accepted" }), report({ finalizedOnL1: true })),
    ).toEqual({ finalizedOnL1: true, notFoundCount: 0, status: "accepted" });
  });

  test("does not demote progress or erase observed L1 finality", () => {
    expect(reconciledOutcome(entry({ status: "accepted" }), report({ status: "pending" }))).toEqual(
      { finalizedOnL1: false, notFoundCount: 0, status: "accepted" },
    );
    expect(
      reconciledOutcome(entry({ status: "preconfirmed" }), report({ status: "pending" })),
    ).toEqual({ finalizedOnL1: false, notFoundCount: 0, status: "preconfirmed" });
    expect(
      reconciledOutcome(
        entry({ finalizedOnL1: true, status: "accepted" }),
        report({ finalizedOnL1: false, status: "accepted" }),
      ),
    ).toEqual({ finalizedOnL1: true, notFoundCount: 0, status: "accepted" });
  });

  test("owes the user a notice when a confirmed transaction later fails", () => {
    for (const previous of ["accepted", "preconfirmed"] as const) {
      expect(
        reconciledOutcome(entry({ status: previous }), report({ status: "reverted" })),
      ).toEqual({
        failureNotice: "pending",
        finalizedOnL1: false,
        notFoundCount: 0,
        status: "reverted",
      });
    }
  });

  test("stays silent for a failure the Send flow is still watching", () => {
    const outcome = reconciledOutcome(entry({ status: "pending" }), report({ status: "reverted" }));
    expect(outcome.failureNotice).toBeUndefined();
  });

  test("never owes a second notice for the same transaction", () => {
    const outcome = reconciledOutcome(
      entry({ failureNotice: "delivered", status: "accepted" }),
      report({ status: "rejected" }),
    );
    expect(outcome.failureNotice).toBeUndefined();
  });

  test("treats a lone not-found as noise and clears the tally on any answer", () => {
    const missed = reconciledOutcome(entry(), report({ found: false }));
    expect(missed).toEqual({ notFoundCount: 1, status: "preconfirmed" });
    expect(reconciledOutcome(entry({ notFoundCount: 2 }), report()).notFoundCount).toBe(0);
  });

  test("treats the third consecutive not-found as a rejection worth reporting", () => {
    const gone = reconciledOutcome(
      entry({ notFoundCount: NOT_FOUND_FAILURE_THRESHOLD - 1 }),
      report({ found: false }),
    );
    expect(gone).toEqual({
      failureNotice: "pending",
      notFoundCount: NOT_FOUND_FAILURE_THRESHOLD,
      status: "rejected",
    });
  });
});

describe("failure notice copy", () => {
  test("names the transaction and what happened to it", () => {
    expect(failureNoticeMessage(entry({ status: "reverted" }))).toContain("reverted");
    expect(failureNoticeMessage(entry({ status: "rejected" }))).toContain("dropped");
    expect(failureNoticeMessage(entry({ status: "pending" }))).toContain("could not confirm");
    expect(failureNoticeMessage(entry({ status: "reverted" }))).toContain("Sent 1 STRK to 0x2");
  });
});
