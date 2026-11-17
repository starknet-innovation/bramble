/**
 * Controls and headers shared by the side panel approval cards. Split from
 * approval-cards.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { button } from "@bramble/ui-kit/controls";
import type { PendingApproval } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";

/** The deny control for one approval; `label` names it (Close on a notice). */
export const denyButton = (approval: PendingApproval, label = "Deny"): string =>
  button({
    attributes: { "data-approval-action": "deny", "data-approval-id": approval.id },
    icon: "x",
    label,
    tone: "danger",
    variant: "secondary",
  });

// Shared approve/deny controls (one long template line so it is not re-wrapped);
// `approve` is disabled when the wallet is locked or the origin is blocked.
// `reviewedFee`, when the card priced the request, is stamped onto the approve
// control so the click reports the figure THIS paint showed. The background
// binds the submission to that echo and refuses if its own copy has moved
// since, which is how a card left open behind a re-estimate on another wallet
// surface cannot approve a ceiling the user never read.
// Deny leads Approve in DOM and reading order: the safe choice is reached
// first by keyboard and eye, and a gesture begun on the previous screen lands
// on it rather than on consent (spec item 15).
/** Deny-then-approve controls for one approval card. */
export const decisionRow = (
  approval: PendingApproval,
  label: string,
  locked: boolean,
  reviewedFee?: PendingApproval["fee"],
  reviewed: Readonly<Record<string, string>> = {},
  denyLabel = "Deny",
): string =>
  `<div class="button-row">${denyButton(approval, denyLabel)}${button({
    attributes: {
      "data-approval-kind": approval.kind,
      "data-approval-action": "approve",
      ...(reviewedFee
        ? {
            "data-approval-fee": reviewedFee.overallFee,
            "data-approval-fee-unit": reviewedFee.unit,
          }
        : {}),
      "data-approval-id": approval.id,
      ...reviewed,
    },
    disabled: locked || approval.blocked === true,
    icon: "check",
    label,
  })}</div>`;

/** The card eyebrow and the requesting site; the origin is escaped here. */
export const requestIdentity = (origin: string, kind: string): string => {
  let host = origin;
  try {
    host = new URL(origin).host || origin;
  } catch {
    // The full escaped value remains visible if an invalid origin reaches this
    // presentation boundary; approval validation still fails closed upstream.
  }
  return `<p class="eyebrow">${kind}</p><div class="request-site"><span class="request-site-mark">${icon("globe")}</span><div class="request-site-copy"><span>Request from</span><strong title="${escapeHtml(origin)}">${escapeHtml(host)}</strong></div></div>`;
};
