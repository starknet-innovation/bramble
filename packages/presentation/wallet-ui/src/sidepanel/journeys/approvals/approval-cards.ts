/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { button } from "@bramble/ui-kit/controls";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountIdAddress, accountLabel, inlineCopyButton } from "../../shared/parts";
import {
  reviewCallsList,
  reviewConstraints,
  reviewFeeSection,
  reviewOutcome,
  reviewPanel,
  riskFlagMessages,
} from "../../shared/review-render";
import {
  SIGN_REQUEST_UNCLASSIFIED_WARNING,
  signRequestView,
  signRequestWarnings,
} from "../../shared/sign-request";
import { tokenGlyph } from "../portfolio/token-row";
import {
  declarationDetails,
  declarationFeeUnavailable,
  declarationReviewedFee,
  declarationWarnings,
} from "./approval-declaration-review";

const denyButton = (approval: PendingApproval): string =>
  button({
    attributes: { "data-approval-action": "deny", "data-approval-id": approval.id },
    icon: "x",
    label: "Deny",
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
const decisionRow = (
  approval: PendingApproval,
  label: string,
  locked: boolean,
  reviewedFee?: PendingApproval["fee"],
  reviewed: Readonly<Record<string, string>> = {},
): string =>
  `<div class="button-row">${denyButton(approval)}${button({
    attributes: {
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

// Used when the card cannot describe what approving would commit to: the
// approve control is absent rather than merely disabled, so a partial view can
// never be approved by mistake.
const denyOnlyRow = (approval: PendingApproval): string =>
  `<div class="button-row">${denyButton(approval)}</div>`;

// The signing account is identified by its `<network>:<address>` id; the row
// shows the address half truncated and copies it whole.
const contextDetails = (approval: PendingApproval): string => {
  const context = approval.context;
  if (!context) {
    return "";
  }
  const address = accountIdAddress(context.accountId);
  return `<dl class="request-detail"><div><dt>Account</dt><dd><code title="${escapeHtml(address)}">${escapeHtml(accountLabel(address))}</code>${inlineCopyButton(address, "Copy account address")}</dd></div><div><dt>Network</dt><dd>${escapeHtml(context.networkId)}</dd></div><div><dt>Review digest</dt><dd><code>${escapeHtml(context.payloadDigest.slice(0, 23))}…</code></dd></div></dl>`;
};

const contextDisclosure = (approval: PendingApproval): string => {
  const details = contextDetails(approval);
  return details
    ? `<details class="disclosure request-technical">
        <summary>
          <span class="menu-copy"><strong>Technical details</strong><small>Account, network, and review digest</small></span>
          <span class="disclosure-mark">${icon("chevronRight")}</span>
        </summary>
        <div class="disclosure-body">${details}</div>
      </details>`
    : "";
};

const exactCalldata = (calldata: readonly string[]): string =>
  calldata.length === 0
    ? "None"
    : `<code>${calldata.map((item) => escapeHtml(item)).join(", ")}</code>`;

// An exact address in the technical details, printed in full and copyable so
// the user can check it against an explorer or the dapp's own docs.
const exactAddress = (address: string, label: string): string =>
  `<code>${escapeHtml(address)}</code>${inlineCopyButton(address, label)}`;

const invokeCallReview = (approval: PendingApproval): string => {
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
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · Deposit</strong><dl class="request-detail"><div><dt>Token</dt><dd>${exactAddress(action.token, `Copy action ${index + 1} token address`)}</dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(action.amount)}</code></dd></div></dl></section>`;
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
  return `<section class="strk20-action-review"><strong>Action ${index + 1} · Subaccount invoke</strong><dl class="request-detail"><div><dt>Dapp</dt><dd>${escapeHtml(action.dapp_name)}</dd></div><div><dt>Nonce</dt><dd><code>${escapeHtml(action.nonce)}</code></dd></div><div><dt>Collect policy</dt><dd>${escapeHtml(collect)}</dd></div></dl>${calls}</section>`;
};

const strk20ActionReview = (approval: PendingApproval): string => {
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

const strk20LinkageWarnings = (approval: PendingApproval): readonly string[] => {
  const actions = approval.actionReviews ?? [];
  return actions.some((action) => action.type === "deposit") &&
    actions.some((action) => action.type !== "deposit")
    ? [
        "This mixed batch includes a public deposit approval, linking this account to the private relay transaction. Split the deposit and private actions if that linkage is not intended.",
      ]
    : [];
};

const requestIdentity = (origin: string, kind: string): string => {
  let host = origin;
  try {
    host = new URL(origin).host || origin;
  } catch {
    // The full escaped value remains visible if an invalid origin reaches this
    // presentation boundary; approval validation still fails closed upstream.
  }
  return `<p class="eyebrow">${kind}</p><div class="request-site"><span class="request-site-mark">${icon("globe")}</span><div class="request-site-copy"><span>Request from</span><strong title="${escapeHtml(origin)}">${escapeHtml(host)}</strong></div></div>`;
};

const approvalCalls = (approval: PendingApproval): string =>
  reviewCallsList(approval.summaries ?? [], approval.reviewAssets ?? []);

// The account that approving will share is the active one, named on the card
// face — not behind a disclosure — and echoed back with the decision so the
// background can refuse if it moved. The grant delta is stated only when the
// queue knows a grant already exists; otherwise the plain first-share copy.
const connectIdentity = (status: WalletStatus): string => {
  const account = status.accounts.find((candidate) => candidate.id === status.activeAccountId);
  if (!account) {
    return `<p class="hint">${status.locked ? "Unlock the wallet to see which account will be shared." : "Select an account on this network to share it."}</p>`;
  }
  return `<dl class="request-detail"><div><dt>Account</dt><dd><code title="${escapeHtml(account.address)}">${escapeHtml(accountLabel(account.address))}</code>${inlineCopyButton(account.address, "Copy account address")}</dd></div><div><dt>Network</dt><dd>${escapeHtml(status.network)}</dd></div></dl>`;
};

const connectCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Connection request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to approve this site.</p>' : ""}
      ${connectIdentity(status)}
      ${reviewOutcome(
        approval.existingGrant
          ? "Adds this account to the ones already shared with this site, until you disconnect it."
          : "Shares this account's address with this site until you disconnect it.",
      )}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(
      approval,
      "Approve",
      status.locked || status.activeAccountId === null,
      undefined,
      status.activeAccountId === null ? {} : { "data-approval-account": status.activeAccountId },
    )}
  </li>`;

const watchAssetCard = (approval: PendingApproval): string => {
  const token = approval.token;
  if (!token) {
    return "";
  }
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Add token request")}
      <dl class="request-detail"><div><dt>Token</dt><dd class="request-token">${tokenGlyph(token.address, token.symbol)}<strong>${escapeHtml(token.symbol)}</strong></dd></div><div><dt>Name</dt><dd>${escapeHtml(token.name)}</dd></div><div><dt>Address</dt><dd><code title="${escapeHtml(token.address)}">${escapeHtml(accountLabel(token.address))}</code>${inlineCopyButton(token.address, "Copy token address")}</dd></div></dl>
      ${reviewOutcome("Add this token contract to the wallet's tracked asset list.")}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(approval, "Add token", false)}
  </li>`;
};

