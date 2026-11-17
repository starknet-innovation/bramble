/**
 * Fee-affordability predicate (issue 191): one pure function decides whether
 * the account's STRK balance covers a fee estimate (plus the amount when the
 * transaction spends STRK itself), and fails open — unknown inputs yield
 * "unknown", never a fabricated verdict and never a throw.
 */
import { describe, expect, test } from "bun:test";
import {
  resolveFeeAffordability,
  resolveTokenFeeAffordability,
} from "@bramble/transactions/fee-funds";

const FEE = { overallFee: "1000", unit: "FRI" };

describe("resolveFeeAffordability", () => {
  test("balance above the fee is ok", () => {
    expect(resolveFeeAffordability({ balance: "1001", fee: FEE })).toBe("ok");
  });

  test("balance exactly equal to the fee is ok", () => {
    expect(resolveFeeAffordability({ balance: "1000", fee: FEE })).toBe("ok");
  });

  test("balance below the fee is insufficient", () => {
    expect(resolveFeeAffordability({ balance: "999", fee: FEE })).toBe("insufficient");
  });

  test("a STRK send counts amount plus fee", () => {
    expect(resolveFeeAffordability({ balance: "1500", fee: FEE, sendAmount: 500n })).toBe("ok");
    expect(resolveFeeAffordability({ balance: "1499", fee: FEE, sendAmount: 500n })).toBe(
      "insufficient",
    );
  });

  test("an unknown balance makes no claim", () => {
    expect(resolveFeeAffordability({ balance: null, fee: FEE })).toBe("unknown");
  });

  test("a missing fee makes no claim", () => {
    expect(resolveFeeAffordability({ balance: "1000", fee: null })).toBe("unknown");
  });

  test("a non-FRI fee is not comparable against a STRK balance", () => {
    expect(
      resolveFeeAffordability({ balance: "1000", fee: { overallFee: "1", unit: "WEI" } }),
    ).toBe("unknown");
  });

  test("malformed numbers fail open instead of throwing", () => {
    expect(resolveFeeAffordability({ balance: "12,3", fee: FEE })).toBe("unknown");
    expect(
      resolveFeeAffordability({ balance: "1000", fee: { overallFee: "0x?", unit: "FRI" } }),
    ).toBe("unknown");
    expect(resolveFeeAffordability({ balance: "-1", fee: FEE })).toBe("unknown");
  });
});

describe("resolveTokenFeeAffordability", () => {
  test("compares a token balance with that token's fee", () => {
    expect(resolveTokenFeeAffordability({ amount: "10", balance: "10" })).toBe("ok");
    expect(resolveTokenFeeAffordability({ amount: "11", balance: "10" })).toBe("insufficient");
  });

  test("adds the amount of the same token the transaction spends", () => {
    expect(resolveTokenFeeAffordability({ amount: "10", balance: "15", sendAmount: 5n })).toBe(
      "ok",
    );
    expect(resolveTokenFeeAffordability({ amount: "10", balance: "14", sendAmount: 5n })).toBe(
      "insufficient",
    );
  });

  test("an unreadable balance or amount is unknown", () => {
    expect(resolveTokenFeeAffordability({ amount: "10", balance: null })).toBe("unknown");
    expect(resolveTokenFeeAffordability({ amount: null, balance: "10" })).toBe("unknown");
    expect(resolveTokenFeeAffordability({ amount: "1.2", balance: "10" })).toBe("unknown");
  });
});
