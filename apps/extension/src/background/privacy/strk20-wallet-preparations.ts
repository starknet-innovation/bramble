/**
 * One-time background-only preparations for wallet-owned privacy operations.
 * The side panel receives review metadata, never the proof, viewing key, or
 * executable action batch.
 */

import { WalletError } from "@bramble/core/errors";
import { isSha256Digest } from "@bramble/core/ids";
import type { PaymasterAuthorizationReview } from "@bramble/privacy/paymaster-typed-data";
import type {
  PreparedStrk20AccountSubmission,
  Strk20FeeAsset,
  Strk20SubmissionPlan,
} from "@bramble/privacy/service";
import type { TokenConfig } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { ApprovalContext } from "../approvals/approval-context";
import { strk20FeeAssetFor } from "./strk20-fee-reference";

const MAX_PREPARATIONS = 20;

/**
 * How long a reviewed preparation stays confirmable. The payload exists only in
 * the worker's memory, so the worker is held open while one is pending; after
 * this window an unconfirmed review is dropped, and the panel's existing copy
 * reads the resulting refusal as "That review expired. Start again."
 */
export const STRK20_PREPARATION_LIFETIME_MS = 10 * 60_000;

/**
 * Cadence of the pending-review hold. Chrome stops a worker after 30 seconds
 * without an event; the tracked-job registry already uses a 20 second extension
 * call for the same reason (see ./strk20-preparation-jobs).
 */
export const STRK20_PREPARATION_KEEPALIVE_MS = 20_000;

/**
 * Collaborators of the store. Every clock and timer is injected so the hold and
 * the review lifetime stay deterministic under test. `now` is optional: without
 * it a preparation never expires on its own, which is what the plain
 * router-context default wants.
 */
export type Strk20PreparationStoreOptions = {
  /**
   * Extension API touch that resets the worker's idle timer while a review is
   * pending, e.g. `chrome.runtime.getPlatformInfo`. It carries no data.
   */
  readonly keepAlive?: () => void;
  readonly keepAliveIntervalMs?: number;
  /** Wall clock, for the review lifetime. */
  readonly now?: () => number;
  /** Interval scheduler; defaults to `setInterval` and returns its canceller. */
  readonly schedule?: (tick: () => void, intervalMs: number) => () => void;
  /** How long a reviewed preparation stays confirmable. */
  readonly reviewLifetimeMs?: number;
};

type BasePreparation = {
  readonly context: ApprovalContext;
  readonly id: string;
  readonly poolAddress: string;
  readonly summaries: readonly string[];
  readonly token: TokenConfig;
};

type PublicAccountPreparation = PreparedStrk20AccountSubmission & {
  readonly networkFee: FeeEstimate;
};

/**
 * Frozen one-time registration operation.
 */
export type Strk20RegistrationPreparation = BasePreparation &
  PublicAccountPreparation & {
    readonly kind: "register";
    readonly poolFeeFri: string;
  };

/**
 * Frozen one-time deposit operation, including its reviewed submission route.
 * `recipient` is whose private balance the deposit credits — the depositor for a
 * shield, anyone registered with the pool otherwise — and is committed by the
 * digest so the credited party cannot change between review and submission.
 */
export type Strk20DepositPreparation = BasePreparation &
  PublicAccountPreparation & {
    readonly actions: readonly Strk20Action[];
    readonly amount: string;
    readonly amountRaw: string;
    readonly kind: "deposit";
    readonly plan: Strk20SubmissionPlan;
    readonly recipient: string;
  };

/**
 * Frozen one-time shielded transfer, always routed through the private relay.
 * The recipient is committed by the digest alongside the action batch.
 */
type Strk20TransferPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "transfer";
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen one-time withdrawal (unshield), always routed through the private
 * relay. The public destination is committed by the digest with the batch.
 */
