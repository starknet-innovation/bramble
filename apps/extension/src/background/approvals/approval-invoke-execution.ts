/**
 * Dependency and approval shapes for executing a reviewed dapp invoke.
 * Split from the approve dispatcher so that file stays within the size cap.
 */

import type { ApproveDecision } from "./approval-applier";
import type { ApprovalDecisionDeps } from "./approval-decision-deps";
import type { ApprovalClaim, PendingApproval } from "./approvals";

/**
 * Collaborators an invoke execution may use. Optional pieces are omitted when
 * the background did not wire them, so a partial test stub stays valid.
 */
export const invokeExecutionDeps = (
  deps: Pick<
    ApprovalDecisionDeps,
    | "activity"
    | "allowanceStore"
    | "ledgerSignQueue"
    | "multisigGrants"
    | "multisigStore"
    | "preferencesStore"
    | "runtimeRpc"
    | "session"
    | "wallet"
  >,
) => ({
  activity: deps.activity,
  allowanceStore: deps.allowanceStore,
  preferencesStore: deps.preferencesStore,
  runtimeRpc: deps.runtimeRpc,
  session: deps.session,
  wallet: deps.wallet,
  ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
  ...(deps.multisigGrants ? { multisigGrants: deps.multisigGrants } : {}),
  ...(deps.multisigStore ? { multisigStore: deps.multisigStore } : {}),
});

/**
 * The invoke approval as execution sees it, including the threshold the card
 * reviewed so a later signer-set change cannot turn a proposal into a send.
 * `reviewedFee` is the invoke half the card bound; an account that deploys
 * first also carries its reviewed deployment half as a separate ceiling.
 */
export const heldInvoke = (
  approval: {
    readonly context?: PendingApproval["context"];
    readonly deploymentFee?: PendingApproval["deploymentFee"];
    readonly multisigThreshold?: number;
    readonly origin: string;
    readonly requiresDeployment?: boolean;
  },
  payload: NonNullable<ApprovalClaim["payload"]>,
  reviewedFee: NonNullable<ApproveDecision["reviewedFee"]>,
) => ({
  ...(approval.context === undefined ? {} : { context: approval.context }),
  ...(approval.multisigThreshold === undefined
    ? {}
    : { reviewedThreshold: approval.multisigThreshold }),
  origin: approval.origin,
  payload,
  reviewedFee,
  ...(approval.requiresDeployment === true && approval.deploymentFee
    ? { reviewedDeploymentFee: approval.deploymentFee }
    : {}),
});