// Everything is inlined into the template (template contents are not re-wrapped)
// so the decoded calls and combined risk-flag/insight warnings stay compact.
// The fee section renders through the shared `reviewFeeSection` — the same
// renderer the Send review uses — so the two surfaces cannot drift (issue 189). The
// retry button targets this approval by data attribute. A failed or absent fee
// estimate disables Approve exactly as Send does: without a displayed amount
// there is no fee ceiling for the user's consent to bind.
const invokeCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Transaction request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to review and approve this transaction.</p>' : ""}
      ${approvalCalls(approval) || reviewOutcome("Sign and submit the decoded transaction from the active account.")}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...(approval.insights ?? [])])}
    ${
      reviewFeeSection(
        {
          fee: approval.fee ?? null,
          feeAffordability: approval.feeAffordability ?? "unknown",
          feeEstimateFailed: approval.feeEstimateFailed === true,
          feeEstimatePending: approval.feeEstimatePending === true,
          requiresDeployment: approval.requiresDeployment === true,
        },
        { "data-approval-retry-fee": approval.id },
      ) ||
      reviewConstraints(
        "The network fee is unavailable. Approval remains disabled until a fee can be reviewed.",
      )
    }
    ${invokeCallReview(approval)}
    ${contextDisclosure(approval)}
    ${decisionRow(
      approval,
      "Approve",
      status.locked ||
        approval.feeEstimatePending === true ||
        approval.feeEstimateFailed === true ||
        approval.fee == null,
      approval.fee ?? undefined,
    )}
  </li>`;

// A sign card only offers to sign what the decoder could place on one side of
// the signed hash or the other; an unclassified payload gets the warning and a
// Deny-only row instead, because a partial view of a message is exactly what a
// hostile payload wants the user to trust.
const signCard = (approval: PendingApproval, status: WalletStatus): string => {
  const view = signRequestView(approval.typedData);
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Sign request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "Signatures can authorize transfers or account access. Only sign requests you understand."}</p>
      ${reviewOutcome("Create a signed authorization over the decoded message shown below and return it to this site.")}
    </div>
    ${view.html}
    ${reviewPanel([
      ...(view.classified ? [] : [SIGN_REQUEST_UNCLASSIFIED_WARNING]),
      ...signRequestWarnings(approval.typedData),
      ...(approval.insights ?? []),
    ])}
    ${reviewConstraints("No transaction or network fee is submitted. The signed result can still authorize site-specific actions.")}
    ${contextDisclosure(approval)}
    ${view.classified ? decisionRow(approval, "Sign", status.locked) : denyOnlyRow(approval)}
  </li>`;
};

