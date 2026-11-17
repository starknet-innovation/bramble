/**
 * Issue 851: a dapp invoke from an undeployed OpenZeppelin or Argent account
 * reviews its invoke and its deployment, the card's Approve echoes their sum,
 * and each half reaches submission as its own ceiling. Before this, the review
 * skipped both estimates, the card had nothing to bind, and the request could
 * never be approved. Braavos keeps its deploy-first refusal (see
 * `./undeployed-braavos-approval.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import { estimateInvokeApprovalFee } from "../../../apps/extension/src/background/approvals/invoke-fee-review";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  invokeAccount,
  invokeContentSender,
  invokeExtensionSender,
  invokeMessage,
  makeInvokeHarness,
} from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const INVOKE_FEE: FeeEstimate = { overallFee: "100", unit: "FRI" };
const DEPLOYMENT_FEE: FeeEstimate = { overallFee: "250", unit: "FRI" };
const TOTAL: FeeEstimate = { overallFee: "350", unit: "FRI" };

type Pending = {
  readonly deploymentFee?: FeeEstimate | null;
  readonly deploymentFeeEstimateFailed?: boolean;
  readonly fee?: FeeEstimate | null;
  readonly feeEstimatePending?: boolean;
  readonly id: string;
  readonly requiresDeployment?: boolean;
};

const undeployedRpc = (overrides: Partial<RuntimeRpc> = {}): Partial<RuntimeRpc> => ({
  async estimateAccountDeploymentFee() {
    return DEPLOYMENT_FEE;
  },
  async estimateInvokeFee() {
    return INVOKE_FEE;
  },
  async getDeploymentStatus() {
    return false;
  },
  ...overrides,
});

// Queues one invoke and returns its settled review plus the held request.
const queue = async (account: AccountRef, rpc: Partial<RuntimeRpc>) => {
  const harness = makeInvokeHarness([account], undefined, rpc);
  const held = harness.handler(invokeMessage(), invokeContentSender);
  const id = await latestApprovalId(harness.handler, invokeExtensionSender);
  const settled = async (): Promise<Pending> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const pending = (
        await waitForPendingApprovals<Pending>(harness.handler, invokeExtensionSender)
      ).find((entry) => entry.id === id);
      if (pending && pending.feeEstimatePending !== true) return pending;
      await flushHeld();
    }
    throw new Error("fee review did not settle");
  };
  const approve = (reviewedFee?: FeeEstimate) =>
    harness.handler(
      { id, ...(reviewedFee ? { reviewedFee } : {}), type: "wallet.approveOrigin" },
      invokeExtensionSender,
    );
  return { ...harness, approve, held, id, settled };
};

describe("dapp invoke from an undeployed account (issue 851)", () => {
  for (const accountContractType of ["openzeppelin", "argent"] as const) {
    test(`${accountContractType}: reviews both halves and submits under both ceilings`, async () => {
      const account = { ...invokeAccount, accountContractType } as AccountRef;
      const { approve, held, invoked, settled } = await queue(account, undeployedRpc());

      expect(await settled()).toMatchObject({
        deploymentFee: DEPLOYMENT_FEE,
        deploymentFeeEstimateFailed: false,
        fee: INVOKE_FEE,
        requiresDeployment: true,
      });

      expect(await approve(TOTAL)).toMatchObject({ ok: true });
      await expect(held).resolves.toMatchObject({ transactionHash: "0x7cd" });
      expect(invoked).toHaveLength(1);
      expect(invoked[0]?.reviewedFee).toEqual(INVOKE_FEE);
      expect(invoked[0]?.reviewedDeploymentFee).toEqual(DEPLOYMENT_FEE);
    });
  }

  test("refuses an echo of the invoke fee alone, or no echo, and submits nothing", async () => {
    const { approve, handler, held, id, invoked, settled } = await queue(
      invokeAccount,
      undeployedRpc(),
    );
    await settled();

    expect(await approve(INVOKE_FEE)).toEqual({
      error: "the fee changed since this request was reviewed",
    });
    expect(await approve()).toEqual({
      error: "retry the fee estimate before approving this transaction",
    });
    expect(invoked).toHaveLength(0);

    await handler({ id, type: "wallet.denyOrigin" }, invokeExtensionSender);
    await expect(held).resolves.toEqual({ error: "request rejected" });
  });

  test("an unpriced deployment refuses approval until a retry prices it", async () => {
    let deploymentAttempts = 0;
    const { approve, handler, held, id, invoked, settled } = await queue(
      invokeAccount,
      undeployedRpc({
        async estimateAccountDeploymentFee() {
          deploymentAttempts += 1;
          if (deploymentAttempts === 1) throw new WalletError("rpc unreachable");
          return DEPLOYMENT_FEE;
        },
      }),
    );

    expect(await settled()).toMatchObject({
      deploymentFee: null,
      deploymentFeeEstimateFailed: true,
      fee: INVOKE_FEE,
    });
    expect(await approve(INVOKE_FEE)).toEqual({
      error: "retry the fee estimate before approving this transaction",
    });
    expect(invoked).toHaveLength(0);

    await expect(
      handler({ id, type: "wallet.retryApprovalFee" }, invokeExtensionSender),
    ).resolves.toEqual({ ok: true });
    expect(await settled()).toMatchObject({
      deploymentFee: DEPLOYMENT_FEE,
      deploymentFeeEstimateFailed: false,
    });
    expect(await approve(TOTAL)).toMatchObject({ ok: true });
    await expect(held).resolves.toMatchObject({ transactionHash: "0x7cd" });
    expect(invoked[0]?.reviewedDeploymentFee).toEqual(DEPLOYMENT_FEE);
  });

  test("an unreadable deployment status fails closed to a retry", async () => {
    let statusReads = 0;
    const { approve, handler, held, id, invoked, settled } = await queue(
      invokeAccount,
      undeployedRpc({
        async getDeploymentStatus() {
          statusReads += 1;
          if (statusReads === 1) throw new WalletError("rpc unreachable");
          return false;
        },
      }),
    );

    // Neither an invoke-only figure nor a guessed deployment is quoted.
    expect(await settled()).toMatchObject({ fee: null, feeEstimateFailed: true });
    expect(await approve(INVOKE_FEE)).toEqual({
      error: "retry the fee estimate before approving this transaction",
    });
    expect(invoked).toHaveLength(0);

    await handler({ id, type: "wallet.retryApprovalFee" }, invokeExtensionSender);
    expect(await settled()).toMatchObject({ deploymentFee: DEPLOYMENT_FEE, fee: INVOKE_FEE });
    expect(await approve(TOTAL)).toMatchObject({ ok: true });
    await held;
    expect(invoked[0]?.reviewedDeploymentFee).toEqual(DEPLOYMENT_FEE);
  });

  test("a retry after deployment drops the deployment half", async () => {
    let deployed = false;
    const { approve, handler, held, id, invoked, settled } = await queue(
      invokeAccount,
      undeployedRpc({
        async getDeploymentStatus() {
          return deployed;
        },
      }),
    );
    expect(await settled()).toMatchObject({ deploymentFee: DEPLOYMENT_FEE });

    deployed = true;
    await handler({ id, type: "wallet.retryApprovalFee" }, invokeExtensionSender);
    const refreshed = await settled();
    expect(refreshed).not.toHaveProperty("deploymentFee");
    expect(refreshed).not.toHaveProperty("deploymentFeeEstimateFailed");
    expect(refreshed.requiresDeployment).toBe(false);
    // The old total no longer binds; the invoke fee alone now does.
    expect(await approve(TOTAL)).toEqual({
      error: "the fee changed since this request was reviewed",
    });
    expect(await approve(INVOKE_FEE)).toMatchObject({ ok: true });
    await held;
    expect(invoked[0]).not.toHaveProperty("reviewedDeploymentFee");
  });

  test("a proof-bearing invoke from an undeployed account is deploy-first", async () => {
    let estimates = 0;
    const review = await estimateInvokeApprovalFee(
      {
        runtimeRpc: makeRuntimeRpc(
          undeployedRpc({
            async estimateInvokeFee() {
              estimates += 1;
              return INVOKE_FEE;
            },
          }),
        ),
      },
      {
        account: invokeAccount,
        calls: [{ calldata: [], contractAddress: "0x123", entrypoint: "apply_actions" }],
        preferences: defaultWalletPreferences(),
        proof: {} as Strk20Proof,
        signer: () => async () => ({ publicKey: invokeAccount.publicKeyX, r: "0x1", s: "0x2" }),
      },
    );
    expect(review).toMatchObject({ deployFirst: true, fee: null, requiresDeployment: true });
    expect(estimates).toBe(0);
  });

  test("a deployed account carries no deployment half and no deployment ceiling", async () => {
    const { approve, held, invoked, settled } = await queue(
      invokeAccount,
      undeployedRpc({
        async getDeploymentStatus() {
          return true;
        },
      }),
    );
    const pending = await settled();
    expect(pending).not.toHaveProperty("deploymentFee");
    expect(pending.requiresDeployment).toBe(false);

    expect(await approve(INVOKE_FEE)).toMatchObject({ ok: true });
    await held;
    expect(invoked[0]?.reviewedFee).toEqual(INVOKE_FEE);
    expect(invoked[0]).not.toHaveProperty("reviewedDeploymentFee");
  });
});
