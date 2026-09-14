/**
 * What a rejected invoke tells each side. The dapp boundary may only ever see the
 * curated message, while the panel — the surface a person actually reads — also
 * gets the node's own reason as `detail`, so a transaction the network refused
 * can be understood and reported instead of collapsing to "invoke request
 * failed".
 *
 * Split from ./background-invoke-approval for the file-size budget; that suite
 * owns the approval gate itself, this one owns failure reporting.
 */
import { describe, expect, test } from "bun:test";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { flushHeld, latestApprovalId, reviewedApprovalFee } from "../../support/held";
import {
  invokeAccount as account,
  invokeContentSender as contentSender,
  invokeExtensionSender as extensionSender,
  invokeMessage,
  invokeVaultPassphrase as vaultPassphrase,
  invokeWalletStub as walletStub,
} from "../../support/invoke-approval-harness";

// A node rejects an underfunded invoke with a plain Error, not a WalletError, so
// `walletErrorMessage` collapses it to "invoke request failed" — correct for the
// page and useless to the user. The reason travels as `detail` on the panel's
// response only; the held dapp promise must never see it.
const makeRejectingSubmitHarness = (reason: unknown) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const rpc = {
    // The estimate has to succeed: a reviewed fee is what binds the user's
    // consent, and an approval without one is refused before it can submit
    // (MCW-V09-119). The failure under test is the broadcast, not the quote.
    async estimateInvokeFee() {
      return { overallFee: "1", unit: "FRI" as const };
    },
    async getDeploymentStatus() {
      return true;
    },
    async getTokenBalances() {
      return [];
    },
    async submitInvokeTransaction(): Promise<never> {
      throw reason;
    },
  } as unknown as RuntimeRpc;
  const handler = createMessageHandler(walletStub([account]), "extension-id", {
    activity: memoryActivityLog(),
    approvals: createApprovalQueue(),
    preferencesStore: unavailablePreferencesStore,
    runtimeRpc: rpc,
    session,
  });
  return { handler };
};

describe("a rejected invoke explains itself to the panel only", () => {
  const REASON = "Account balance is smaller than the transaction's max_fee";

  test("the panel gets the node's reason and the dapp gets the curated message", async () => {
    const { handler } = makeRejectingSubmitHarness(
      Object.assign(new Error('RPC: starknet_estimateFee with params {"request":["0xtrade"]}'), {
        baseError: {
          code: 41,
          data: { execution_error: REASON },
          message: "Transaction execution error",
        },
      }),
    );

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);

    // The panel's own response carries the reason, so the side panel can show and
    // copy why the transaction died.
    await expect(
      handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({
      detail: `41 Transaction execution error ${REASON}`,
      error: "invoke request failed",
    });
    // The dapp boundary sees the curated message and nothing else: `detail` is an
    // uncurated node string and must not cross to the page.
    await expect(held).resolves.toEqual({ error: "invoke request failed" });
  });

  test("no detail is added when the reason is already the curated message", async () => {
    const { handler } = makeRejectingSubmitHarness("invoke request failed");

    const held = handler(invokeMessage(), contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);

    // Nothing to add, so the field is omitted rather than echoing the message.
    await expect(
      handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({
      error: "invoke request failed",
    });
    await expect(held).resolves.toEqual({ error: "invoke request failed" });
  });
});
