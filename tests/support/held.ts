/**
 * Test helpers for the held-approval dapp contract. State-changing dapp methods
 * (requestAccounts, watchAsset, addInvokeTransaction, switchChain,
 * signTypedData) do not resolve until the user approves or denies the queued
 * approval, so a test must fire the request without awaiting it, let the
 * background enqueue the approval, then drive the decision.
 */

import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";

/**
 * Flushes pending microtasks so a fired held request finishes enqueuing its
 * approval before the test inspects the queue.
 */
export const flushHeld = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

type Handler = (message: unknown, sender?: RuntimeSender) => Promise<unknown>;

/**
 * Waits for asynchronous approval preparation (for example WebCrypto payload
 * commitments) and returns the first non-empty queue snapshot.
 */
export const waitForPendingApprovals = async <
  T extends { readonly id: string } = { readonly id: string },
>(
  handler: Handler,
  extensionSender: RuntimeSender,
): Promise<readonly T[]> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly T[];
    };
    if (response.pending.length > 0) {
      return response.pending;
    }
    await flushHeld();
  }
  throw new Error("no pending approval");
};

/**
 * Reads the id of the most recently queued approval from the extension page.
 */
export const latestApprovalId = async (
  handler: Handler,
  extensionSender: RuntimeSender,
): Promise<string> => {
  const pending = await waitForPendingApprovals(handler, extensionSender);
  const id = pending.at(-1)?.id;
  if (!id) {
    throw new Error("no pending approval");
  }
  return id;
};

/**
 * Waits until an invoke or declare approval has the fee its card may echo.
 * Throws on failure/no fee so a test cannot accidentally bypass fee review.
 */
export const reviewedApprovalFee = async (
  handler: Handler,
  extensionSender: RuntimeSender,
  id: string,
): Promise<FeeEstimate> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = await waitForPendingApprovals<{
      readonly declaration?: { readonly fee?: FeeEstimate | null };
      readonly fee?: FeeEstimate | null;
      readonly feeEstimatePending?: boolean;
      readonly id: string;
    }>(handler, extensionSender);
    const approval = pending.find((entry) => entry.id === id);
    const fee = approval?.fee ?? approval?.declaration?.fee;
    if (fee && approval?.feeEstimatePending !== true) {
      return fee;
    }
    await flushHeld();
  }
  throw new Error("approval fee was not reviewed");
};
