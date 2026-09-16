/** Frozen STRK20 submission routes shared by policy and review summaries. */

import type { FeeEstimate } from "@bramble/wallet-protocol/fee-estimate";
import type { PaymasterAuthorizationReview } from "../paymaster/paymaster-typed-data";

/**
 * Private relay fee and authorization frozen before proving or signing. The
 * service must submit this route without adding public account calls.
 */
export type Strk20PrivateRelayPlan = {
  readonly authorization?: PaymasterAuthorizationReview;
  readonly feeAction: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
    readonly type: "withdraw";
  };
  /**
   * Independently derived bound the quoted fee was accepted under, frozen here
   * so submission re-checks the same number the user reviewed rather than
   * re-deriving one from a price that has since moved.
   *
   * Present only on a converted (non-STRK) fee token. The STRK route matches
   * the quote exactly against the pool's on-chain charge, so it carries no
   * band and leaves this absent.
   */
  readonly feeCeiling?: {
    readonly ceiling: string;
    readonly reference: string;
  };
  readonly mode?: "private-relay";
  readonly typedData?: unknown;
};

/**
 * Public account route and exact reviewed pool fee, restricted by service
 * policy to registration and deposit-only entry batches.
 */
export type Strk20AccountPlan = {
  readonly mode: "account";
  readonly poolFeeFri: string;
  /** Exact network-fee ceiling added only after the frozen calls are reviewed. */
  readonly reviewedFee?: FeeEstimate;
};

/**
 * Frozen STRK20 route shown before protected proving or authorization. Route
 * substitution after consent is not permitted.
 */
export type Strk20SubmissionPlan = Strk20PrivateRelayPlan | Strk20AccountPlan;
