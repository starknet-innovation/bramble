/** Invoke-fee snapshot and retry-update invariants for the approval queue. */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";

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

  test("updateFee replaces the invoke review and leaves the payload intact", () => {
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

    const revision = queue.beginFeeEstimate(id);
    if (!revision) {
      throw new Error("expected a fee-slot claim for a queued invoke");
    }
    const updated = queue.updateFee(revision, {
      kind: "invoke",
      review: {
        fee: { overallFee: "77", unit: "FRI" },
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
    });
    expect(updated).toMatchObject({ fee: { overallFee: "77", unit: "FRI" } });
    expect(queue.get(id)?.feeEstimateFailed).toBe(false);
    expect(queue.payload(id)).toEqual({ calls });
  });

  // Two wallet surfaces can each press "retry fee" on the same card, and the
  // wallet cannot control which node answers first. Whichever estimate was
  // STARTED last is the one the card ends up showing, so it must also be the one
  // the queue holds — the older estimate resolving last must write nothing, or
  // the approval is bound to a ceiling no surface ever displayed.
  test("an estimate that resolves after a newer one writes nothing", () => {
    const queue = createApprovalQueue();
    const review = (overallFee: string) => ({
      fee: { overallFee, unit: "FRI" },
      feeAffordability: "unknown" as const,
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    });
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: {
        fee: null,
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: true,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });

    const older = queue.beginFeeEstimate(id);
    const newer = queue.beginFeeEstimate(id);
    if (!older || !newer) {
      throw new Error("expected both fee-slot claims for a queued invoke");
    }
    expect(queue.updateFee(newer, { kind: "invoke", review: review("9999999") })).toMatchObject({
      fee: { overallFee: "9999999", unit: "FRI" },
    });
    expect(queue.updateFee(older, { kind: "invoke", review: review("2000") })).toBeNull();
    expect(queue.get(id)?.fee).toEqual({ overallFee: "9999999", unit: "FRI" });
    // The superseded write is dropped whole: a stale "still estimating" marker
    // would disable the approve button for an estimate that already landed.
    expect(queue.get(id)?.feeEstimatePending).toBe(false);
  });

  test("a fresh estimate clears a previous attempt's failure detail", () => {
    const queue = createApprovalQueue();
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: {
        fee: null,
        feeAffordability: "unknown",
        feeEstimateDetail: "40 Contract error: entry point not found",
        feeEstimateFailed: true,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });
    expect(queue.get(id)?.feeEstimateDetail).toBe("40 Contract error: entry point not found");

    // A retry that succeeds must not leave the earlier reason on the card: the
    // detail slot is replaced wholesale, never merged over.
    const revision = queue.beginFeeEstimate(id);
    if (!revision) {
      throw new Error("expected a fee-slot claim for a queued invoke");
    }
    queue.updateFee(revision, {
      kind: "invoke",
      review: {
        fee: { overallFee: "77", unit: "FRI" },
        feeAffordability: "unknown",
        feeEstimateFailed: false,
        feeEstimatePending: false,
        requiresDeployment: false,
      },
    });
    expect(queue.get(id)?.feeEstimateDetail).toBeUndefined();
    expect(Object.hasOwn(queue.get(id) ?? {}, "feeEstimateDetail")).toBe(false);
  });

  test("updateFee rejects unknown ids and approvals with another kind", () => {
    const queue = createApprovalQueue();
    const connect = queue.request(ORIGIN);
    const review = {
      fee: null,
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      feeEstimatePending: false,
      requiresDeployment: false,
    } as const;

    expect(queue.beginFeeEstimate("9e107d9d-372b-4b6b-8d0a-df1b6c8f6e01")).toBeNull();
    expect(queue.beginFeeEstimate(connect.id)).toBeNull();
    expect(
      queue.updateFee(
        { id: "9e107d9d-372b-4b6b-8d0a-df1b6c8f6e01", revision: 1 },
        { kind: "invoke", review },
      ),
    ).toBeNull();
    expect(queue.updateFee({ id: connect.id, revision: 1 }, { kind: "invoke", review })).toBeNull();
    expect(queue.get(connect.id)?.fee).toBeUndefined();
  });
});
