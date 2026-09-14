/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { sumFeeEstimates } from "@bramble/starknet/fee-bounds";
import { button } from "@bramble/ui-kit/controls";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountIdAddress, accountLabel, formatFri, inlineCopyButton } from "../../shared/parts";
import {
  reviewCallsList,
  reviewConstraints,
  reviewFeeSection,
  reviewOutcome,
  reviewPanel,
  riskFlagMessages,
} from "../../shared/review-render";
import { SIGN_REQUEST_UNCLASSIFIED_WARNING, signRequestView } from "../../shared/sign-request";
import { tokenGlyph } from "../portfolio/token-row";

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
const decisionRow = (
  approval: PendingApproval,
  label: string,
  locked: boolean,
  reviewedFee?: PendingApproval["fee"],
): string =>
  `<div class="button-row">${button({
    attributes: {
      "data-approval-action": "approve",
      ...(reviewedFee
        ? {
            "data-approval-fee": reviewedFee.overallFee,
            "data-approval-fee-unit": reviewedFee.unit,
          }
        : {}),
      "data-approval-id": approval.id,
    },
    disabled: locked || approval.blocked === true,
    icon: "check",
    label,
  })}${denyButton(approval)}</div>`;

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

const strk20ActionParameters = (
  action: NonNullable<PendingApproval["actionReviews"]>[number],
  index: number,
): string => {
  if (action.type === "deposit") {
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · Deposit</strong><dl class="request-detail"><div><dt>Token</dt><dd><code>${escapeHtml(action.token)}</code></dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(action.amount)}</code></dd></div></dl></section>`;
  }
  if (action.type === "withdraw" || action.type === "transfer") {
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · ${action.type === "withdraw" ? "Withdraw" : "Private transfer"}</strong><dl class="request-detail"><div><dt>Token</dt><dd><code>${escapeHtml(action.token)}</code></dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(action.amount)}</code></dd></div><div><dt>Recipient</dt><dd><code>${escapeHtml(action.recipient)}</code></dd></div></dl></section>`;
  }
  if (action.type === "invoke") {
    return `<section class="strk20-action-review"><strong>Action ${index + 1} · Contract invoke</strong><dl class="request-detail"><div><dt>Contract</dt><dd><code>${escapeHtml(action.contract)}</code></dd></div><div><dt>Calldata (${action.calldata.length})</dt><dd>${exactCalldata(action.calldata)}</dd></div></dl></section>`;
  }
  const collect =
    action.collect_policy.type === "exact"
      ? `Exact · ${action.collect_policy.amount}`
      : action.collect_policy.type;
  const calls = action.calls
    .map(
      (call, callIndex) =>
        `<section class="strk20-action-call"><strong>Call ${callIndex + 1}</strong><dl class="request-detail"><div><dt>Contract</dt><dd><code>${escapeHtml(call.contract_address)}</code></dd></div><div><dt>Entrypoint</dt><dd><code>${escapeHtml(call.entry_point)}</code></dd></div><div><dt>Calldata (${call.calldata.length})</dt><dd>${exactCalldata(call.calldata)}</dd></div></dl></section>`,
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
    ? `<section class="strk20-action-review"><strong>Relay fee action · Withdrawal</strong><dl class="request-detail"><div><dt>Token</dt><dd><code>${escapeHtml(relayFee.token)}</code></dd></div><div><dt>Amount</dt><dd><code>${escapeHtml(relayFee.amount)}</code></dd></div><div><dt>Recipient</dt><dd><code>${escapeHtml(relayFee.recipient)}</code></dd></div></dl></section>`
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

const declarationReviewedFee = (approval: PendingApproval): PendingApproval["fee"] => {
  const declaration = approval.declaration;
  if (!declaration?.fee || declaration.accountDeployment === "unknown") return null;
  return declaration.accountDeployment === "undeployed"
    ? declaration.deploymentFee && sumFeeEstimates(declaration.fee, declaration.deploymentFee)
    : declaration.fee;
};

const declarationDetails = (approval: PendingApproval): string => {
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

const declarationWarnings = (approval: PendingApproval): readonly string[] => {
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

const declarationFeeUnavailable = (approval: PendingApproval): boolean =>
  declarationReviewedFee(approval) === null ||
  approval.declaration?.feeEstimateFailed === true ||
  approval.declaration?.deploymentFeeEstimateFailed === true;

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

const connectCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Connection request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to approve this site.</p>' : ""}
      ${reviewOutcome("Share the granted account addresses with this site until you disconnect it.")}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${reviewConstraints("No transaction is signed and no network fee is charged.")}
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
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "Review exactly what this site asks you to sign. Signing does not move funds — only sign messages you understand."}</p>
      ${reviewOutcome("Create a signed authorization over the decoded message shown below and return it to this site.")}
    </div>
    ${view.html}
    ${reviewPanel([
      ...(view.classified ? [] : [SIGN_REQUEST_UNCLASSIFIED_WARNING]),
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
    ${reviewConstraints("This approval carries no public wallet fee. Wallet-funded routes require a separate exact-call fee review.")}
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
      <p class="hint">${status.locked ? "Unlock the wallet to review this network change." : "This site is asking to change the wallet's active network. Nothing changes unless you approve."}</p>
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
      <p class="hint">This site is asking to add a custom Starknet network. Nothing is saved unless you approve.</p>
      ${approvalCalls(approval) || reviewOutcome("Add the requested custom Starknet network to the wallet.")}
    </div>
    ${reviewPanel([
      "Custom network endpoints can observe requests sent through them. Review the network details before use.",
      ...(approval.insights ?? []),
    ])}
    ${reviewConstraints("Adding the network does not sign a transaction or charge a fee.")}
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
    <section class="decision-layer decision-boundary" aria-label="Maximum cost and constraints">
      <p class="decision-label">Maximum cost and constraints</p>
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
