/**
 * Exact-parameter disclosures for approval cards: the full addresses, entrypoints
 * and calldata behind an invoke or STRK20 request, printed verbatim (escaped)
 * and copyable so the user can check them against an explorer. Split from
 * approval-cards.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { t, th } from "../../../i18n/messages";
import type { PendingApproval } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { inlineCopyButton } from "../../shared/parts";

const exactCalldata = (calldata: readonly string[]): string =>
  calldata.length === 0
    ? th("detail.params.none")
    : `<code>${calldata.map((item) => escapeHtml(item)).join(", ")}</code>`;

// An exact address in the technical details, printed in full and copyable so
// the user can check it against an explorer or the dapp's own docs.
const exactAddress = (address: string, label: string): string =>
  `<code>${escapeHtml(address)}</code>${inlineCopyButton(address, label)}`;

/**
 * The "Exact call parameters" disclosure for an invoke approval: every call's
 * full contract address, entrypoint and calldata, escaped. Empty when the
 * approval carries no call review.
 */
export const invokeCallReview = (approval: PendingApproval): string => {
  const calls = approval.callReviews;
  if (!calls || calls.length === 0) {
    return "";
  }
  return `<details class="disclosure request-technical">
    <summary>
      <span class="menu-copy"><strong>${th("detail.params.callsTitle")}</strong><small>${th(
        calls.length === 1 ? "detail.params.callsOne" : "detail.params.callsMany",
        { count: String(calls.length) },
      )}</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">${calls
      .map(
        (call, index) =>
          `<section class="strk20-action-call"><strong>${th("detail.params.call", { index: String(index + 1) })}</strong><dl class="request-detail"><div><dt>${th("detail.params.contract")}</dt><dd>${exactAddress(call.contractAddress, t("detail.params.copyCallContract", { index: String(index + 1) }))}</dd></div><div><dt>${th("detail.params.entrypoint")}</dt><dd><code>${escapeHtml(call.entrypoint)}</code></dd></div><div><dt>${th("detail.params.calldata", { count: String(call.calldata.length) })}</dt><dd>${exactCalldata(call.calldata)}</dd></div></dl></section>`,
      )
      .join("")}</div>
  </details>`;
};

const strk20ActionParameters = (
  action: NonNullable<PendingApproval["actionReviews"]>[number],
  index: number,
): string => {
  const n = String(index + 1);
  const tokenRow = (token: string): string =>
    `<div><dt>${th("detail.params.token")}</dt><dd>${exactAddress(token, t("detail.params.copyActionToken", { index: n }))}</dd></div>`;
  const amountRow = (amount: string): string =>
    `<div><dt>${th("detail.params.amount")}</dt><dd><code>${escapeHtml(amount)}</code></dd></div>`;
  const recipientRow = (recipient: string): string =>
    `<div><dt>${th("detail.params.recipient")}</dt><dd>${exactAddress(recipient, t("detail.params.copyActionRecipient", { index: n }))}</dd></div>`;
  if (action.type === "deposit") {
    const recipient = action.recipient === undefined ? "" : recipientRow(action.recipient);
    return `<section class="strk20-action-review"><strong>${th("detail.params.actionDeposit", { index: n })}</strong><dl class="request-detail">${tokenRow(action.token)}${amountRow(action.amount)}${recipient}</dl></section>`;
  }
  if (action.type === "withdraw" || action.type === "transfer") {
    return `<section class="strk20-action-review"><strong>${th(action.type === "withdraw" ? "detail.params.actionWithdraw" : "detail.params.actionTransfer", { index: n })}</strong><dl class="request-detail">${tokenRow(action.token)}${amountRow(action.amount)}${recipientRow(action.recipient)}</dl></section>`;
  }
  if (action.type === "invoke") {
    return `<section class="strk20-action-review"><strong>${th("detail.params.actionInvoke", { index: n })}</strong><dl class="request-detail"><div><dt>${th("detail.params.contract")}</dt><dd>${exactAddress(action.contract, t("detail.params.copyActionContract", { index: n }))}</dd></div><div><dt>${th("detail.params.calldata", { count: String(action.calldata.length) })}</dt><dd>${exactCalldata(action.calldata)}</dd></div></dl></section>`;
  }
  const collect =
    action.collect_policy.type === "exact"
      ? t("detail.params.collectExact", { amount: action.collect_policy.amount })
      : action.collect_policy.type;
  const calls = action.calls
    .map(
      (call, callIndex) =>
        `<section class="strk20-action-call"><strong>${th("detail.params.call", { index: String(callIndex + 1) })}</strong><dl class="request-detail"><div><dt>${th("detail.params.contract")}</dt><dd>${exactAddress(call.contract_address, t("detail.params.copyActionCallContract", { call: String(callIndex + 1), index: n }))}</dd></div><div><dt>${th("detail.params.entrypoint")}</dt><dd><code>${escapeHtml(call.entry_point)}</code></dd></div><div><dt>${th("detail.params.calldata", { count: String(call.calldata.length) })}</dt><dd>${exactCalldata(call.calldata)}</dd></div></dl></section>`,
    )
    .join("");
  return `<section class="strk20-action-review"><strong>${th("detail.params.actionShadow", { index: n })}</strong><dl class="request-detail"><div><dt>${th("detail.params.dapp")}</dt><dd>${escapeHtml(action.dapp_name)}</dd></div><div><dt>${th("detail.params.nonce")}</dt><dd><code>${escapeHtml(action.nonce)}</code></dd></div><div><dt>${th("detail.params.collectPolicy")}</dt><dd>${escapeHtml(collect)}</dd></div></dl>${calls}</section>`;
};

/**
 * The "Exact action parameters" disclosure for a STRK20 approval, including the
 * relay fee withdrawal when one is attached. Every value is escaped. Empty when
 * the approval carries no action review.
 */
export const strk20ActionReview = (approval: PendingApproval): string => {
  const actions = approval.actionReviews;
  if (!actions) {
    return "";
  }
  const relayFee = approval.relayFeeAction;
  const reviewedActionCount = actions.length + (relayFee ? 1 : 0);
  const relayFeeReview = relayFee
    ? `<section class="strk20-action-review"><strong>${th("detail.params.relayTitle")}</strong><dl class="request-detail"><div><dt>${th("detail.params.token")}</dt><dd>${exactAddress(relayFee.token, t("detail.params.copyRelayToken"))}</dd></div><div><dt>${th("detail.params.amount")}</dt><dd><code>${escapeHtml(relayFee.amount)}</code></dd></div><div><dt>${th("detail.params.recipient")}</dt><dd>${exactAddress(relayFee.recipient, t("detail.params.copyRelayRecipient"))}</dd></div></dl></section>`
    : "";
  const actionCountHint = t(relayFee ? "detail.params.hintRelay" : "detail.params.hintExpand");
  return `<details class="disclosure request-technical">
    <summary>
      <span class="menu-copy"><strong>${th("detail.params.actionsTitle")}</strong><small>${th(
        reviewedActionCount === 1 ? "detail.params.actionsOne" : "detail.params.actionsMany",
        { count: String(reviewedActionCount), hint: actionCountHint },
      )}</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">${actions.map(strk20ActionParameters).join("")}${relayFeeReview}</div>
  </details>`;
};
