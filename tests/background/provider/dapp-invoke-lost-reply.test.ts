/**
 * Audit M4: a dapp invoke whose broadcast reply was lost may already be on
 * chain. The approval must answer with the typed "status unknown" refusal and
 * leave the signed hash as a pending Activity row, as the wallet's own send
 * does, so the "check activity" the panel shows points at something and a
 * second approval of the same request is not invited blind.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { postDeploymentFailure } from "@bramble/starknet/rpc-submit";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { readSubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId, reviewedApprovalFee } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const SIGNED = "0x5eed";

type Submit = Parameters<typeof makeRuntimeRpc>[0] extends infer O
  ? O extends { submitInvokeTransaction?: infer F }
    ? F
    : never
  : never;

const TRANSFER = {
  calldata: ["0x777", "1", "0"],
  contractAddress: "0xabc",
  entrypoint: "transfer",
};

const approveInvoke = async (
  submitInvokeTransaction: NonNullable<Submit>,
  calls = [TRANSFER],
  activity = memoryActivityLog(() => 1),
) => {
  const allowanceStore = memoryAllowanceStore();
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  // The stub vault lives on SN_SEPOLIA.
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(createWallet(), testExtension, {
    activity,
    allowanceStore,
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({ submitInvokeTransaction }),
    session,
  });
  const held = handler(
    {
      calls,
      origin: grantedOrigin,
      type: "wallet.addInvokeTransaction",
    },
    contentSender,
  );
  await flushHeld();
  const id = await latestApprovalId(handler, extensionSender);
  const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);
  const panel = await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
  const dapp = await held;
  return { activity, allowanceStore, dapp, panel };
};

describe("a dapp invoke with a lost broadcast reply", () => {
  test("answers status unknown and records the signed hash as pending", async () => {
    const { activity, dapp, panel } = await approveInvoke(async (input) => {
      await input.onSigned?.({
        nonce: "0x1",
        senderAddress: account.address,
        transactionHash: SIGNED,
      });
      throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
    });

    expect(readSubmissionUnknownError(panel)?.transactionHash).toBe(SIGNED);
    // The site is still told the request did not succeed.
    expect(dapp).toHaveProperty("error");
    const rows = await activity.list();
    expect(rows.map((row) => [row.hash, row.status, row.kind])).toEqual([
      [SIGNED, "pending", "invoke"],
    ]);
  });

  // #678: the grant a lost-reply approve may have made must stay listed and
  // revokable, filed under the signed hash like the activity row.
  test("files the approve's grant under the signed hash", async () => {
    const approve = {
      calldata: ["0x7a11", "0x5", "0x0"],
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: "approve",
    };
    const { activity, allowanceStore, panel } = await approveInvoke(
      async (input) => {
        await input.onSigned?.({
          nonce: "0x1",
          senderAddress: account.address,
          transactionHash: SIGNED,
        });
        throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
      },
      [approve],
    );

    expect(readSubmissionUnknownError(panel)?.transactionHash).toBe(SIGNED);
    const grants = await allowanceStore.list();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ accountId: account.id, amount: "5" });
    expect((await activity.list()).map((row) => row.hash)).toEqual([SIGNED]);
  });

  // #678 hardening: once a hash exists the reply carries it, even when the
  // local activity write fails afterwards.
  test("answers with the hash when a confirmed send's bookkeeping fails", async () => {
    const failing = memoryActivityLog(() => 1);
    const broken = {
      ...failing,
      record: async () => {
        throw new Error("storage quota exceeded");
      },
    };
    const { dapp, panel } = await approveInvoke(
      async (input) => ({ calls: input.calls, transactionHash: "0x7cd" }),
      [TRANSFER],
      broken,
    );
    expect(panel).toMatchObject({ ok: true });
    expect(JSON.stringify(dapp)).toContain("0x7cd");
    expect(dapp).not.toHaveProperty("error");
  });

  test("stays status unknown with no row when nothing was signed", async () => {
    const { activity, panel } = await approveInvoke(async () => {
      throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
    });

    expect(readSubmissionUnknownError(panel)?.transactionHash).toBeNull();
    expect(await activity.list()).toEqual([]);
  });

  test("keeps a determinate failure a plain error with no row", async () => {
    const { activity, panel } = await approveInvoke(async (input) => {
      await input.onSigned?.({
        nonce: "0x1",
        senderAddress: account.address,
        transactionHash: SIGNED,
      });
      throw new Error("RPC refused the transaction");
    });

    expect(readSubmissionUnknownError(panel)).toBeNull();
    expect(panel).toHaveProperty("error");
    expect(await activity.list()).toEqual([]);
  });
});

// mc-wallet 719: an approved dapp invoke from an undeployed account deploys it
// first. That accepted deployment is recorded, including when the invoke after
// it is refused or loses its reply, since its fee is spent.
describe("a dapp invoke that deploys the account first", () => {
  const DEPLOY = "0xd3a1";
  const rowsOf = async (activity: Awaited<ReturnType<typeof approveInvoke>>["activity"]) =>
    (await activity.list()).map((row) => [row.kind, row.hash]);

  test("records the deployment beside the invoke", async () => {
    const { activity, panel } = await approveInvoke(async () => ({
      calls: [],
      deploymentTransactionHash: DEPLOY,
      transactionHash: SIGNED,
    }));
    expect(panel).toMatchObject({ ok: true });
    expect(await rowsOf(activity)).toEqual([
      ["deploy", DEPLOY],
      ["invoke", SIGNED],
    ]);
  });

  test("still records the deployment when the invoke after it is refused", async () => {
    const { activity, panel } = await approveInvoke(async () => {
      throw postDeploymentFailure(DEPLOY, new Error("invoke rejected"));
    });
    expect(panel).toHaveProperty("error");
    expect(readSubmissionUnknownError(panel)).toBeNull();
    expect(await rowsOf(activity)).toEqual([["deploy", DEPLOY]]);
  });

  test("still records the deployment when the reply is lost, and stays unknown", async () => {
    const { activity, panel } = await approveInvoke(async (input) => {
      await input.onSigned?.({
        nonce: "0x1",
        senderAddress: account.address,
        transactionHash: SIGNED,
      });
      throw postDeploymentFailure(DEPLOY, new IndeterminateRpcWriteError("reply lost"));
    });
    expect(readSubmissionUnknownError(panel)?.transactionHash).toBe(SIGNED);
    expect(await rowsOf(activity)).toEqual([
      ["deploy", DEPLOY],
      ["invoke", SIGNED],
    ]);
  });

  test("records no deployment when none was sent", async () => {
    const { activity } = await approveInvoke(async () => ({ calls: [], transactionHash: SIGNED }));
    expect(await rowsOf(activity)).toEqual([["invoke", SIGNED]]);
  });
});