type Strk20WithdrawPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly amount: string;
  readonly amountRaw: string;
  readonly kind: "withdraw";
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen one-time sweep of a recorded shadow account (#443, PR 5), always
 * routed through the private relay: one OPEN transfer per token the account
 * holds, to this account, then a `shadow_account_invoke` with no calls that
 * collects every balance. `actions` keep the site's label; the origin-bound
 * separator is derived at submission from the recorded `origin`. The digest
 * commits the scope, nonce, and anonymizer with the batch.
 */
export type Strk20ShadowSweepPreparation = BasePreparation & {
  readonly actions: readonly Strk20Action[];
  readonly anonymizer: string;
  readonly kind: "shadow-sweep";
  readonly label: string;
  readonly nonce: string;
  readonly origin: string;
  readonly plan: Strk20SubmissionPlan;
  readonly recipient: string;
};

/**
 * Frozen protected payload consumed at most once by the background.
 */
export type Strk20WalletPreparation =
  | Strk20DepositPreparation
  | Strk20RegistrationPreparation
  | Strk20ShadowSweepPreparation
  | Strk20TransferPreparation
  | Strk20WithdrawPreparation;

type UnsignedStrk20WalletPreparation =
  | Omit<Strk20DepositPreparation, "context" | "id">
  | Omit<Strk20RegistrationPreparation, "context" | "id">
  | Omit<Strk20ShadowSweepPreparation, "context" | "id">
  | Omit<Strk20TransferPreparation, "context" | "id">
  | Omit<Strk20WithdrawPreparation, "context" | "id">;

/**
 * Safe review subset returned to the side panel before confirmation.
 */
export type Strk20WalletPreparationReview = {
  readonly amount?: string;
  readonly authorization?: PaymasterAuthorizationReview;
  readonly id: string;
  readonly kind: "deposit" | "register" | "shadow-sweep" | "transfer" | "withdraw";
  readonly networkFee?: FeeEstimate;
  readonly payloadDigest: string;
  readonly poolAddress: string;
  readonly poolFeeFri?: string;
  readonly recipient?: string;
  readonly route: "private-relay" | "public-account";
  readonly relayFee?: {
    readonly amount: string;
    /**
     * Registry display metadata for the fee token, absent for a token the
     * registry does not describe. The relay fee may be converted out of STRK,
     * so the panel must not format `amount` as STRK without it.
     */
    readonly asset?: Strk20FeeAsset;
    readonly recipient: string;
    readonly token: string;
  };
  readonly summaries: readonly string[];
  readonly symbol: string;
  readonly tokenId: string;
};

/**
 * Exact JSON-shaped payload committed by the preparation digest.
 */
export const strk20WalletPreparationPayload = (
  preparation: UnsignedStrk20WalletPreparation,
): unknown =>
  preparation.kind === "shadow-sweep"
    ? {
        actions: preparation.actions,
        anonymizer: preparation.anonymizer,
        kind: preparation.kind,
        label: preparation.label,
        nonce: preparation.nonce,
        origin: preparation.origin,
        plan: preparation.plan,
        poolAddress: preparation.poolAddress,
        recipient: preparation.recipient,
        summaries: preparation.summaries,
        token: preparation.token,
      }
    : preparation.kind === "register"
      ? {
          kind: preparation.kind,
          allowanceGrants: preparation.allowanceGrants,
          calls: preparation.calls,
          networkFee: preparation.networkFee,
          poolAddress: preparation.poolAddress,
          poolFeeFri: preparation.poolFeeFri,
          proof: preparation.proof,
          summaries: preparation.summaries,
          token: preparation.token,
        }
      : preparation.kind === "deposit"
        ? {
            actions: preparation.actions,
            allowanceGrants: preparation.allowanceGrants,
            amount: preparation.amount,
            amountRaw: preparation.amountRaw,
            calls: preparation.calls,
            kind: preparation.kind,
            networkFee: preparation.networkFee,
            plan: preparation.plan,
            poolAddress: preparation.poolAddress,
            proof: preparation.proof,
            recipient: preparation.recipient,
            summaries: preparation.summaries,
            token: preparation.token,
          }
        : {
            actions: preparation.actions,
            amount: preparation.amount,
            amountRaw: preparation.amountRaw,
            kind: preparation.kind,
            plan: preparation.plan,
            poolAddress: preparation.poolAddress,
            recipient: preparation.recipient,
            summaries: preparation.summaries,
            token: preparation.token,
          };

const reviewedNetworkFee = (
  preparation: Strk20WalletPreparation,
): { readonly networkFee?: FeeEstimate } =>
  preparation.kind === "register" || preparation.kind === "deposit"
    ? { networkFee: preparation.networkFee }
    : {};

const relayFeeReview = (
  token: TokenConfig,
  plan: Exclude<Strk20SubmissionPlan, { readonly mode: "account" }>,
): NonNullable<Strk20WalletPreparationReview["relayFee"]> => {
  const asset = strk20FeeAssetFor(token.networkId, plan);
  return {
    amount: plan.feeAction.amount,
    ...(asset ? { asset } : {}),
    recipient: plan.feeAction.recipient,
    token: plan.feeAction.token,
  };
};

const reviewOf = (preparation: Strk20WalletPreparation): Strk20WalletPreparationReview => ({
  ...(preparation.kind === "register" || preparation.kind === "shadow-sweep"
    ? {}
    : { amount: preparation.amount }),
  ...(preparation.kind !== "register" &&
  preparation.plan.mode !== "account" &&
  preparation.plan.authorization
    ? { authorization: preparation.plan.authorization }
    : {}),
  id: preparation.id,
  kind: preparation.kind,
  ...reviewedNetworkFee(preparation),
  payloadDigest: preparation.context.payloadDigest,
  poolAddress: preparation.poolAddress,
  ...(preparation.kind === "register"
    ? { poolFeeFri: preparation.poolFeeFri }
    : preparation.plan.mode === "account"
      ? { poolFeeFri: preparation.plan.poolFeeFri }
      : {}),
  ...(preparation.kind === "register" ? {} : { recipient: preparation.recipient }),
  route:
    preparation.kind !== "register" && preparation.plan.mode !== "account"
      ? "private-relay"
      : "public-account",
  ...(preparation.kind !== "register" && preparation.plan.mode !== "account"
    ? { relayFee: relayFeeReview(preparation.token, preparation.plan) }
    : {}),
  summaries: [...preparation.summaries],
  symbol: preparation.token.symbol,
  tokenId: preparation.token.id,
});

/**
 * Bounded, one-time preparation store. Claim removes the payload before any
 * asynchronous work so duplicate confirms cannot double-submit.
 *
 * While at least one preparation is pending the store keeps a `keepAlive` hold
 * running, so the worker that holds the payload cannot idle out under a review
 * the user has not answered yet. The hold stops when the last preparation is
 * claimed or retires, and a preparation that is never confirmed is dropped at
 * the review lifetime.
 */
export type Strk20WalletPreparationStore = {
  readonly claim: (id: string) => Strk20WalletPreparation | null;
  /** True while a review the user has not answered is held (an update waits for it). */
  readonly held?: () => boolean;
  readonly put: (preparation: Strk20WalletPreparation) => Strk20WalletPreparationReview;
};

type PendingPreparation = {
  readonly preparation: Strk20WalletPreparation;
  readonly putAt: number;
};

const defaultSchedule = (tick: () => void, intervalMs: number): (() => void) => {
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
};

/**
 * Creates an in-memory preparation store scoped to the service worker.
 */
export const createStrk20WalletPreparationStore = (
  options: Strk20PreparationStoreOptions = {},
): Strk20WalletPreparationStore => {
  const schedule = options.schedule ?? defaultSchedule;
  const intervalMs = options.keepAliveIntervalMs ?? STRK20_PREPARATION_KEEPALIVE_MS;
  const lifetimeMs = options.reviewLifetimeMs ?? STRK20_PREPARATION_LIFETIME_MS;
  const pending = new Map<string, PendingPreparation>();
  let cancelHold: (() => void) | null = null;

  const expired = (entry: PendingPreparation): boolean =>
    options.now !== undefined && options.now() - entry.putAt >= lifetimeMs;

  // One tick both touches the worker and retires any review left unanswered;
  // the hold ends with the last preparation.
  const holdTick = (): void => {
    options.keepAlive?.();
    if (options.now !== undefined) {
      const at = options.now();
      for (const [id, entry] of pending) {
        if (at - entry.putAt >= lifetimeMs) {
          pending.delete(id);
        }
      }
    }
    if (pending.size === 0 && cancelHold) {
      cancelHold();
      cancelHold = null;
    }
  };

  const startHold = (): void => {
    if (options.keepAlive && cancelHold === null && pending.size > 0) {
      cancelHold = schedule(holdTick, intervalMs);
    }
  };

  const release = (id: string): PendingPreparation | null => {
    const entry = pending.get(id);
    if (!entry) {
      return null;
    }
    pending.delete(id);
    if (pending.size === 0 && cancelHold) {
      cancelHold();
      cancelHold = null;
    }
    return entry;
  };

  return {
    held: () => [...pending.values()].some((entry) => !expired(entry)),
    claim(id) {
      if (!isSha256Digest(id)) {
        return null;
      }
      const entry = release(id);
      if (!entry) {
        return null;
      }
      return expired(entry) ? null : structuredClone(entry.preparation);
    },
    put(preparation) {
      const copy = structuredClone(preparation);
      if (!isSha256Digest(copy.id) || copy.id !== copy.context.payloadDigest) {
        throw new WalletError("Invalid privacy preparation commitment");
      }
      pending.set(copy.id, { preparation: copy, putAt: options.now?.() ?? 0 });
      while (pending.size > MAX_PREPARATIONS) {
        const oldest = pending.keys().next().value;
        if (typeof oldest !== "string") {
          break;
        }
        pending.delete(oldest);
      }
      startHold();
      return reviewOf(copy);
    },
  };
};
