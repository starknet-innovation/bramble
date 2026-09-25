/**
 * Pre-sign review and submission response types for wallet-initiated transfers,
 * shared by the ERC-20 and NFT send paths so both reviews render identically.
 */
import type { FeeEstimate } from "@bramble/starknet/rpc";
import type { RiskFlag } from "@bramble/transactions/verify";

/**
 * Transfer submission response returned to extension pages.
 */
export type TransferResponse = {
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Pre-sign transfer review returned to extension pages.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly deploymentFee?: FeeEstimate | null;
    readonly deploymentFeeEstimateFailed?: boolean;
    readonly fee: FeeEstimate | null;
    /**
     * Warn-only fee-affordability verdict from the shared predicate (issue
     * 191); "unknown" means no claim was possible and must never block.
     */
    readonly feeAffordability: "insufficient" | "ok" | "unknown";
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly RiskFlag[];
    readonly requiresDeployment: boolean;
    /**
     * Set when the send also deploys the account and the signer is a Ledger:
     * two transactions, so the device prompts twice, and the review says so.
     */
    readonly signsTwice?: boolean;
    readonly summaries: readonly string[];
  };
};

/** Fee a wallet-initiated operation must display before its confirmation. */
export type FeeReviewResponse = {
  readonly feeReview: FeeEstimate;
  readonly ok: true;
};
