/**
 * Test helpers for the held-approval dapp contract. State-changing dapp methods
 * (requestAccounts, watchAsset, addInvokeTransaction, switchChain,
 * signTypedData) do not resolve until the user approves or denies the queued
 * approval, so a test must fire the request without awaiting it, let the
 * background enqueue the approval, then drive the decision.
 */

/**
 * Flushes pending microtasks so a fired held request finishes enqueuing its
 * approval before the test inspects the queue.
 */
export const flushHeld = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

import type { RuntimeSender } from "../../apps/extension/src/background/senders";

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
