/**
 * A shield's STRK requirement (issue 665): one pure helper adds the pool fee,
 * the network fee at its signing ceiling, and the amount when the shielded
 * token is STRK, and says how much the public balance lacks. It fails open
 * like the affordability predicate beside it — an unknown or malformed input
 * yields no claim, never a fabricated shortfall and never a throw. Kept
 * beside `fee-funds.test.ts` rather than in it so the two suites can change
 * independently.
 */
import { describe, expect, test } from "bun:test";
import { shieldStrkNeed } from "@bramble/transactions/fee-funds";

const base = { amountIfStrk: 0n, networkMaxFee: 300n, poolFee: 1000n };

describe("shieldStrkNeed", () => {
  test("adds the pool fee and the network ceiling for another token", () => {
    expect(shieldStrkNeed({ ...base, balance: "2000" })).toEqual({ need: 1300n, short: 0n });
  });

  test("adds the amount when the shielded token is STRK", () => {
    expect(shieldStrkNeed({ ...base, amountIfStrk: 700n, balance: "1500" })).toEqual({
      need: 2000n,
      short: 500n,
    });
  });

  test("a balance exactly equal to the need is not short", () => {
    expect(shieldStrkNeed({ ...base, balance: "1300" })).toEqual({ need: 1300n, short: 0n });
  });

  test("one base unit below the need is short by one", () => {
    expect(shieldStrkNeed({ ...base, balance: "1299" })).toEqual({ need: 1300n, short: 1n });
  });

  test("an empty balance is short by the whole need", () => {
    expect(shieldStrkNeed({ ...base, balance: "0" })).toEqual({ need: 1300n, short: 1300n });
  });

  test("reads a hex balance as the RPC may return it", () => {
    expect(shieldStrkNeed({ ...base, balance: "0x514" })).toEqual({ need: 1300n, short: 0n });
  });

  test("an unknown balance or network ceiling makes no claim", () => {
    expect(shieldStrkNeed({ ...base, balance: null })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "2000", networkMaxFee: null })).toBeNull();
  });

  test("a malformed or negative figure makes no claim and never throws", () => {
    expect(shieldStrkNeed({ ...base, balance: "1.5" })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "-1" })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "2000", networkMaxFee: -1n })).toBeNull();
    expect(shieldStrkNeed({ ...base, balance: "2000", poolFee: -1n })).toBeNull();
    expect(shieldStrkNeed({ ...base, amountIfStrk: -1n, balance: "2000" })).toBeNull();
  });
});