const strk20Card = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Private transaction request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to review this private transaction.</p>' : ""}
      ${approvalCalls(approval) || reviewOutcome("Authorize the exact private action bound to this request.")}
    </div>
    ${reviewPanel([...strk20LinkageWarnings(approval), ...(approval.insights ?? [])])}
    ${reviewConstraints("This approval charges no fee. If the wallet pays the network fee for this route, you will review that fee separately.")}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const strk20DisclosureCard = (
  approval: PendingApproval,
  status: WalletStatus,
  copy: {
    readonly action: string;
    readonly hint: string;
    readonly lockedHint: string;
    readonly title: string;
  },
): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, copy.title)}
      ${status.locked ? `<p class="hint">${copy.lockedHint}</p>` : ""}
      ${approvalCalls(approval) || reviewOutcome(copy.hint)}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("This approval carries no transaction fee. Any later transaction requires its own review.")}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${decisionRow(approval, copy.action, status.locked)}
  </li>`;

const switchCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Network switch request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review this network change." : "This site is asking to change the wallet's active network."}</p>
      ${approvalCalls(approval) || reviewOutcome("Switch the wallet to the requested Starknet network.")}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(approval, "Switch network", status.locked)}
  </li>`;

const addChainCard = (approval: PendingApproval): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Add network request")}
      <p class="hint">This site is asking to add a custom Starknet network.</p>
      ${approvalCalls(approval) || reviewOutcome("Add the requested custom Starknet network to the wallet.")}
    </div>
    ${reviewPanel([
      "Custom network endpoints can observe requests sent through them. Review the network details before use.",
      ...(approval.insights ?? []),
    ])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
    ${decisionRow(approval, "Add network", false)}
  </li>`;

const declareCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Declare contract request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and declare this contract class." : "Approving signs and submits this exact class declaration from the account shown below."}</p>
      ${reviewOutcome("Register this exact Cairo contract class on the active network from the reviewed account.")}
    </div>
    ${reviewPanel([...declarationWarnings(approval), ...(approval.insights ?? [])], "Declaration registers code but does not deploy a contract or transfer assets.")}
    <section class="decision-layer decision-boundary" aria-label="Cost">
      <p class="decision-label">Cost</p>
      ${declarationDetails(approval)}
    </section>
    ${contextDisclosure(approval)}
    ${declarationFeeUnavailable(approval) ? button({ attributes: { "data-approval-retry-fee": approval.id }, disabled: status.locked, icon: "refresh", label: "Retry fee estimate", variant: "secondary" }) : ""}
    ${decisionRow(
      approval,
      "Declare",
      status.locked || declarationFeeUnavailable(approval),
      declarationReviewedFee(approval) ?? undefined,
    )}
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
    case "strk20-balances":
      return strk20DisclosureCard(approval, status, {
        action: "Share balances",
        hint:
          approval.summaries?.[0] === "Share all private token balances"
            ? "This reveals every private token balance discovered for this account to the site. It does not move funds."
            : "This reveals only the listed private token balances to this site. It does not move funds.",
        lockedHint: "Unlock the wallet to review this private balance request.",
        title: "Private balance request",
      });
    case "strk20-invoke":
      return strk20Card(approval, status);
    case "strk20-prepare":
      return strk20DisclosureCard(approval, status, {
        action: "Authorize",
        hint: "This may generate a proof that authorizes the exact private actions below. The site can submit a returned proof.",
        lockedHint: "Unlock the wallet to review this private proof request.",
        title: "Private proof request",
      });
    case "strk20-register":
      return strk20DisclosureCard(approval, status, {
        action: "Activate",
        hint: "This consent prepares the one-time public registration commitment and proof; it does not submit yet. A separate exact-call network-fee approval follows before the wallet publishes the commitment. The viewing key and private notes are never published.",
        lockedHint: "Unlock the wallet to review this private-balance activation.",
        title: "Activate private balances",
      });
    case "strk20-subaccount":
      return strk20DisclosureCard(approval, status, {
        action: "Share commitment",
        hint: "This reveals a deterministic, site-scoped private identity commitment that may link sessions for this site.",
        lockedHint: "Unlock the wallet to review this private identity request.",
        title: "Private identity request",
      });
    case "switch-chain":
      return switchCard(approval, status);
    case "add-chain":
      return addChainCard(approval);
    case "declare":
      return declareCard(approval, status);
    case "connect":
      return connectCard(approval, status);
  }
};
