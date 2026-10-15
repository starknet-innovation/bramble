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
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
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

const approveInvoke = async (submitInvokeTransaction: NonNullable<Submit>) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const activity = memoryActivityLog(() => 1);
  // The stub vault lives on SN_SEPOLIA.
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(createWallet(), testExtension, {
    activity,
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({ submitInvokeTransaction }),
    session,
  });
  const held = handler(
    {
      calls: [{ calldata: ["0x777", "1", "0"], contractAddress: "0xabc", entrypoint: "transfer" }],
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
  return { activity, dapp, panel };
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
