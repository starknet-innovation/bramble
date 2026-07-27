/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */
import type { PendingApproval, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { button } from "../ui/controls";
import { icon } from "./icons";
import { accountLabel, formatFri } from "./parts";
import { reviewCallsList, reviewPanel, riskFlagMessages } from "./review-render";
import { signRequestDetails } from "./sign-request";

// Shared approve/deny controls (one long template line so it is not re-wrapped);
// `approve` is disabled when the wallet is locked or the origin is blocked.
const decisionRow = (approval: PendingApproval, label: string, locked: boolean): string =>
  `<div class="button-row">${button({
    attributes: { "data-approval-action": "approve", "data-approval-id": approval.id },
    disabled: locked || approval.blocked === true,
    icon: "check",
    label,
  })}${button({
    attributes: { "data-approval-action": "deny", "data-approval-id": approval.id },
    icon: "x",
    label: "Deny",
    tone: "danger",
    variant: "secondary",
  })}</div>`;

const contextDetails = (approval: PendingApproval): string => {
  const context = approval.context;
  if (!context) {
    return "";
  }
  return `<dl class="request-detail"><div><dt>Account</dt><dd><code>${escapeHtml(accountLabel(context.accountId))}</code></dd></div><div><dt>Network</dt><dd>${escapeHtml(context.networkId)}</dd></div><div><dt>Review digest</dt><dd><code>${escapeHtml(context.payloadDigest.slice(0, 23))}…</code></dd></div></dl>`;
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
  const estimatedTotal =
    declaration.fee?.unit === "FRI" &&
    (declaration.accountDeployment === "deployed" || declaration.deploymentFee?.unit === "FRI")
      ? formatFri(
          (
            BigInt(declaration.fee.overallFee) +
            BigInt(declaration.deploymentFee?.overallFee ?? "0")
          ).toString(),
        )
      : null;
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

const requestIdentity = (origin: string, kind: string): string => {
  let host = origin;
  try {
    host = new URL(origin).host || origin;
  } catch {
    // The full escaped value remains visible if an invalid origin reaches this
    // presentation boundary; approval validation still fails closed upstream.
  }
  return `<p class="eyebrow">${kind}</p><div class="request-site"><span class="request-site-mark">${icon("globe")}</span><div class="request-site-copy"><span>Request from</span><strong>${escapeHtml(host)}</strong><code>${escapeHtml(origin)}</code></div></div>`;
};

const connectCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Connection request")}
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
      ${requestIdentity(approval.origin, "Add token request")}
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
      ${requestIdentity(approval.origin, "Transaction request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and approve this transaction." : "Review each call carefully. Approving signs and submits it from your active account."}</p>
      ${contextDetails(approval)}
      ${reviewCallsList(approval.summaries ?? [])}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...(approval.insights ?? [])])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const signCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Sign request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "Review exactly what this site asks you to sign. Signing does not move funds — only sign messages you understand."}</p>
      ${contextDetails(approval)}
    </div>
    ${signRequestDetails(approval.typedData)}
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Sign", status.locked)}
  </li>`;

const strk20Card = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Private transaction request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review this private transaction." : "Review each private action and the frozen execution call. The prover cannot change it after approval."}</p>
      ${contextDetails(approval)}
      ${reviewCallsList(approval.summaries ?? [])}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Approve", status.locked)}
  </li>`;

const switchCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Network switch request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review this network change." : "This site is asking to change the wallet's active network. Nothing changes unless you approve."}</p>
      ${reviewCallsList(approval.summaries ?? [])}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Switch network", status.locked)}
  </li>`;

const addChainCard = (approval: PendingApproval): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Add network request")}
      <p class="hint">This site is asking to add a custom Starknet network. Nothing is saved unless you approve.</p>
      ${reviewCallsList(approval.summaries ?? [])}
    </div>
    ${reviewPanel(approval.insights ?? [])}
    ${decisionRow(approval, "Add network", false)}
  </li>`;

const declareCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Declare contract request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and declare this contract class." : "Approving signs and submits this exact class declaration from the account shown below."}</p>
      ${contextDetails(approval)}
      ${declarationDetails(approval)}
    </div>
    ${reviewPanel([...declarationWarnings(approval), ...(approval.insights ?? [])])}
    ${decisionRow(approval, "Declare", status.locked)}
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
    case "add-chain":
      return addChainCard(approval);
    case "declare":
      return declareCard(approval, status);
    default:
      return connectCard(approval, status);
  }
};
