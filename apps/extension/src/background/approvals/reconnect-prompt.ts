/**
 * Stale-grant reconnect prompt. When a connected origin's grant no longer
 * resolves on the active network — the user switched networks or removed the
 * granted account — its transaction and signing requests are refused with
 * `origin not connected`, which most dapps swallow into an endless spinner.
 * This queues the standard connect approval beside that refusal so the wallet
 * explains itself: approving re-grants the active account through the existing
 * consent path, denying dismisses. Only origins that already hold a grant
 * qualify — an origin that never connected gets the plain refusal, so a page
 * cannot mint consent prompts by firing invokes without ever connecting. The
 * queue itself deduplicates connect approvals per origin and enforces the
 * per-origin admission cap, so a looping origin gains nothing.
 */

import { notifyApprovalsChanged } from "./approval-notifier";

type ReconnectApprovalQueue = {
  readonly request: (origin: string) => { readonly id: string };
};

/**
 * Queues a reconnect (connect) approval for a formerly granted origin whose
 * grant does not resolve on the active network. `granted` is the origin's full
 * grant list across networks: empty means never connected, so no prompt.
 */
export const promptReconnectForStaleGrant = (
  approvals: ReconnectApprovalQueue,
  granted: readonly unknown[],
  origin: string,
): void => {
  if (granted.length === 0) {
    return;
  }
  approvals.request(origin);
  notifyApprovalsChanged();
};
