/**
 * Display-only shape of a queued dapp approval and the deep copy that produces
 * it. Kept beside the queue rather than inside it so the queue module stays the
 * admission/lifetime boundary and this module stays the "what may the UI and
 * the dapp see" boundary.
 *
 * Trust boundary: a snapshot is the only view of an approval that leaves the
 * queue. It is rebuilt field by field, so private execution payload
 * (`./approval-payload`) and internal bookkeeping such as the queued-at stamp
 * can never ride along, and every nested value is copied so a caller mutating
 * what it received cannot reach back into live queue state.
 */
import type { DeclareFeeEstimate } from "@mc-wallet/starknet/declare";
import type { FeeAffordability } from "@mc-wallet/transactions/fee-funds";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { FeeEstimate } from "@mc-wallet/starknet/rpc";
import type { Strk20Action, Strk20WithdrawAction } from "@mc-wallet/wallet-protocol/strk20";
import type { ApprovalContext } from "./approval-context";
import { type ApprovalKind, type ApprovalPayload, cloneApprovalValue } from "./approval-payload";

/**
 * ERC20 token metadata carried by a watch-asset approval, in the shape the
 * preferences store accepts when the request is approved.
 */
export type WatchAssetToken = {
  readonly address: string;
  readonly decimals: number;
  readonly name: string;
  readonly networkId: StarknetNetworkId;
  readonly symbol: string;
};

/**
 * One decoded, user-facing risk flag surfaced on an invoke approval card.
 */
export type ApprovalRiskFlag = {
  readonly code: string;
  readonly message: string;
};

/**
 * Safe, display-only facts derived from a private Cairo declaration payload.
 * The contract class itself never crosses to the approval UI.
 */
export type DeclarationReview = {
  readonly abiEntryCount: number;
  readonly accountDeployment: "deployed" | "undeployed" | "unknown";
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly deploymentFee: DeclareFeeEstimate | null;
  readonly deploymentFeeEstimateFailed: boolean;
  readonly entryPointCount: number;
  readonly fee: DeclareFeeEstimate | null;
  readonly feeEstimateFailed: boolean;
  readonly sierraProgramLength: number;
};

/**
 * Display-only invoke fee state, aligned with Send review classification.
 */
export type InvokeFeeReview = {
  readonly fee: FeeEstimate | null;
  readonly feeAffordability: FeeAffordability;
  readonly feeEstimateFailed: boolean;
  readonly feeEstimatePending: boolean;
  readonly requiresDeployment: boolean;
};

/**
 * Pending dapp approval snapshot. Kind-specific review fields are display-only;
 * reputation fields are attached when listed and are not queue state.
 */
export type PendingApproval = {
  readonly actionReviews?: readonly Strk20Action[];
  readonly blocked?: boolean;
  readonly context?: ApprovalContext;
  readonly declaration?: DeclarationReview;
  readonly fee?: FeeEstimate | null;
  readonly feeAffordability?: FeeAffordability;
  readonly feeEstimateFailed?: boolean;
  readonly feeEstimatePending?: boolean;
  readonly flags?: readonly ApprovalRiskFlag[];
  readonly id: string;
  readonly insights?: readonly string[];
  readonly kind: ApprovalKind;
  readonly origin: string;
  readonly relayFeeAction?: Strk20WithdrawAction;
  readonly requiresDeployment?: boolean;
  readonly summaries?: readonly string[];
  readonly token?: WatchAssetToken;
  readonly typedData?: unknown;
};

/**
 * One approval as its requester supplies it: the display fields plus the
 * private execution payload, before the queue admits it and stamps the arrival
 * time its TTL is measured from.
 */
export type ApprovalRequest = PendingApproval & ApprovalPayload;

// Copies an invoke entry's fee review onto its snapshot without materializing
// absent fields, so non-invoke snapshots stay byte-identical to before.
const feeReviewSnapshot = (approval: ApprovalRequest): Partial<PendingApproval> => ({
  ...(approval.fee === undefined ? {} : { fee: approval.fee && { ...approval.fee } }),
  ...(approval.feeAffordability === undefined
    ? {}
    : { feeAffordability: approval.feeAffordability }),
  ...(approval.feeEstimateFailed === undefined
    ? {}
    : { feeEstimateFailed: approval.feeEstimateFailed }),
  ...(approval.feeEstimatePending === undefined
    ? {}
    : { feeEstimatePending: approval.feeEstimatePending }),
  ...(approval.requiresDeployment === undefined
    ? {}
    : { requiresDeployment: approval.requiresDeployment }),
});

/**
 * Deep-copies the display-only view of a queued approval. Fields are listed
 * explicitly, so any field added to the stored entry stays invisible to callers
 * until it is named here.
 */
export const approvalSnapshot = (approval: ApprovalRequest): PendingApproval => ({
  ...(approval.actionReviews === undefined
    ? {}
    : { actionReviews: cloneApprovalValue(approval.actionReviews) }),
  ...(approval.context === undefined ? {} : { context: { ...approval.context } }),
  ...feeReviewSnapshot(approval),
  ...(approval.declaration === undefined
    ? {}
    : {
        declaration: {
          ...approval.declaration,
          deploymentFee: approval.declaration.deploymentFee && {
            ...approval.declaration.deploymentFee,
          },
          fee: approval.declaration.fee && { ...approval.declaration.fee },
        },
      }),
  id: approval.id,
  kind: approval.kind,
  origin: approval.origin,
  ...(approval.relayFeeAction === undefined
    ? {}
    : { relayFeeAction: cloneApprovalValue(approval.relayFeeAction) }),
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
  ...(approval.summaries === undefined ? {} : { summaries: [...approval.summaries] }),
  ...(approval.flags === undefined ? {} : { flags: approval.flags.map((flag) => ({ ...flag })) }),
  ...(approval.typedData === undefined
    ? {}
    : { typedData: cloneApprovalValue(approval.typedData) }),
});
