/**
 * One-time in-memory staking preparations (issue 750). The pool is verified
 * and the calls built and priced before review; the exact calls, the review
 * sentence and the fee are then frozen here, bound to the account, network and
 * chain by a digest, until one confirm claims them. A confirm can therefore
 * sign only what was reviewed, from the account it was reviewed on.
 */
import { WalletError } from "@bramble/core/errors";
import { isSha256Digest } from "@bramble/core/ids";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { StakingAction } from "@bramble/transactions/staking-calls";
import type { Call } from "starknet";
import type { ApprovalContext } from "../approvals/approval-context";

const MAX_STAKING_PREPARATIONS = 20;

/**
 * Frozen staking execution and review data held only by the background.
 */
export type StakingPreparation = {
  readonly action: StakingAction;
  /** The amount the user entered, for Activity; null for amount-less actions. */
  readonly amount: string | null;
  readonly calls: readonly Call[];
  readonly context: ApprovalContext;
  readonly id: string;
  /** The verified pool, which verification treats as a known contract. */
  readonly pool: string;
  /** What the calls do, in the reviewed signing wording. */
  readonly review: string;
  readonly reviewedFee: FeeEstimate;
  /** The deterministic Activity summary. */
  readonly summary: string;
  readonly symbol: string;
  readonly tokenAddress: string;
};

/**
 * The subset the side panel shows before the one-time confirm.
 */
type StakingPreparationReview = {
  readonly id: string;
  readonly review: string;
  readonly reviewedFee: FeeEstimate;
};

/**
 * `wallet.stakingPrepare` success.
 */
export type StakingPreparationResponse = {
  readonly ok: true;
  readonly stakingPreparation: StakingPreparationReview;
};

/**
 * Exact JSON-shaped value covered by the preparation's SHA-256 digest.
 */
export const stakingPreparationPayload = (
  preparation: Omit<StakingPreparation, "context" | "id">,
): unknown => ({
  action: preparation.action,
  amount: preparation.amount,
  calls: preparation.calls,
  pool: preparation.pool,
  review: preparation.review,
  reviewedFee: preparation.reviewedFee,
  summary: preparation.summary,
  symbol: preparation.symbol,
  tokenAddress: preparation.tokenAddress,
});

/**
 * One-time preparation store. `claim` removes the entry before submission, so
 * a double tap cannot submit the same calls twice.
 */
export type StakingPreparationStore = {
  readonly claim: (id: string) => StakingPreparation | null;
  readonly put: (preparation: StakingPreparation) => StakingPreparationReview;
};

/**
 * Creates the bounded background-only preparation store. The oldest entry is
 * dropped past the cap; a dropped review simply has to be prepared again.
 */
export const createStakingPreparationStore = (): StakingPreparationStore => {
  const pending = new Map<string, StakingPreparation>();
  return {
    claim(id) {
      if (!isSha256Digest(id)) return null;
      const preparation = pending.get(id);
      if (!preparation) return null;
      pending.delete(id);
      return structuredClone(preparation);
    },
    put(preparation) {
      const copy = structuredClone(preparation);
      if (!isSha256Digest(copy.id) || copy.id !== copy.context.payloadDigest) {
        throw new WalletError("Invalid staking preparation commitment");
      }
      pending.set(copy.id, copy);
      while (pending.size > MAX_STAKING_PREPARATIONS) {
        const oldest = pending.keys().next().value;
        if (typeof oldest !== "string") break;
        pending.delete(oldest);
      }
      return { id: copy.id, review: copy.review, reviewedFee: { ...copy.reviewedFee } };
    },
  };
};
