/**
 * Boundary validation for the invoke approval's fee review (#189): `fee`,
 * `feeEstimateFailed`, and `requiresDeployment` travel on `PendingApproval`,
 * are validated by the existing fee predicate, stay internally consistent with
 * `resolveReviewFee`'s classification, and never leak onto other approval
 * kinds. Extension messages are untrusted — a malformed fee rejects the whole
 * response rather than rendering.
 */
import { describe, expect, test } from "bun:test";
import { isPendingApprovalsResponse } from "../../src/popup/approvals-responses";
import { STARKNET_NETWORKS } from "../../src/starknet/networks";

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
  });

  test("rejects the fee review on non-invoke kinds", () => {
    const connect = {
      fee: { overallFee: "1", unit: "FRI" },
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
