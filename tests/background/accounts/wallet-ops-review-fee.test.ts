/**
 * Reason logic behind a transfer review's fee outcome: an undeployed account
 * yields an intentional null fee (not a failure), a deployed account with an
 * estimate keeps that fee, and a deployed account without one is flagged as a
 * genuine estimate failure so the UI can offer a retry.
 */
import { describe, expect, test } from "bun:test";
import { resolveReviewFee } from "../../../apps/extension/src/background/accounts/wallet-ops";

const fee = { overallFee: "2500000000000000", unit: "FRI" } as const;

describe("resolveReviewFee", () => {
  test("keeps the estimate for a deployed account", () => {
    expect(resolveReviewFee({ deployed: true, fee })).toEqual({
      fee,
      feeEstimateFailed: false,
    });
  });

  test("flags a deployed account with no estimate as a failure", () => {
    expect(resolveReviewFee({ deployed: true, fee: null })).toEqual({
      fee: null,
      feeEstimateFailed: true,
    });
  });

  test("treats an undeployed account's null fee as intentional, not a failure", () => {
    expect(resolveReviewFee({ deployed: false, fee: null })).toEqual({
      fee: null,
      feeEstimateFailed: false,
    });
  });

  test("does not surface a fee for an undeployed account even if one is passed", () => {
    expect(resolveReviewFee({ deployed: false, fee })).toEqual({
      fee: null,
      feeEstimateFailed: false,
    });
  });
});
