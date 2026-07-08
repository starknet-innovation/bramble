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

import type { RuntimeSender } from "../../src/background/senders";

type Handler = (message: unknown, sender?: RuntimeSender) => Promise<unknown>;

/**
 * Reads the id of the most recently queued approval from the extension page.
 */
export const latestApprovalId = async (
  handler: Handler,
  extensionSender: RuntimeSender,
): Promise<string> => {
  const response = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
    readonly pending: readonly { readonly id: string }[];
  };
  const id = response.pending.at(-1)?.id;
  if (!id) {
    throw new Error("no pending approval");
  }
  return id;
};
