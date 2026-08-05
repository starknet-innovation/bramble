/** Invoke-fee snapshot and retry-update invariants for the approval queue. */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../../src/background/approvals";

const ORIGIN = "https://fee.example";
const CONTEXT = {
  accountId: "SN_MAIN:0x1",
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};
const calls = [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }];

describe("createApprovalQueue invoke fee review", () => {
  test("carries the fee review on snapshots and isolates it from callers", () => {
    const queue = createApprovalQueue();
    const fee = { overallFee: "1200", unit: "FRI" };
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: {
        fee,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });

    const snapshot = queue.get(id);
    expect(snapshot).toMatchObject({
      fee: { overallFee: "1200", unit: "FRI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    });
    fee.overallFee = "9999";
    (snapshot?.fee as { overallFee: string }).overallFee = "8888";
    expect(queue.get(id)?.fee).toEqual({ overallFee: "1200", unit: "FRI" });
  });

  test("updateInvokeFee replaces the fee review and leaves the payload intact", () => {
    const queue = createApprovalQueue();
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: {
        fee: null,
        feeAffordability: "unknown",
        feeEstimateFailed: true,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });

    const updated = queue.updateInvokeFee(id, {
      fee: { overallFee: "77", unit: "FRI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    });
    expect(updated).toMatchObject({ fee: { overallFee: "77", unit: "FRI" } });
    expect(queue.get(id)?.feeEstimateFailed).toBe(false);
    expect(queue.payload(id)).toEqual({ calls });
  });

  test("updateInvokeFee rejects unknown ids and non-invoke approvals", () => {
    const queue = createApprovalQueue();
    const connect = queue.request(ORIGIN);
    const review = {
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    } as const;

    expect(queue.updateInvokeFee("9e107d9d-372b-4b6b-8d0a-df1b6c8f6e01", review)).toBeNull();
    expect(queue.updateInvokeFee(connect.id, review)).toBeNull();
    expect(queue.get(connect.id)?.fee).toBeUndefined();
  });
});
