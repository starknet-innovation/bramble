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
import type { FeeEstimate } from "@bramble/starknet/rpc";
import type { FeeAffordability } from "@bramble/transactions/fee-funds";
import type { PendingApproval } from "@bramble/wallet-protocol/extension-responses";
import type { ProviderInvokeCall } from "@bramble/wallet-protocol/invoke";
import { type ApprovalPayload, cloneApprovalValue } from "./approval-payload";

/**
 * Shared display-only approval response shapes exposed to trusted UI surfaces.
 */
export type {
  ApprovalRiskFlag,
  DeclarationReview,
  PendingApproval,
  WatchAssetToken,
} from "@bramble/wallet-protocol/extension-responses";

/**
 * Display-only invoke fee state, aligned with Send review classification.
 */
export type InvokeFeeReview = {
  /** The account must be deployed through its own step first; no fee. */
  readonly deployFirst?: true;
  readonly fee: FeeEstimate | null;
  readonly feeAffordability: FeeAffordability;
  readonly feeEstimateFailed: boolean;
  readonly feeEstimatePending: boolean;
  readonly requiresDeployment: boolean;
};

/**
 * One approval as its requester supplies it: the display fields plus the
 * private execution payload, before the queue admits it and stamps the arrival
 * time its TTL is measured from.
 */
export type ApprovalRequest = PendingApproval & ApprovalPayload;

// A notice's wallet-chosen reason, and a watch-asset card's already-tracked
// mark (audit M1); both absent for every other approval.
const noticeSnapshot = (approval: ApprovalRequest): Partial<PendingApproval> => ({
  ...(approval.alreadyTracked === true ? { alreadyTracked: true } : {}),
  ...(approval.notice === undefined ? {} : { notice: approval.notice }),
});

// Copies an invoke entry's fee review onto its snapshot without materializing
// absent fields, so non-invoke snapshots stay byte-identical to before.
const feeReviewSnapshot = (approval: ApprovalRequest): Partial<PendingApproval> => ({
  ...(approval.deployFirst === true ? { deployFirst: true } : {}),
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

const callReviewSnapshot = (approval: ApprovalRequest): Partial<PendingApproval> => {
  if (approval.kind !== "invoke" || approval.calls === undefined) {
    return {};
  }
  const reviews = approval.calls
    .map((call): ProviderInvokeCall | null => {
      const calldata: unknown = call.calldata;
      if (
        !Array.isArray(calldata) ||
        !calldata.every((item): item is string => typeof item === "string")
      ) {
        return null;
      }
      return {
        calldata: [...calldata],
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
      };
    })
    .filter((call): call is ProviderInvokeCall => call !== null);
  return reviews.length === approval.calls.length ? { callReviews: reviews } : {};
};

/**
 * Deep-copies the display-only view of a queued approval. Fields are listed
 * explicitly, so any field added to the stored entry stays invisible to callers
 * until it is named here.
 */
export const approvalSnapshot = (approval: ApprovalRequest): PendingApproval => ({
  ...(approval.actionReviews === undefined
    ? {}
    : { actionReviews: cloneApprovalValue(approval.actionReviews) }),
  ...callReviewSnapshot(approval),
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
  ...(approval.existingGrant === undefined ? {} : { existingGrant: approval.existingGrant }),
  id: approval.id,
  kind: approval.kind,
  ...noticeSnapshot(approval),
  origin: approval.origin,
  ...(approval.relayFeeAction === undefined
    ? {}
    : { relayFeeAction: cloneApprovalValue(approval.relayFeeAction) }),
  ...(approval.reviewAssets === undefined
    ? {}
    : { reviewAssets: approval.reviewAssets.map((asset) => ({ ...asset })) }),
  ...(approval.token === undefined ? {} : { token: { ...approval.token } }),
  ...(approval.summaries === undefined ? {} : { summaries: [...approval.summaries] }),
  ...(approval.flags === undefined ? {} : { flags: approval.flags.map((flag) => ({ ...flag })) }),
  ...(approval.typedData === undefined
    ? {}
    : { typedData: cloneApprovalValue(approval.typedData) }),
});
