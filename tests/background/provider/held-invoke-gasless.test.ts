/**
 * A pool-backed approval cannot spend a gasless choice. The STRK20 lane is the
 * one that carries the proof; ignoring the choice would submit a different fee.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import type { GaslessFeeOffer } from "@bramble/transactions/gasless-request";
import { submitHeldInvoke } from "../../../apps/extension/src/background/provider/held-invoke-submit";

const offer: GaslessFeeOffer = {
  amount: "10",
  decimals: 6,
  label: "USDC",
  tokenAddress: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

describe("submitHeldInvoke gasless choice", () => {
  test("refuses a gasless choice on a pool batch and does not submit it", async () => {
    let prepared = 0;
    const input = {
      approval: { gaslessFee: offer, payload: { calls: [] } },
      poolProof: { mode: "execute" },
      strk20: {
        submitPrepared: async () => {
          prepared += 1;
          return { transactionHash: "0x1" };
        },
      },
    } as unknown as Parameters<typeof submitHeldInvoke>[0];
    await expect(submitHeldInvoke(input)).rejects.toThrow(WalletError);
    expect(prepared).toBe(0);
  });

  test("refuses a gasless choice on a non-pool proof and does not submit it", async () => {
    let prepared = 0;
    const input = {
      approval: { gaslessFee: offer, payload: { calls: [], proof: { mode: "execute" } } },
      strk20: {
        submitPrepared: async () => {
          prepared += 1;
          return { transactionHash: "0x2" };
        },
      },
    } as unknown as Parameters<typeof submitHeldInvoke>[0];
    await expect(submitHeldInvoke(input)).rejects.toThrow(WalletError);
    expect(prepared).toBe(0);
  });

  // Issue 851: only the public lane deploys an account before its calls, so a
  // reviewed deployment on the pool or gasless lane is refused, not dropped.
  test("refuses a reviewed deployment on the pool or gasless lane", async () => {
    let submitted = 0;
    const count = async () => {
      submitted += 1;
      return { transactionHash: "0x5" };
    };
    const deployment = { reviewedDeploymentFee: { overallFee: "2", unit: "FRI" } };
    for (const lane of [
      { approval: { payload: { calls: [] } }, poolProof: { mode: "execute" } },
      { approval: { gaslessFee: offer, payload: { calls: [] } } },
    ]) {
      const input = {
        ...lane,
        calls: [],
        ceiling: deployment,
        context: {},
        deps: { prices: {} },
        runtimeRpc: { submitInvokeTransaction: count },
        strk20: { submitPrepared: count },
      } as unknown as Parameters<typeof submitHeldInvoke>[0];
      await expect(submitHeldInvoke(input)).rejects.toThrow(WalletError);
    }
    expect(submitted).toBe(0);
  });

  test("still submits a pool batch that did not choose a gasless fee", async () => {
    let prepared = 0;
    const input = {
      approval: { payload: { calls: [] } },
      calls: [],
      context: {},
      ceiling: {},
      poolProof: { mode: "execute" },
      strk20: {
        submitPrepared: async () => {
          prepared += 1;
          return { transactionHash: "0x4" };
        },
      },
    } as unknown as Parameters<typeof submitHeldInvoke>[0];
    await expect(submitHeldInvoke(input)).resolves.toMatchObject({ transactionHash: "0x4" });
    expect(prepared).toBe(1);
  });
});
