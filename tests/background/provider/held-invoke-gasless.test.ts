/**
 * A pool-backed approval cannot spend a gasless choice. The STRK20 lane is the
 * one that carries the proof; ignoring the choice would submit a different fee.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";
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
