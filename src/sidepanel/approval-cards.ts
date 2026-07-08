/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */
import type { PendingApproval, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { icon } from "./icons";
import { accountLabel } from "./parts";
import { signRequestDetails } from "./sign-request";

const reviewPanel = (items: readonly string[]): string =>
  items.length === 0
    ? ""
    : `<div class="review-panel" role="note">${items
        .map((item) => `<p class="review-flag">${icon("alert")}${escapeHtml(item)}</p>`)
        .join("")}</div>`;

// Shared approve/deny controls (one long template line so it is not re-wrapped);
// `approve` is disabled when the wallet is locked or the origin is blocked.
const decisionRow = (approval: PendingApproval, label: string, locked: boolean): string =>
  `<div class="button-row"><button data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}" type="button" ${locked || approval.blocked ? "disabled" : ""}>${icon("check")}${label}</button><button class="secondary danger" data-approval-action="deny" data-approval-id="${escapeHtml(approval.id)}" type="button">${icon("x")}Deny</button></div>`;

const connectCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Connection request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to approve this site." : "Once approved, this site can see your granted account addresses."}</p>
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const watchAssetCard = (approval: PendingApproval): string => {
  const token = approval.token;
  if (!token) {
    return "";
  }
  return `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Add token request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <dl class="request-detail"><div><dt>Symbol</dt><dd>${escapeHtml(token.symbol)}</dd></div><div><dt>Name</dt><dd>${escapeHtml(token.name)}</dd></div><div><dt>Decimals</dt><dd>${escapeHtml(String(token.decimals))}</dd></div><div><dt>Address</dt><dd><code>${escapeHtml(accountLabel(token.address))}</code></dd></div></dl>
      <p class="hint">Approve to track this ERC20 token in your wallet.</p>
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Add token", false)}
  </li>`;
};

// Everything is inlined into the template (template contents are not re-wrapped)
// so the decoded calls and combined risk-flag/insight warnings stay compact.
const invokeCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Transaction request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review and approve this transaction." : "Review each call carefully. Approving signs and submits it from your active account."}</p>
      ${!approval.summaries?.length ? "" : `<ul class="review-calls">${approval.summaries.map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`).join("")}</ul>`}
    </div>
    ${reviewPanel([...(approval.flags ?? []).map((flag) => flag.message), ...(approval.insights ?? [])])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const signCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Sign request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "Review exactly what this site asks you to sign. Signing does not move funds — only sign messages you understand."}</p>
    </div>
    ${signRequestDetails(approval.typedData)}
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Sign", status.locked)}
  </li>`;

const strk20Card = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Private transaction request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review this private transaction." : "Review each private action. Approving builds the proof and submits it from your active account."}</p>
      ${!approval.summaries?.length ? "" : `<ul class="review-calls">${approval.summaries.map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`).join("")}</ul>`}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const switchCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      <p class="eyebrow">Network switch request</p>
      <p class="request-origin">${escapeHtml(approval.origin)}</p>
      <p class="hint">${status.locked ? "Unlock the wallet to review this network change." : "This site is asking to change the wallet's active network. Nothing changes unless you approve."}</p>
      ${!approval.summaries?.length ? "" : `<ul class="review-calls">${approval.summaries.map((summary) => `<li class="review-call">${escapeHtml(summary)}</li>`).join("")}</ul>`}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Switch network", status.locked)}
  </li>`;

/**
 * Renders the correct approval card for a pending dapp request by kind.
 */
export const approvalCard = (approval: PendingApproval, status: WalletStatus): string => {
  switch (approval.kind) {
    case "watch-asset":
      return watchAssetCard(approval);
    case "invoke":
      return invokeCard(approval, status);
    case "sign-typed-data":
      return signCard(approval, status);
    case "strk20-invoke":
      return strk20Card(approval, status);
    case "switch-chain":
      return switchCard(approval, status);
    default:
      return connectCard(approval, status);
  }
};
