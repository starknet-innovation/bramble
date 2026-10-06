/**
 * A dapp invoke from an undeployed Braavos account is reviewed as "deploy this
 * account first": it deploys only through its own reviewed step, so the card
 * must not offer a fee, a retry, or an Approve that could bind one. The state
 * is identified by account state or the platform's typed refusal — never by
 * message text — and a later review replaces it rather than inheriting it.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { UndeployedBraavosError } from "@bramble/starknet/deployment";
import {
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  UNDEPLOYED_BRAAVOS_REFUSAL,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  createApprovalQueue,
  type InvokeFeeReview,
} from "../../../apps/extension/src/background/approvals/approvals";
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

const braavos = {
  ...invokeAccount,
  accountContractType: "braavos",
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
} as AccountRef;
const CALL = { calldata: [], contractAddress: "0x123", entrypoint: "transfer" };

const estimate = (rpc: RuntimeRpc, account: AccountRef, signers: string[] = []) =>
  estimateInvokeApprovalFee(
    { runtimeRpc: rpc },
    {
      account,
      calls: [CALL],
      preferences: defaultWalletPreferences(),
      signer: () => {
        signers.push("built");
        return async () => ({ publicKey: account.publicKeyX, r: "0x1", s: "0x2" });
      },
    },
  );

const DEPLOY_FIRST: InvokeFeeReview = {
  deployFirst: true,
  fee: null,
  feeAffordability: "unknown",
  feeEstimateFailed: false,
  feeEstimatePending: false,
  requiresDeployment: true,
};

describe("estimateInvokeApprovalFee", () => {
  test("answers deploy-first for an undeployed Braavos account without estimating", async () => {
    const signers: string[] = [];
    let estimated = 0;
    const rpc = makeRuntimeRpc({
      async estimateInvokeFee() {
        estimated += 1;
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return false;
      },
    });
    expect(await estimate(rpc, braavos, signers)).toEqual(DEPLOY_FIRST);
    expect(estimated).toBe(0);
    expect(signers).toEqual([]);
  });

  test("answers deploy-first on the platform's typed refusal", async () => {
    const rpc = makeRuntimeRpc({
      async estimateInvokeFee() {
        throw new UndeployedBraavosError();
      },
    });
    expect(await estimate(rpc, braavos)).toEqual(DEPLOY_FIRST);
  });

  test("leaves every other failure, and every other account, as before", async () => {
    const failing = makeRuntimeRpc({
      async estimateInvokeFee() {
        throw new Error(UNDEPLOYED_BRAAVOS_REFUSAL);
      },
    });
    const failed = await estimate(failing, braavos);
    expect(failed).toMatchObject({ fee: null, feeEstimateFailed: true });
    expect(failed).not.toHaveProperty("deployFirst");
    const undeployed = makeRuntimeRpc({
      async getDeploymentStatus() {
        return false;
      },
    });
    const oz = await estimate(undeployed, invokeAccount);
    expect(oz).toMatchObject({ fee: null, requiresDeployment: true });
    expect(oz).not.toHaveProperty("deployFirst");
  });
});

test("the approval card carries deploy-first, refuses approval, and drops it once deployed", async () => {
  let deployed = false;
  const { handler, invoked } = makeInvokeHarness([braavos], undefined, {
    async getDeploymentStatus() {
      return deployed;
    },
  });
  const held = handler(invokeMessage(), invokeContentSender);
  const id = await latestApprovalId(handler, invokeExtensionSender);
  await flushHeld();
  await flushHeld();
  const painted = async () =>
    (
      await waitForPendingApprovals<{ readonly deployFirst?: true; readonly id: string }>(
        handler,
        invokeExtensionSender,
      )
    ).find((approval) => approval.id === id);
  expect((await painted())?.deployFirst).toBe(true);

  await expect(
    handler(
      { id, reviewedFee: { overallFee: "1", unit: "FRI" }, type: "wallet.approveOrigin" },
      invokeExtensionSender,
    ),
  ).resolves.toEqual({ error: UNDEPLOYED_BRAAVOS_REFUSAL });
  expect(invoked).toHaveLength(0);

  // Deployed through its own step: a fresh review must not inherit the state.
  deployed = true;
  await handler({ id, type: "wallet.retryApprovalFee" }, invokeExtensionSender);
  expect(await painted()).not.toHaveProperty("deployFirst");
  await handler({ id, type: "wallet.denyOrigin" }, invokeExtensionSender);
  await held;
});

test("the queue snapshots a deploy-first review given at request time", () => {
  const queue = createApprovalQueue();
  const { id } = queue.requestInvoke({
    calls: [CALL],
    context: {
      accountId: braavos.id,
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      payloadDigest: `sha256:${"a".repeat(64)}`,
    },
    fee: DEPLOY_FIRST,
    flags: [],
    origin: "https://dapp.example",
    summaries: ["Invoke"],
  });
  expect(queue.get(id)).toMatchObject({ deployFirst: true, fee: null, requiresDeployment: true });
});
