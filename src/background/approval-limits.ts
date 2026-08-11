/**
 * Admission and staleness policy for the background dapp approval queue.
 *
 * Trust boundary: every queued approval originates from an untrusted page, and
 * several kinds (connect, watch-asset, switch-chain, add-chain) need no grant,
 * so the queue is remotely fillable. This module owns the caps that keep one
 * origin from denying the wallet's consent surface to every other site, and the
 * age at which an unanswered approval counts as abandoned.
 *
 * Pure: each decision is a function of the already-queued approvals and an
 * injected timestamp, so the clock boundary stays in the queue's caller and
 * every rule here is deterministic under test.
 */

/**
 * Maximum queued dapp approvals kept in background memory across all origins.
 */
export const MAX_PENDING_APPROVALS = 50;

/**
 * Maximum queued approvals a single origin may hold at once. Kept well below
 * {@link MAX_PENDING_APPROVALS} so one unconnected site cannot fill the queue
 * and starve every other site — and the user's own flows — of consent slots.
 */
export const MAX_PENDING_APPROVALS_PER_ORIGIN = 5;

/**
 * How long an unanswered approval stays queued before it counts as abandoned.
 * The queue holds nothing durable, so expiry only drops a prompt the user never
 * answered; it never approves anything.
 */
export const APPROVAL_TTL_MS = 5 * 60 * 1_000;

/**
 * The queue state one admission or expiry decision needs: the requesting origin
 * and the timestamp the approval was admitted at.
 */
export type QueuedApproval = {
  readonly origin: string;
  readonly queuedAt: number;
};

/**
 * Whether a queued approval has outlived {@link APPROVAL_TTL_MS} as of `now`.
 *
 * A clock that jumps backwards yields a negative age, which is never stale, so
 * prompts are preserved. That trade is deliberate but it is not fail-closed for
 * the flooding threat this module bounds: a rewound clock holds a flooding
 * origin's queued prompts (and its per-origin slots) until the clock catches up
 * or the user answers them. It is chosen anyway because the opposite failure is
 * worse — dropping a legitimate prompt the user is mid-review of, on a clock the
 * wallet does not control — and because the caps still hold meanwhile: nothing
 * new is admitted past {@link MAX_PENDING_APPROVALS_PER_ORIGIN}.
 */
export const isExpiredApproval = (approval: QueuedApproval, now: number): boolean =>
  now - approval.queuedAt >= APPROVAL_TTL_MS;

/**
 * The refusal message for admitting one more approval for `origin` to a queue
 * already holding `queued`, or null when there is room. Expired entries must be
 * swept before this is consulted, otherwise abandoned prompts count against the
 * caps. The global cap is checked first so a queue that is full for everyone
 * reports that rather than blaming the requesting site.
 */
export const approvalAdmissionRefusal = (
  queued: readonly QueuedApproval[],
  origin: string,
): string | null => {
  if (queued.length >= MAX_PENDING_APPROVALS) {
    return "Too many pending approvals";
  }
  const forOrigin = queued.filter((approval) => approval.origin === origin).length;
  if (forOrigin >= MAX_PENDING_APPROVALS_PER_ORIGIN) {
    return "Too many pending approvals for this site";
  }
  return null;
};
