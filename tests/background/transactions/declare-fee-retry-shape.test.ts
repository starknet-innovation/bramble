/**
 * Retrying a declaration fee estimate keeps the card on screen (Sherlock 241).
 *
 * The retry withdraws the reviewed fee before re-estimating, so nothing can be
 * approved against a fee that is being replaced. The withdrawn shape must be
 * one the panel's validator accepts: an "estimating" shape (no fee, no
 * failure) was dropped by `readPendingApprovals`, so the card the user had just
 * clicked vanished, and an early return (a lock, a network change, a revoked
 * grant) left it gone. The withdrawn shape is now a failed estimate, which the
 * panel renders with its retry control and the background still refuses to
 * approve.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { createMemoryStore } from "@bramble/store/kv";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { readPendingApprovals } from "../../../packages/presentation/wallet-ui/src/popup/responses/approvals-responses";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const FEE: FeeEstimate = { overallFee: "1000", unit: "FRI" };
const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

const harness = async () => {
  const session = createUnlockSession();
  let estimates = 0;
  let release: ((fee: FeeEstimate) => void) | undefined;
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const handler = createMessageHandler(createWallet(), testExtension, {
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      // The first estimate answers at once; a retry waits for the test.
      estimateDeclareFee() {
        estimates += 1;
        return estimates === 1
          ? Promise.resolve(FEE)
          : new Promise<FeeEstimate>((resolve) => {
              release = resolve;
            });
      },
      async getDeploymentStatus() {
        return true;
      },
    }),
    session,
  });
  session.unlock(vaultPassphrase);
  void handler(
    { declare, origin: grantedOrigin, type: "wallet.addDeclareTransaction" },
    contentSender,
  );
  await flushHeld();
  const id = await latestApprovalId(handler, extensionSender);
  // What the panel would render: the queue read through the panel's own parser.
  const panelCards = async () =>
    readPendingApprovals(await handler({ type: "wallet.pendingApprovals" }, extensionSender));
  return { handler, id, panelCards, release: (fee: FeeEstimate) => release?.(fee), session };
};

describe("declaration fee retry", () => {
  test("keeps the card while the estimate is redone, and refuses approval meanwhile", async () => {
    const { handler, id, panelCards, release } = await harness();
    const retry = handler({ id, type: "wallet.retryApprovalFee" }, extensionSender);
    await flushHeld();

    const during = await panelCards();
    expect(during?.map((card) => card.id)).toEqual([id]);
    expect(during?.[0]?.declaration).toMatchObject({ fee: null, feeEstimateFailed: true });
    await expect(
      handler({ id, reviewedFee: FEE, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({ error: "retry the fee estimate before approving this transaction" });

    release(FEE);
    await expect(retry).resolves.toEqual({ ok: true });
    expect((await panelCards())?.[0]?.declaration).toMatchObject({
      fee: FEE,
      feeEstimateFailed: false,
    });
  });

  test("keeps the card, retryable, when the retry stops early", async () => {
    const { handler, id, panelCards, session } = await harness();
    session.lock();
    await expect(
      handler({ id, type: "wallet.retryApprovalFee" }, extensionSender),
    ).resolves.toEqual({
      error: "wallet locked",
    });

    const after = await panelCards();
    expect(after?.map((card) => card.id)).toEqual([id]);
    expect(after?.[0]?.declaration).toMatchObject({ fee: null, feeEstimateFailed: true });
  });
});
