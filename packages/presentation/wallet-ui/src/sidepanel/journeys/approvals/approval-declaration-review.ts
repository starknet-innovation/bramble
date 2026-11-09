/**
 * Declaration (Cairo class registration) review helpers for the approval
 * cards: the reviewed fee, its facts, and its warnings. Split from
 * ./approval-cards to keep that module within the size budget; presentation
 * only, every dynamic value escaped.
 */

import { escapeHtml } from "@bramble/core/html";
import { sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import type { PendingApproval } from "../../../popup/responses/responses";
import { formatFri } from "../../shared/parts";

/**
 * The figure a declaration card asks the user to review: the declaration fee,
 * plus the deployment fee when the account still has to be deployed first.
 * Null when either half is unknown, which withholds Approve.
 */
export const declarationReviewedFee = (approval: PendingApproval): PendingApproval["fee"] => {
  const declaration = approval.declaration;
  if (!declaration?.fee || declaration.accountDeployment === "unknown") return null;
  return declaration.accountDeployment === "undeployed"
    ? declaration.deploymentFee && sumFeeEstimates(declaration.fee, declaration.deploymentFee)
    : declaration.fee;
};

/** Renders the declaration's reviewed facts as a definition list. Escaped presentation copy only. */
export const declarationDetails = (approval: PendingApproval): string => {
  const declaration = approval.declaration;
  if (!declaration) {
    return "";
  }
  const formatFee = (fee: NonNullable<typeof declaration.fee>): string =>
    fee.unit === "FRI" ? formatFri(fee.overallFee) : `${fee.overallFee} ${fee.unit}`;
  const fee = declaration.fee ? formatFee(declaration.fee) : "Unavailable";
  const deploymentFee = declaration.deploymentFee
    ? formatFee(declaration.deploymentFee)
    : "Unavailable";
  const reviewedFee = declarationReviewedFee(approval);
  const estimatedTotal = reviewedFee ? formatFee(reviewedFee) : null;
  const deployment =
    declaration.accountDeployment === "undeployed"
      ? "Required before declaration"
      : declaration.accountDeployment === "deployed"
        ? "Already deployed"
        : "Could not verify";
  return `<dl class="request-detail declaration-detail"><div><dt>Action</dt><dd>Register Cairo 1 contract code</dd></div><div><dt>Declaration fee</dt><dd><strong>${escapeHtml(fee)}</strong></dd></div>${declaration.accountDeployment === "undeployed" ? `<div><dt>Account deployment fee</dt><dd><strong>${escapeHtml(deploymentFee)}</strong></dd></div>` : ""}${estimatedTotal === null ? "" : `<div><dt>Estimated total</dt><dd><strong>${escapeHtml(estimatedTotal)}</strong></dd></div>`}<div><dt>Fee token</dt><dd>${declaration.fee?.unit === "FRI" ? "STRK" : escapeHtml(declaration.fee?.unit ?? "Unavailable")}</dd></div><div><dt>Account deployment</dt><dd>${deployment}</dd></div>${declaration.classHash === undefined ? "" : `<div><dt>Class hash</dt><dd><code>${escapeHtml(declaration.classHash)}</code></dd></div>`}<div><dt>Compiled hash</dt><dd><code>${escapeHtml(declaration.compiledClassHash)}</code></dd></div><div><dt>Contract shape</dt><dd>${declaration.sierraProgramLength.toLocaleString()} Sierra words · ${declaration.abiEntryCount.toLocaleString()} ABI entries · ${declaration.entryPointCount.toLocaleString()} entry points</dd></div></dl>`;
};

/** The warnings a declaration card shows for its deployment and fee state. */
export const declarationWarnings = (approval: PendingApproval): readonly string[] => {
  const declaration = approval.declaration;
  if (!declaration) {
    return [];
  }
  return [
    "A declaration registers immutable contract code on this network. It does not deploy the collection or transfer assets.",
    ...(declaration.accountDeployment === "undeployed"
      ? [
          "This account is not deployed yet. Approval first submits account deployment, which has an additional STRK fee not included in the declaration estimate.",
        ]
      : []),
    ...(declaration.deploymentFeeEstimateFailed
      ? [
          "The account deployment fee could not be estimated. Fund the account with STRK and retry if deployment fails.",
        ]
      : []),
    ...(declaration.accountDeployment === "unknown"
      ? [
          "The wallet could not verify whether this account needs deployment. An additional STRK fee may apply.",
        ]
      : []),
    ...(declaration.feeEstimateFailed
      ? [
          "The declaration fee could not be estimated. Check the RPC connection and the account's STRK balance before approving.",
        ]
      : []),
  ];
};

/** Whether the declaration card must withhold Approve for want of a reviewed fee. */
export const declarationFeeUnavailable = (approval: PendingApproval): boolean =>
  declarationReviewedFee(approval) === null ||
  approval.declaration?.feeEstimateFailed === true ||
  approval.declaration?.deploymentFeeEstimateFailed === true;
