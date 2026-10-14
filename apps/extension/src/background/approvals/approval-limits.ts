/**
 * Admission, staleness, and fee-ordering policy for the background dapp
 * approval queue — the rules about what may be written to it, kept apart from
 * the queue that stores it.
 *
 * Trust boundary: every queued approval originates from an untrusted page, and
 * several kinds (connect, watch-asset, switch-chain, add-chain) need no grant,
 * so the queue is remotely fillable. This module owns the caps that keep one
 * origin from denying the wallet's consent surface to every other site, the age
 * at which an unanswered approval counts as abandoned, and the ordering token
 * that decides which of two racing fee estimates a card may be bound to.
 *
 * Pure: each decision is a function of the already-queued approvals and an
 * injected timestamp, so the clock boundary stays in the queue's caller and
 * every rule here is deterministic under test. The one function that raises
 * rather than returns is {@link requireApprovalAdmission}, which fails a request
 * closed with the queue's own refusal.
 */

import { WalletError } from "@bramble/core/errors";
import { JSON_BUDGETS, type JsonBudget } from "@bramble/core/json";

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
 * The size an approval may have when it is queued. The side panel reads each
 * queued approval under the provider budget and drops one that exceeds it, so a
 * larger approval would sit in the queue with no card, holding a slot until it
 * expired and then reading to the site as a refusal by the user (Sherlock 157).
 * The headroom covers what a fee review adds after admission. What is measured
 * against it is decided in `./approval-review-size`, from the site's input alone.
 */
export const REVIEWABLE_APPROVAL_BUDGET: JsonBudget = {
  ...JSON_BUDGETS.provider,
  maxBytes: JSON_BUDGETS.provider.maxBytes - 16 * 1024,
  maxNodes: JSON_BUDGETS.provider.maxNodes - 512,
};

/** The refusal for an approval too large for the side panel to show. */
export const APPROVAL_TOO_LARGE = "Request too large to review";

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
 * caps. At the global cap a represented origin is refused, while a new origin
 * is admitted by replacing one prompt of an origin holding more than one (see
 * {@link approvalCapacityVictim}); when every origin holds a single prompt, the
 * new origin is refused too.
 */
export const approvalAdmissionRefusal = (
  queued: readonly QueuedApproval[],
  origin: string,
): string | null => {
  const forOrigin = queued.filter((approval) => approval.origin === origin).length;
  if (forOrigin >= MAX_PENDING_APPROVALS_PER_ORIGIN) {
    return "Too many pending approvals for this site";
  }
  if (
    queued.length >= MAX_PENDING_APPROVALS &&
    (forOrigin > 0 || approvalCapacityVictim(queued) === null)
  ) {
    return "Too many pending approvals";
  }
  return null;
};

/**
 * Oldest approval belonging to the most represented origin when a new origin
 * needs room at the global cap, or null while the queue has room or no origin
 * holds more than one prompt.
 *
 * A victim only ever comes from an origin holding more than the one prompt the
 * new origin is about to hold. Evicting an origin's only prompt would let
 * enough colluding origins, each holding one, drop a prompt the user is
 * reviewing at a moment they choose (Sherlock 128). Refusing every new origin
 * at the cap instead would let the same origins starve every later site, so a
 * new origin still displaces a site holding several prompts.
 */
export const approvalCapacityVictim = <T extends QueuedApproval>(
  queued: readonly T[],
): T | null => {
  if (queued.length < MAX_PENDING_APPROVALS) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const approval of queued) {
    counts.set(approval.origin, (counts.get(approval.origin) ?? 0) + 1);
  }
  const largestShare = Math.max(...counts.values());
  if (largestShare < 2) {
    return null;
  }
  return queued.find((approval) => counts.get(approval.origin) === largestShare) ?? null;
};

/**
 * The queue capability {@link requireApprovalAdmission} needs: whether one more
 * approval for an origin would be admitted, as the refusal it would fail with.
 */
export type ApprovalAdmissionProbe = {
  readonly canAdmit: (origin: string) => string | null;
};

/**
 * Fails a dapp request the queue would refuse to admit anyway, before the
 * handler spends anything on it. Throws the same {@link WalletError} admission
 * itself throws, so a refused origin observes exactly what it observed before —
 * a content script still reads only the generic failure.
 *
 * Call it from a surface that queues a NON-deduplicating approval after
 * expensive work (typed-data hashing, a vault read, an RPC). A deduplicating
 * surface — connect, watch-asset, switch-chain, add-chain — must NOT: a repeat
 * of a prompt already on screen consumes no slot and returns the existing
 * approval, and refusing that at the cap would break the dedupe it relies on.
 *
 * An optimisation, never the gate: the queue applies the same caps at admission
 * time, so a surface that forgets to probe is bounded exactly as it was.
 */
export const requireApprovalAdmission = (
  approvals: ApprovalAdmissionProbe,
  origin: string,
): void => {
  const refusal = approvals.canAdmit(origin);
  if (refusal) {
    throw new WalletError(refusal);
  }
};

/**
 * One admitted request's claim on a queue slot, held while its pre-queue work
 * runs. `arrivedAt` is when it was admitted, so an approval that replaces it
 * can keep the deadline the request arrived with; `release` gives the slot back
 * and is a no-op the second time.
 */
export type ApprovalReservation = {
  readonly arrivedAt: number;
  readonly release: () => void;
};

/**
 * The queue capability {@link withApprovalReservation} needs.
 */
export type ApprovalReservationProbe = {
  readonly reserve: (origin: string) => ApprovalReservation;
};

/**
 * Runs a dapp request's expensive pre-queue work under an admission
 * reservation for `origin`: refused up front with the queue's own
 * {@link WalletError} when the queue would refuse it anyway, and counted
 * against the caps as one more prompt until it is released, so concurrent
 * requests from one origin cannot all pass admission before any of them queues
 * (Sherlock 151). Use it in place of {@link requireApprovalAdmission} on a
 * NON-deduplicating surface whose pre-queue work is CPU-heavy.
 *
 * `work` receives the release and must call it in the same synchronous step
 * that queues its approval, so the queued prompt replaces the reservation with
 * no gap in which both count. It is released anyway when `work` settles, and
 * releasing twice is a no-op. `work` also receives the reservation itself, for
 * a surface that dates its approval from arrival.
 */
export const withApprovalReservation = async <T>(
  approvals: ApprovalReservationProbe,
  origin: string,
  work: (release: () => void, reservation: ApprovalReservation) => Promise<T>,
): Promise<T> => {
  const reservation = approvals.reserve(origin);
  try {
    return await work(reservation.release, reservation);
  } finally {
    reservation.release();
  }
};

/**
 * A claim on the fee slot of one queued invoke approval, taken before the
 * estimate that will fill it starts.
 *
 * A fee on an approval card is the figure the user consents to pay, and the
 * writes that fill it race: the first estimate runs while the prompt is already
 * on screen, and the retry affordance can be pressed again — or pressed on a
 * second open wallet surface — while that estimate is still in flight. With no
 * ordering token the last write wins, so an older estimate resolving late
 * replaces the newer figure and the approval is bound to a ceiling nobody read.
 *
 * Only the queue mints one, and only a current claim writes, so a fee cannot be
 * recorded without first claiming the slot it belongs to.
 */
export type ApprovalFeeRevision = {
  readonly id: string;
  readonly revision: number;
};
