/**
 * Starkscan's staking coverage, the one rule the validator directory and "Your
 * stakes" share: `prepared` is complete; `catching_up` is offered only when it
 * is finalized-only, has no gap and nothing outstanding, and trails by at most
 * the single-sourced lag bound; anything else is incomplete. Every field the
 * rule reads is type- and bounds-checked, and a malformed block is null so the
 * whole answer is refused. Fixtures are schema-derived (see
 * ../support/staking-directory-fixture).
 */
import { describe, expect, test } from "bun:test";
import { MAX_CATCHING_UP_LAG_BLOCKS, stakingCoverage } from "../../src/staking/staking-coverage";
import { CATCHING_UP_COVERAGE, directoryCoverage } from "../support/staking-directory-fixture";

const catchingUp = (overrides: Readonly<Record<string, unknown>>) =>
  stakingCoverage({ ...CATCHING_UP_COVERAGE, ...overrides });

describe("stakingCoverage", () => {
  test("decides whether a list is offered as whole", () => {
    const table: readonly (readonly [string, unknown, string])[] = [
      ["prepared", directoryCoverage(), "usable"],
      ["prepared, even behind", directoryCoverage({ lagBlocks: 10_000 }), "usable"],
      ["catching up, as Starkscan serves it", CATCHING_UP_COVERAGE, "usable"],
      ["catching up, no lag", { ...CATCHING_UP_COVERAGE, lagBlocks: 0 }, "usable"],
      [
        "catching up, at the bound",
        { ...CATCHING_UP_COVERAGE, lagBlocks: MAX_CATCHING_UP_LAG_BLOCKS },
        "usable",
      ],
      [
        "catching up, past the bound",
        { ...CATCHING_UP_COVERAGE, lagBlocks: MAX_CATCHING_UP_LAG_BLOCKS + 1 },
        "incomplete",
      ],
      [
        "catching up, with a gap",
        { ...CATCHING_UP_COVERAGE, gapIntervals: [{ fromBlock: 1, toBlock: 2 }] },
        "incomplete",
      ],
      [
        "catching up, with an outstanding interval",
        {
          ...CATCHING_UP_COVERAGE,
          outstandingMaterializationIntervals: [{ fromBlock: 1, toBlock: 2 }],
        },
        "incomplete",
      ],
      [
        "catching up, not finalized-only",
        { ...CATCHING_UP_COVERAGE, finalizedOnly: false },
        "incomplete",
      ],
      ["unavailable", directoryCoverage({ status: "unavailable" }), "incomplete"],
      [
        "unavailable, otherwise clean",
        { ...CATCHING_UP_COVERAGE, status: "unavailable" },
        "incomplete",
      ],
    ];
    for (const [name, coverage, expected] of table) {
      expect([name, stakingCoverage(coverage)]).toEqual([name, expected]);
    }
  });

  test("the lag bound is a small, positive number of blocks", () => {
    expect(Number.isSafeInteger(MAX_CATCHING_UP_LAG_BLOCKS)).toBe(true);
    expect(MAX_CATCHING_UP_LAG_BLOCKS).toBeGreaterThan(0);
    expect(MAX_CATCHING_UP_LAG_BLOCKS).toBeLessThanOrEqual(100);
  });

  test("ignores fields the rule does not read", () => {
    expect(catchingUp({ activityHistoryTruncated: "x", newField: { nested: true } })).toBe(
      "usable",
    );
    expect(catchingUp({ gapIntervals: [] })).toBe("usable");
  });

  test("refuses a block it cannot read, whatever the status", () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      [],
      "prepared",
      directoryCoverage({ status: "done" }),
      directoryCoverage({ status: "PREPARED" }),
      directoryCoverage({ status: null }),
    ];
    for (const value of malformed) expect(stakingCoverage(value)).toBeNull();
    for (const status of ["prepared", "catching_up", "unavailable"]) {
      const bad: readonly Readonly<Record<string, unknown>>[] = [
        { finalizedOnly: undefined },
        { finalizedOnly: "true" },
        { finalizedOnly: 1 },
        { finalizedOnly: null },
        { lagBlocks: undefined },
        { lagBlocks: null },
        { lagBlocks: "0" },
        { lagBlocks: -1 },
        { lagBlocks: 1.5 },
        { lagBlocks: Number.NaN },
        { lagBlocks: Number.POSITIVE_INFINITY },
        { lagBlocks: Number.MAX_SAFE_INTEGER + 1 },
        { gapIntervals: undefined },
        { gapIntervals: null },
        { gapIntervals: {} },
        { gapIntervals: "" },
        { gapIntervals: Array.from({ length: 1025 }, () => ({})) },
        { outstandingMaterializationIntervals: undefined },
        { outstandingMaterializationIntervals: null },
        { outstandingMaterializationIntervals: { length: 0 } },
        { outstandingMaterializationIntervals: Array.from({ length: 1025 }, () => ({})) },
      ];
      for (const overrides of bad) {
        const value = { ...CATCHING_UP_COVERAGE, status, ...overrides };
        expect([status, overrides, stakingCoverage(value)]).toEqual([status, overrides, null]);
      }
    }
    // The bound itself is accepted: an answer at the limit is not oversized.
    expect(catchingUp({ gapIntervals: Array.from({ length: 1024 }, () => ({})) })).toBe(
      "incomplete",
    );
  });
});
