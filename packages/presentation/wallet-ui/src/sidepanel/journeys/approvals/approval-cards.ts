/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { type SpamReason, tokenSpamReasons } from "@bramble/portfolio/token-registry";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";
import { PRIVATE_SERVICES_UNAVAILABLE_NOTICE } from "@bramble/wallet-protocol/privacy-blocker";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountDisplayName,
  accountIdAddress,
  accountLabel,
  inlineCopyButton,
} from "../../shared/parts";
import {
  reviewCallsList,
  reviewConstraints,
  reviewCostNote,
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
import { invokeCallReview, strk20ActionReview } from "./approval-call-parameters";
import {
  declarationDetails,
  declarationFeeUnavailable,
  declarationReviewedFee,
  declarationWarnings,
} from "./approval-declaration-review";

const denyButton = (approval: PendingApproval, label = "Deny"): string =>
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
const decisionRow = (
  approval: PendingApproval,
  label: string,
  locked: boolean,
  reviewedFee?: PendingApproval["fee"],
  reviewed: Readonly<Record<string, string>> = {},
  denyLabel = "Deny",
): string =>
  `<div class="button-row">${denyButton(approval, denyLabel)}${button({
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

// A payment whose recipient mimics an address the user saved or paid reaches
// the card instead of being refused on arrival, so the site cannot read the
// address book from the answer (Sherlock 140). It can only be denied: the
// approve control is absent, and the background refuses it at execution too.
// The line above the row says why Approve is missing.
const paysLookalike = (approval: PendingApproval): boolean =>
  (approval.flags ?? []).some((flag) => flag.code === "address-poisoning");

const paymentDecisionRow = (
  approval: PendingApproval,
  label: string,
  locked: boolean,
  reviewedFee?: PendingApproval["fee"],
): string =>
  paysLookalike(approval)
    ? `<p class="hint">Bramble won't send this payment.</p>${denyOnlyRow(approval)}`
    : decisionRow(approval, label, locked, reviewedFee);

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

const strk20LinkageWarnings = (approval: PendingApproval): readonly string[] => {
  const actions = approval.actionReviews ?? [];
  return actions.some((action) => action.type === "deposit") &&
    actions.some((action) => action.type !== "deposit")
    ? [
        "This mixed batch includes a public deposit approval, linking this account to the private relay transaction. Split the deposit and private actions if that linkage is not intended.",
      ]
    : [];
};

// A deposit naming a recipient credits that account's private balance, so a
// site can dress a payment up as a shield. Only a recipient proven equal to the
// approval's bound account reads as a self-deposit; with no bound account the
// card cannot prove that, so it warns.
const strk20DepositPayeeWarnings = (approval: PendingApproval): readonly string[] => {
  const account = approval.context ? accountIdAddress(approval.context.accountId) : undefined;
  return (approval.actionReviews ?? []).flatMap((action) =>
    action.type === "deposit" &&
    action.recipient !== undefined &&
    !sameFelt(action.recipient, account)
      ? [
          `This deposit pays ${accountLabel(action.recipient)}: the amount becomes that account's private note, not your private balance.`,
        ]
      : [],
  );
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
const connectIdentity = (status: WalletStatus, preferences: WalletPreferences | null): string => {
  const account = status.accounts.find((candidate) => candidate.id === status.activeAccountId);
  if (!account) {
    return `<p class="hint">${status.locked ? "Unlock the wallet to see which account will be shared." : "Select an account on this network to share it."}</p>`;
  }
  return `<dl class="request-detail"><div><dt>Account</dt><dd class="request-account"><strong>${escapeHtml(accountDisplayName(account, preferences))}</strong><span class="copy-line"><code title="${escapeHtml(account.address)}">${escapeHtml(accountLabel(account.address))}</code>${inlineCopyButton(account.address, "Copy account address")}</span></dd></div><div><dt>Network</dt><dd>${escapeHtml(status.network)}</dd></div></dl>`;
};

const connectCard = (
  approval: PendingApproval,
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Connection request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to approve this site.</p>' : ""}
      ${connectIdentity(status, preferences)}
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
      "Connect account",
      status.locked || status.activeAccountId === null,
      undefined,
      status.activeAccountId === null ? {} : { "data-approval-account": status.activeAccountId },
      "Cancel",
    )}
  </li>`;

// Fixed copy per spam reason (audit 171): the card the user decides on says why
// the token looks wrong, and that the wallet will store it hidden.
const SPAM_WARNINGS: Readonly<Record<SpamReason, string>> = {
  "absurd-decimals": "This token reports an implausible number of decimals.",
  "empty-name": "This token has no name.",
  "symbol-spoof": "This token uses the ticker of a different, known token contract.",
};

const watchAssetWarnings = (token: NonNullable<PendingApproval["token"]>): readonly string[] => {
  const reasons = tokenSpamReasons(token);
  return reasons.length === 0
    ? []
    : [
        ...reasons.map((reason) => SPAM_WARNINGS[reason]),
        "If added, it stays hidden until you show it.",
      ];
};

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
    ${reviewPanel([...watchAssetWarnings(token), ...(approval.insights ?? [])])}
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
      // An undeployed Braavos account deploys only through its own step: say
      // so, with no fee and no retry, and Approve stays disabled (no fee).
      (approval.deployFirst === true && reviewCostNote(UNDEPLOYED_BRAAVOS_REFUSAL)) ||
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
      reviewCostNote(
        "The network fee is unavailable. Approval remains disabled until a fee can be reviewed.",
      )
    }
    ${invokeCallReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(
      approval,
      "Approve",
      status.locked ||
        approval.feeEstimatePending === true ||
        approval.feeEstimateFailed === true ||
        approval.fee == null,
      approval.fee ?? undefined,
    )}
  </li>`;

// summaries[0] names the message; any further entries are the decoded calls an
// OutsideExecution authorizes, listed with its risk flags (audit 144).
// A sign card only offers to sign what the decoder could place on one side of
// the signed hash or the other; an unclassified payload gets the warning and a
// Deny-only row instead, because a partial view of a message is exactly what a
// hostile payload wants the user to trust. An OutsideExecution paying a
// lookalike is Deny-only too, like a payment card (Sherlock 140).
const signCard = (approval: PendingApproval, status: WalletStatus): string => {
  const view = signRequestView(approval.typedData);
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Sign request")}
      <p class="hint">${status.locked ? "Unlock the wallet to review and sign this message." : "Signatures can authorize transfers or account access. Only sign requests you understand."}</p>
      ${reviewOutcome("Create a signed authorization over the decoded message shown below and return it to this site.")}
      ${reviewCallsList(approval.summaries?.slice(1) ?? [])}
    </div>
    ${view.html}
    ${reviewPanel([
      ...riskFlagMessages(approval.flags ?? []),
      ...(view.classified ? [] : [SIGN_REQUEST_UNCLASSIFIED_WARNING]),
      ...signRequestWarnings(approval.typedData),
      ...(approval.insights ?? []),
    ])}
    ${reviewConstraints("No transaction or network fee is submitted. The signed result can still authorize site-specific actions.")}
    ${contextDisclosure(approval)}
    ${view.classified ? paymentDecisionRow(approval, "Sign", status.locked) : denyOnlyRow(approval)}
  </li>`;
};

const strk20Card = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, "Private transaction request")}
      ${status.locked ? '<p class="hint">Unlock the wallet to review this private transaction.</p>' : ""}
      ${approvalCalls(approval) || reviewOutcome("Authorize the exact private action bound to this request.")}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...strk20DepositPayeeWarnings(approval), ...strk20LinkageWarnings(approval), ...(approval.insights ?? [])])}
    ${reviewConstraints("This approval charges no public wallet fee. A relay fee, if listed above, is paid from the private balance. If the wallet pays the network fee for this route, you will review that fee separately.")}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(approval, "Approve", status.locked)}
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
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...strk20DepositPayeeWarnings(approval), ...(approval.insights ?? [])])}
    ${reviewConstraints("This approval carries no transaction fee. Any later transaction requires its own review.")}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(approval, copy.action, status.locked)}
  </li>`;

// A site's private request on a network with no private services for it. The
// site is answered only when the user closes this, so it cannot probe what the
// wallet has set up. One fixed line and a Close control; nothing the site sent
// is shown, and there is nothing to approve — Close works locked too.
const strk20UnavailableCard = (approval: PendingApproval): string => `
  <li class="request-card">
    <div class="request-copy">
      <p>${escapeHtml(PRIVATE_SERVICES_UNAVAILABLE_NOTICE)}</p>
    </div>
    <div class="button-row">${denyButton(approval, "Close")}</div>
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
export const approvalCard = (
  approval: PendingApproval,
  status: WalletStatus,
  preferences: WalletPreferences | null = null,
): string => {
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
    case "strk20-shadow-account":
      return strk20DisclosureCard(approval, status, {
        action: "Share commitment",
        hint: "This reveals a deterministic, site-scoped private identity commitment that may link sessions for this site.",
        lockedHint: "Unlock the wallet to review this private identity request.",
        title: "Private identity request",
      });
    case "strk20-unavailable":
      return strk20UnavailableCard(approval);
    case "switch-chain":
      return switchCard(approval, status);
    case "add-chain":
      return addChainCard(approval);
    case "declare":
      return declareCard(approval, status);
    case "connect":
      return connectCard(approval, status, preferences);
  }
};
