/**
 * Boundary validation for the invoke approval's fee review (#189): `fee`,
 * `feeEstimateFailed`, and `requiresDeployment` travel on `PendingApproval`,
 * are validated by the existing fee predicate, stay internally consistent with
 * `resolveReviewFee`'s classification, and never leak onto other approval
 * kinds. Extension messages are untrusted — a malformed fee rejects the whole
 * response rather than rendering.
 */
import { describe, expect, test } from "bun:test";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { isPendingApprovalsResponse } from "../../src/popup/approvals-responses";

const INVOKE_ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";

const context = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
  networkId: "SN_MAIN",
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

const invokeApproval = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  context,
  fee: { overallFee: "2500000000000000", unit: "FRI" },
  feeEstimateFailed: false,
  feeEstimatePending: false,
  id: INVOKE_ID,
  kind: "invoke",
  origin: "https://dapp.example",
  requiresDeployment: false,
  summaries: ["Send 1000 units to 0x0005…0005"],
  ...overrides,
});

const response = (approval: Record<string, unknown>): unknown => ({
  ok: true,
  pending: [approval],
});

describe("PendingApproval fee review validation (#189)", () => {
  test("accepts an invoke approval carrying a consistent fee review", () => {
    expect(isPendingApprovalsResponse(response(invokeApproval()))).toBe(true);
  });

  test("rejects an account id whose network contradicts the approval context", () => {
    const wrongScope = {
      ...context,
      chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
      networkId: "SN_SEPOLIA",
    };
    expect(isPendingApprovalsResponse(response(invokeApproval({ context: wrongScope })))).toBe(
      false,
    );
  });

  test("accepts the undeployed and estimate-failed states", () => {
    expect(
      isPendingApprovalsResponse(response(invokeApproval({ fee: null, requiresDeployment: true }))),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse(response(invokeApproval({ fee: null, feeEstimateFailed: true }))),
    ).toBe(true);
  });

  test("accepts an invoke approval with no fee review at all", () => {
    const bare = invokeApproval();
    delete bare["fee"];
    delete bare["feeEstimateFailed"];
    delete bare["feeEstimatePending"];
    delete bare["requiresDeployment"];
    expect(isPendingApprovalsResponse(response(bare))).toBe(true);
  });

  test("rejects a malformed fee", () => {
    for (const fee of [
      { overallFee: "not-a-number", unit: "FRI" },
      { overallFee: "1", unit: "fri" },
      { overallFee: "1", unit: "FRI", extra: true },
      { overallFee: 1, unit: "FRI" },
      "0.0025 STRK",
    ]) {
      expect(isPendingApprovalsResponse(response(invokeApproval({ fee })))).toBe(false);
    }
  });

  test("rejects inconsistent combinations", () => {
    // An amount alongside a failure, or alongside a pending deployment,
    // contradicts resolveReviewFee's classification.
    expect(isPendingApprovalsResponse(response(invokeApproval({ feeEstimateFailed: true })))).toBe(
      false,
    );
    expect(isPendingApprovalsResponse(response(invokeApproval({ requiresDeployment: true })))).toBe(
      false,
    );
    expect(
      isPendingApprovalsResponse(
        response(invokeApproval({ fee: null, feeEstimateFailed: true, requiresDeployment: true })),
      ),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse(
        response(invokeApproval({ fee: null, feeEstimatePending: true, requiresDeployment: true })),
      ),
    ).toBe(false);
    expect(isPendingApprovalsResponse(response(invokeApproval({ feeEstimatePending: true })))).toBe(
      false,
    );
    expect(
      isPendingApprovalsResponse(
        response(invokeApproval({ fee: null, feeEstimateFailed: true, feeEstimatePending: true })),
      ),
    ).toBe(false);
  });

  test("accepts only a well-formed pending estimate state", () => {
    expect(
      isPendingApprovalsResponse(response(invokeApproval({ fee: null, feeEstimatePending: true }))),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse(response(invokeApproval({ feeEstimatePending: "yes" }))),
    ).toBe(false);
  });

  test("rejects the fee review on non-invoke kinds", () => {
    const connect = {
      fee: { overallFee: "1", unit: "FRI" },
      feeEstimatePending: false,
      id: INVOKE_ID,
      kind: "connect",
      origin: "https://dapp.example",
    };
    expect(isPendingApprovalsResponse(response(connect))).toBe(false);
  });

  test("still rejects genuinely unknown keys", () => {
    expect(isPendingApprovalsResponse(response(invokeApproval({ surprise: true })))).toBe(false);
  });
});

// Affordability verdict validation (issue 191): the verdict is one of the
// predicate's three values, needs an estimate to claim anything, and stays
// invoke-only like the rest of the fee review.
describe("PendingApproval fee affordability validation (issue 191)", () => {
  test("accepts every predicate verdict alongside an estimate", () => {
    for (const feeAffordability of ["insufficient", "ok", "unknown"]) {
      expect(isPendingApprovalsResponse(response(invokeApproval({ feeAffordability })))).toBe(true);
    }
  });

  test("rejects an unknown verdict value", () => {
    expect(
      isPendingApprovalsResponse(response(invokeApproval({ feeAffordability: "maybe" }))),
    ).toBe(false);
  });

  test("rejects a claim without an estimate to compare against", () => {
    for (const feeAffordability of ["insufficient", "ok"]) {
      expect(
        isPendingApprovalsResponse(response(invokeApproval({ fee: null, feeAffordability }))),
      ).toBe(false);
    }
    expect(
      isPendingApprovalsResponse(
        response(invokeApproval({ fee: null, feeAffordability: "unknown" })),
      ),
    ).toBe(true);
  });
});
