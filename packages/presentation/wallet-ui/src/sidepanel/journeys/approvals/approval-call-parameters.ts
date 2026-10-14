/**
 * Exact-parameter disclosures for approval cards: the full addresses, entrypoints
 * and calldata behind an invoke or STRK20 request, printed verbatim (escaped)
 * and copyable so the user can check them against an explorer. Split from
 * approval-cards.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import type { PendingApproval } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { inlineCopyButton } from "../../shared/parts";

const exactCalldata = (calldata: readonly string[]): string =>
  calldata.length === 0
    ? "None"
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
      <span class="menu-copy"><strong>Exact call parameters</strong><small>${calls.length} call${calls.length === 1 ? "" : "s"} · full addresses and calldata</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">${calls
      .map(
        (call, index) =>
          `<section class="strk20-action-call"><strong>Call ${index + 1}</strong><dl class="request-detail"><div><dt>Contract</dt><dd>${exactAddress(call.contractAddress, `Copy call ${index + 1} contract address`)}</dd></div><div><dt>Entrypoint</dt><dd><code>${escapeHtml(call.entrypoint)}</code></dd></div><div><dt>Calldata (${call.calldata.length})</dt><dd>${exactCalldata(call.calldata)}</dd></div></dl></section>`,
      )
      .join("")}</div>
  </details>`;
};

const strk20ActionParameters = (
  action: NonNullable<PendingApproval["actionReviews"]>[number],
  index: number,
): string => {
  if (action.type === "deposit") {
    const recipient =
      action.recipient === undefined
        ? ""
        : `<div><dt>Recipient</dt><dd>${exactAddress(action.recipient, `Copy action ${index + 1} recipient address`)}</dd></div>`;
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · Deposit</strong><dl class="request-detail"><div><dt>Token</dt><dd>${exactAddress(action.token, `Copy action ${index + 1} token address`)}</dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(action.amount)}</code></dd></div>${recipient}</dl></section>`;
  }
  if (action.type === "withdraw" || action.type === "transfer") {
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · ${action.type === "withdraw" ? "Withdraw" : "Private transfer"}</strong><dl class="request-detail"><div><dt>Token</dt><dd>${exactAddress(action.token, `Copy action ${index + 1} token address`)}</dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(action.amount)}</code></dd></div><div><dt>Recipient</dt><dd>${exactAddress(action.recipient, `Copy action ${index + 1} recipient address`)}</dd></div></dl></section>`;
  }
  if (action.type === "invoke") {
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · Contract invoke</strong><dl class="request-detail"><div><dt>Contract</dt><dd>${exactAddress(action.contract, `Copy action ${index + 1} contract address`)}</dd></div><div><dt>Calldata (${action.calldata.length})</dt><dd>${exactCalldata(action.calldata)}</dd></div></dl></section>`;
  }
  const collect =
    action.collect_policy.type === "exact"
      ? `Exact · ${action.collect_policy.amount}`
      : action.collect_policy.type;
  const calls = action.calls
    .map(
      (call, callIndex) =>
        `<section class="strk20-action-call"><strong>Call ${callIndex + 1}</strong><dl class="request-detail"><div><dt>Contract</dt><dd>${exactAddress(call.contract_address, `Copy action ${index + 1} call ${callIndex + 1} contract address`)}</dd></div><div><dt>Entrypoint</dt><dd><code>${escapeHtml(call.entry_point)}</code></dd></div><div><dt>Calldata (${call.calldata.length})</dt><dd>${exactCalldata(call.calldata)}</dd></div></dl></section>`,
    )
    .join("");
  return `<section class="strk20-action-review"><strong>Action ${index + 1} · Shadow account invoke</strong><dl class="request-detail"><div><dt>Dapp</dt><dd>${escapeHtml(action.dapp_name)}</dd></div><div><dt>Nonce</dt><dd><code>${escapeHtml(action.nonce)}</code></dd></div><div><dt>Collect policy</dt><dd>${escapeHtml(collect)}</dd></div></dl>${calls}</section>`;
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
    ? `<section class="strk20-action-review"><strong>Relay fee action · Withdrawal</strong><dl class="request-detail"><div><dt>Token</dt><dd>${exactAddress(relayFee.token, "Copy relay fee token address")}</dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(relayFee.amount)}</code></dd></div><div><dt>Recipient</dt><dd>${exactAddress(relayFee.recipient, "Copy relay fee recipient address")}</dd></div></dl></section>`
    : "";
  const actionCountHint = relayFee ? "including relay fee" : "expand before approving";
  return `<details class="disclosure request-technical">
    <summary>
      <span class="menu-copy"><strong>Exact action parameters</strong><small>${reviewedActionCount} action${reviewedActionCount === 1 ? "" : "s"} · ${actionCountHint}</small></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">${actions.map(strk20ActionParameters).join("")}${relayFeeReview}</div>
  </details>`;
};
