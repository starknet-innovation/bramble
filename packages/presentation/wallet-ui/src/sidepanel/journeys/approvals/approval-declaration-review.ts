/**
 * Declaration (Cairo class registration) review helpers for the approval
 * cards: the reviewed fee, its facts, and its warnings. Split from
 * ./approval-cards to keep that module within the size budget; presentation
 * only, every dynamic value escaped.
 */

import { escapeHtml } from "@bramble/core/html";
import { sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { uiLocale } from "../../../i18n/locale";
import { t, th } from "../../../i18n/messages";
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
  const unavailable = t("detail.declare.unavailable");
  const fee = declaration.fee ? formatFee(declaration.fee) : unavailable;
  const deploymentFee = declaration.deploymentFee
    ? formatFee(declaration.deploymentFee)
    : unavailable;
  const count = (value: number): string =>
    value.toLocaleString(uiLocale() === "en" ? "en-US" : uiLocale());
  const reviewedFee = declarationReviewedFee(approval);
  const estimatedTotal = reviewedFee ? formatFee(reviewedFee) : null;
  const deployment =
    declaration.accountDeployment === "undeployed"
      ? th("detail.declare.requiredBefore")
      : declaration.accountDeployment === "deployed"
        ? th("detail.declare.alreadyDeployed")
        : th("detail.declare.couldNotVerify");
  return `<dl class="request-detail declaration-detail"><div><dt>${th("detail.declare.actionLabel")}</dt><dd>${th("detail.declare.actionValue")}</dd></div><div><dt>${th("detail.declare.fee")}</dt><dd><strong>${escapeHtml(fee)}</strong></dd></div>${declaration.accountDeployment === "undeployed" ? `<div><dt>${th("detail.declare.deploymentFee")}</dt><dd><strong>${escapeHtml(deploymentFee)}</strong></dd></div>` : ""}${estimatedTotal === null ? "" : `<div><dt>${th("detail.declare.total")}</dt><dd><strong>${escapeHtml(estimatedTotal)}</strong></dd></div>`}<div><dt>${th("detail.declare.feeToken")}</dt><dd>${declaration.fee?.unit === "FRI" ? "STRK" : escapeHtml(declaration.fee?.unit ?? unavailable)}</dd></div><div><dt>${th("detail.declare.deployment")}</dt><dd>${deployment}</dd></div>${declaration.classHash === undefined ? "" : `<div><dt>${th("detail.declare.classHash")}</dt><dd><code>${escapeHtml(declaration.classHash)}</code></dd></div>`}<div><dt>${th("detail.declare.compiledHash")}</dt><dd><code>${escapeHtml(declaration.compiledClassHash)}</code></dd></div><div><dt>${th("detail.declare.shapeLabel")}</dt><dd>${th("detail.declare.shape", { abi: count(declaration.abiEntryCount), entries: count(declaration.entryPointCount), words: count(declaration.sierraProgramLength) })}</dd></div></dl>`;
};

/** The warnings a declaration card shows for its deployment and fee state. */
export const declarationWarnings = (approval: PendingApproval): readonly string[] => {
  const declaration = approval.declaration;
  if (!declaration) {
    return [];
  }
  return [
    t("detail.declare.warnRegisters"),
    ...(declaration.accountDeployment === "undeployed" ? [t("detail.declare.warnUndeployed")] : []),
    ...(declaration.deploymentFeeEstimateFailed ? [t("detail.declare.warnDeployFeeFailed")] : []),
    ...(declaration.accountDeployment === "unknown" ? [t("detail.declare.warnUnknown")] : []),
    ...(declaration.feeEstimateFailed ? [t("detail.declare.warnFeeFailed")] : []),
  ];
};

/** Whether the declaration card must withhold Approve for want of a reviewed fee. */
export const declarationFeeUnavailable = (approval: PendingApproval): boolean =>
  declarationReviewedFee(approval) === null ||
  approval.declaration?.feeEstimateFailed === true ||
  approval.declaration?.deploymentFeeEstimateFailed === true;
