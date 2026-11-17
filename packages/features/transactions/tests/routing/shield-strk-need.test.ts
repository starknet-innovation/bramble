/**
 * A shield's STRK requirement (issue 665): one pure helper adds the pool fee,
 * the network fee at its signing ceiling, and the amount when the shielded
 * token is STRK, and says how much the public balance lacks. It parses every
 * figure strictly and fails open — a blank, malformed or out-of-grammar input
 * yields no claim, never a fabricated shortfall and never a throw. Kept beside
 * `fee-funds.test.ts` rather than in it so the two suites change independently.
 */
import { describe, expect, test } from "bun:test";
import { shieldStrkNeed } from "@bramble/transactions/fee-funds";

// 1000 pool fee + a 200 FRI reviewed network fee, whose ceiling is 300.
const base = {
  amount: 0n,
  networkFee: { overallFee: "200", unit: "FRI" },
  poolFeeFri: "1000",
  shieldsStrk: false,
};

describe("shieldStrkNeed", () => {
  test("adds the pool fee and the network ceiling for another token", () => {
    expect(shieldStrkNeed({ ...base, balance: "2000" })).toEqual({ need: 1300n, short: 0n });
  });

  test("uses the ceiling of an odd base-unit estimate, rounded the way the submission bounds it", () => {
    // 201 * 3/2 = 301.5: the submission refuses any signed spend above 301.
    expect(
      shieldStrkNeed({ ...base, balance: "0", networkFee: { overallFee: "201", unit: "FRI" } }),
    ).toEqual({ need: 1301n, short: 1301n });
  });

  test("adds the amount only when the shielded token is STRK", () => {
    expect(shieldStrkNeed({ ...base, amount: 700n, balance: "1500", shieldsStrk: true })).toEqual({
      need: 2000n,
      short: 500n,
    });
    expect(shieldStrkNeed({ ...base, amount: 700n, balance: "1500" })).toEqual({
      need: 1300n,
      short: 0n,
    });
  });

  test("reads a pool fee quoted as a lowercase hex felt", () => {
    expect(shieldStrkNeed({ ...base, balance: "2000", poolFeeFri: "0x3e8" })).toEqual({
      need: 1300n,
      short: 0n,
    });
  });

  test("a balance exactly equal to the need is not short; one unit below is", () => {
    expect(shieldStrkNeed({ ...base, balance: "1300" })).toEqual({ need: 1300n, short: 0n });
    expect(shieldStrkNeed({ ...base, balance: "1299" })).toEqual({ need: 1300n, short: 1n });
  });

  test("an empty balance is short by the whole need", () => {
    expect(shieldStrkNeed({ ...base, balance: "0" })).toEqual({ need: 1300n, short: 1300n });
  });

  test("handles the widest u256 balance exactly", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(shieldStrkNeed({ ...base, balance: max })).toEqual({ need: 1300n, short: 0n });
  });

  test("an unknown balance, fee or STRK amount makes no claim", () => {
    expect(shieldStrkNeed({ ...base, balance: null })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "2000", networkFee: null })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "2000", poolFeeFri: null })).toBeNull();
    expect(
      shieldStrkNeed({ ...base, amount: null, balance: "2000", shieldsStrk: true }),
    ).toBeNull();
  });

  test("a malformed balance makes no claim: blank is not zero", () => {
    for (const balance of ["", " ", "0x", "0x514", "1.5", "-1", "01", "1e3", "9".repeat(79)]) {
      expect(shieldStrkNeed({ ...base, balance })).toBeNull();
    }
  });

  test("a malformed pool fee makes no claim", () => {
    for (const poolFeeFri of ["", " ", "0x", "0X3E8", "1.5", "-1", " 1000"]) {
      expect(shieldStrkNeed({ ...base, balance: "2000", poolFeeFri })).toBeNull();
    }
  });

  test("a malformed or non-FRI network fee makes no claim", () => {
    for (const overallFee of ["", " ", "0x", "0xc8", "1.5", "-1", "9".repeat(79)]) {
      expect(
        shieldStrkNeed({ ...base, balance: "2000", networkFee: { overallFee, unit: "FRI" } }),
      ).toBeNull();
    }
    expect(
      shieldStrkNeed({ ...base, balance: "2000", networkFee: { overallFee: "200", unit: "WEI" } }),
    ).toBeNull();
  });

  test("a negative STRK amount makes no claim", () => {
    expect(shieldStrkNeed({ ...base, amount: -1n, balance: "2000", shieldsStrk: true })).toBeNull();
  });
});
