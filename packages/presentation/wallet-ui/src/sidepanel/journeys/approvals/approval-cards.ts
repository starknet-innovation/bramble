/**
 * Pending-approval card renderers for the side panel Requests list: connection,
 * watch-asset, invoke, sign-typed-data, and network-switch prompts. Split from
 * views.ts to keep each file within the size budget.
 */

import { escapeHtml } from "@bramble/core/html";
import { nftsShown, type WalletPreferences } from "@bramble/settings/preferences";
import { reviewedInvokeTotal } from "@bramble/starknet/fee-bounds";
import { button } from "@bramble/ui-kit/controls";
import { UNDEPLOYED_BRAAVOS_REFUSAL } from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";
import {
  PRIVACY_OTHER_WALLET_ACTION,
  PRIVATE_REQUEST_FAILED_NOTICE,
  PRIVATE_SERVICES_UNAVAILABLE_NOTICE,
  SHADOW_ACCOUNT_RECORD_LIMIT_NOTICE,
} from "@bramble/wallet-protocol/privacy-blocker";
import { t, th } from "../../../i18n/messages";
import { reviewLines } from "../../../i18n/review";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountIdAddress, accountLabel, inlineCopyButton } from "../../shared/parts";
import {
  type ReviewFeeState,
  reviewCallItems,
  reviewCallsList,
  reviewConstraints,
  reviewCostNote,
  reviewFeeSection,
  reviewOutcome,
  reviewOutcomeSection,
  reviewPanel,
  riskFlagMessages,
} from "../../shared/review-render";
import {
  signRequestUnclassifiedWarning,
  signRequestView,
  signRequestWarnings,
} from "../../shared/sign-request";
import { invokeCallReview, strk20ActionReview } from "./approval-call-parameters";
import { decisionRow, denyButton, requestIdentity } from "./approval-card-parts";
import { type ConnectPicker, connectCard } from "./approval-connect-card";
import {
  declarationDetails,
  declarationFeeUnavailable,
  declarationReviewedFee,
  declarationWarnings,
} from "./approval-declaration-review";
import { watchAssetCard } from "./approval-watch-asset-card";

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
  extra: Readonly<Record<string, string>> = {},
): string =>
  paysLookalike(approval)
    ? `<p class="hint">${th("approval.payment.wontSend")}</p>${denyOnlyRow(approval)}`
    : decisionRow(approval, label, locked, reviewedFee, extra);

// The signing account is identified by its `<network>:<address>` id; the row
// shows the address half truncated and copies it whole.
const contextDetails = (approval: PendingApproval): string => {
  const context = approval.context;
  if (!context) {
    return "";
  }
  const address = accountIdAddress(context.accountId);
  return `<dl class="request-detail"><div><dt>${th("approval.context.account")}</dt><dd><code title="${escapeHtml(address)}">${escapeHtml(accountLabel(address))}</code>${inlineCopyButton(address, t("approval.context.copyAccount"))}</dd></div><div><dt>${th("approval.context.network")}</dt><dd>${escapeHtml(context.networkId)}</dd></div><div><dt>${th("approval.context.digest")}</dt><dd><code>${escapeHtml(context.payloadDigest.slice(0, 23))}…</code></dd></div></dl>`;
};

const contextDisclosure = (approval: PendingApproval): string => {
  const details = contextDetails(approval);
  return details
    ? `<details class="disclosure request-technical">
        <summary>
          <span class="menu-copy"><strong>${th("approval.context.title")}</strong><small>${th("approval.context.subtitle")}</small></span>
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
    ? [t("approval.strk20.linkage")]
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
      ? [t("approval.strk20.depositPayee", { recipient: accountLabel(action.recipient) })]
      : [],
  );
};

const approvalCalls = (approval: PendingApproval): string =>
  reviewCallsList(
    reviewLines(approval.summaries ?? [], approval.summaryTexts),
    approval.reviewAssets ?? [],
  );

// Fixed copy per spam reason (audit 171): the card the user decides on says why
// the token looks wrong, and that the wallet will store it hidden.
// Everything is inlined into the template (template contents are not re-wrapped)
// so the decoded calls and combined risk-flag/insight warnings stay compact.
// The fee section renders through the shared `reviewFeeSection` — the same
// renderer the Send review uses — so the two surfaces cannot drift (issue 189). The
// retry button targets this approval by data attribute. A failed or absent fee
// estimate disables Approve exactly as Send does: without a displayed amount
// there is no fee ceiling for the user's consent to bind.
const gaslessChoiceAllowed = (approval: PendingApproval, status: WalletStatus): boolean =>
  approval.gaslessFees !== undefined &&
  !status.locked &&
  !paysLookalike(approval) &&
  approval.deployFirst !== true &&
  approval.feeEstimatePending !== true &&
  approval.feeEstimateFailed !== true &&
  approval.fee != null;

// The deployment half of the Cost section. A Ledger account signs the
// deployment and the calls separately, so the card says so before the click.
const invokeDeploymentReview = (
  approval: PendingApproval,
  status: WalletStatus,
): Partial<ReviewFeeState> => {
  if (approval.requiresDeployment !== true || approval.deploymentFeeEstimateFailed === undefined) {
    return {};
  }
  const account = status.accounts.find((entry) => entry.id === approval.context?.accountId);
  return {
    ...(approval.deploymentFee ? { deploymentFee: approval.deploymentFee } : {}),
    deploymentFeeEstimateFailed: approval.deploymentFeeEstimateFailed,
    ...(account?.derivation.kind === "ledger" ? { signsTwice: true } : {}),
  };
};

// One "What will happen" section: the decoded calls (or, with none, the plain
// sign-and-submit sentence), then, for a multisig proposal, that it is saved for
// the other signers and not sent yet. Every line is the same consequence.
const invokeOutcome = (approval: PendingApproval, proposal: boolean): string =>
  reviewOutcomeSection(
    (reviewCallItems(
      reviewLines(approval.summaries ?? [], approval.summaryTexts),
      approval.reviewAssets ?? [],
    ) || `<p>${th("approval.invoke.fallback")}</p>`) +
      (proposal ? `<p>${th("approval.invoke.proposal")}</p>` : ""),
  );

const invokeCard = (approval: PendingApproval, status: WalletStatus): string => {
  const offerGasless = gaslessChoiceAllowed(approval, status);
  const proposal = (approval.multisigThreshold ?? 0) > 1;
  return `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("approval.invoke.title"))}
      ${status.locked ? `<p class="hint">${th("approval.invoke.locked")}</p>` : ""}
      ${invokeOutcome(approval, proposal)}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...reviewLines(approval.insights ?? [], approval.insightTexts)])}
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
          ...(offerGasless && approval.gaslessFees ? { gaslessFees: approval.gaslessFees } : {}),
          ...invokeDeploymentReview(approval, status),
          requiresDeployment: approval.requiresDeployment === true,
        },
        { "data-approval-retry-fee": approval.id },
        {
          ...(offerGasless
            ? {
                gaslessAttributes: {
                  "data-approval-action": "approve",
                  "data-approval-id": approval.id,
                  "data-approval-kind": approval.kind,
                },
              }
            : {}),
        },
      ) ||
      reviewCostNote(t("approval.invoke.feeUnavailable"))
    }
    ${invokeCallReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(
      approval,
      proposal ? t("approval.invoke.saveForSigners") : t("approval.approve"),
      // Approve echoes the total the Cost section showed — the same helper the
      // background refusal reads — and is withheld while no total exists.
      status.locked || reviewedInvokeTotal(approval) === null,
      reviewedInvokeTotal(approval) ?? undefined,
      proposal ? { "data-multisig-proposal": "true" } : {},
    )}
  </li>`;
};

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
      ${requestIdentity(approval.origin, t("approval.sign.title"))}
      <p class="hint">${status.locked ? th("approval.sign.locked") : th("approval.sign.hint")}</p>
      ${reviewOutcome(t("approval.sign.outcome"))}
      ${reviewCallsList(reviewLines(approval.summaries ?? [], approval.summaryTexts).slice(1))}
    </div>
    ${view.html}
    ${reviewPanel([
      ...riskFlagMessages(approval.flags ?? []),
      ...(view.classified ? [] : [signRequestUnclassifiedWarning()]),
      ...signRequestWarnings(approval.typedData),
      ...reviewLines(approval.insights ?? [], approval.insightTexts),
    ])}
    ${reviewConstraints(t("approval.sign.constraints"))}
    ${contextDisclosure(approval)}
    ${view.classified ? paymentDecisionRow(approval, t("approval.sign.action"), status.locked) : denyOnlyRow(approval)}
  </li>`;
};

const strk20Card = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("approval.strk20.title"))}
      ${status.locked ? `<p class="hint">${th("approval.strk20.locked")}</p>` : ""}
      ${approvalCalls(approval) || reviewOutcome(t("approval.strk20.outcome"))}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...strk20DepositPayeeWarnings(approval), ...strk20LinkageWarnings(approval), ...reviewLines(approval.insights ?? [], approval.insightTexts)])}
    ${reviewConstraints(t("approval.strk20.constraints"))}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(approval, t("approval.approve"), status.locked)}
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
      ${status.locked ? `<p class="hint">${escapeHtml(copy.lockedHint)}</p>` : ""}
      ${approvalCalls(approval) || reviewOutcome(copy.hint)}
    </div>
    ${reviewPanel([...riskFlagMessages(approval.flags ?? []), ...strk20DepositPayeeWarnings(approval), ...reviewLines(approval.insights ?? [], approval.insightTexts)])}
    ${reviewConstraints(t("approval.disclosure.constraints"))}
    ${strk20ActionReview(approval)}
    ${contextDisclosure(approval)}
    ${paymentDecisionRow(approval, copy.action, status.locked)}
  </li>`;

// A site's private request on a network with no private services for it. The
// site is answered only when the user closes this, so it cannot probe what the
// wallet has set up. One fixed line and a Close control; nothing the site sent
// is shown, and there is nothing to approve — Close works locked too, and the
// panel says it closed rather than narrating a denial (data-approval-notice).
const strk20UnavailableCard = (approval: PendingApproval): string => `
  <li class="request-card" data-approval-notice>
    <div class="request-copy">
      <p>${escapeHtml(
        approval.notice === "other-wallet"
          ? PRIVACY_OTHER_WALLET_ACTION
          : approval.notice === "record-limit"
            ? SHADOW_ACCOUNT_RECORD_LIMIT_NOTICE
            : approval.notice === "request-failed"
              ? PRIVATE_REQUEST_FAILED_NOTICE
              : PRIVATE_SERVICES_UNAVAILABLE_NOTICE,
      )}</p>
    </div>
    <div class="button-row">${denyButton(approval, t("approval.card.close"))}</div>
  </li>`;

const switchCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("approval.switch.title"))}
      <p class="hint">${status.locked ? th("approval.switch.locked") : th("approval.switch.hint")}</p>
      ${approvalCalls(approval) || reviewOutcome(t("approval.switch.outcome"))}
    </div>
    ${reviewPanel(reviewLines(approval.insights ?? [], approval.insightTexts))}
    ${reviewConstraints(t("approval.noFee"))}
    ${decisionRow(approval, t("approval.switch.action"), status.locked)}
  </li>`;

const declareCard = (approval: PendingApproval, status: WalletStatus): string => `
  <li class="request-card">
    <div class="request-copy">
      ${requestIdentity(approval.origin, t("approval.declare.title"))}
      <p class="hint">${status.locked ? th("approval.declare.locked") : th("approval.declare.hint")}</p>
      ${reviewOutcome(t("approval.declare.outcome"))}
    </div>
    ${reviewPanel([...declarationWarnings(approval), ...reviewLines(approval.insights ?? [], approval.insightTexts)], t("approval.declare.clear"))}
    <section class="decision-layer decision-boundary" aria-label="${th("cost.section.cost")}">
      <p class="decision-label">${th("cost.section.cost")}</p>
      ${declarationDetails(approval)}
    </section>
    ${contextDisclosure(approval)}
    ${declarationFeeUnavailable(approval) ? button({ attributes: { "data-approval-retry-fee": approval.id }, disabled: status.locked, icon: "refresh", label: t("cost.fee.retry"), variant: "secondary" }) : ""}
    ${decisionRow(
      approval,
      t("approval.declare.action"),
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
  picker?: ConnectPicker,
): string => {
  switch (approval.kind) {
    case "watch-asset":
      return watchAssetCard(approval, nftsShown(preferences));
    case "invoke":
      return invokeCard(approval, status);
    case "sign-typed-data":
      return signCard(approval, status);
    case "strk20-balances":
      return strk20DisclosureCard(approval, status, {
        action: t("approval.balances.action"),
        // Matched on the background's English line, which is data, not copy.
        hint:
          approval.summaries?.[0] === "Share all private token balances"
            ? t("approval.balances.hintAll")
            : t("approval.balances.hintListed"),
        lockedHint: t("approval.balances.locked"),
        title: t("approval.balances.title"),
      });
    case "strk20-invoke":
      return strk20Card(approval, status);
    case "strk20-prepare":
      return strk20DisclosureCard(approval, status, {
        action: t("approval.prepare.action"),
        hint: t("approval.prepare.hint"),
        lockedHint: t("approval.prepare.locked"),
        title: t("approval.prepare.title"),
      });
    case "strk20-register":
      return strk20DisclosureCard(approval, status, {
        action: t("approval.register.action"),
        hint: t("approval.register.hint"),
        lockedHint: t("approval.register.locked"),
        title: t("approval.register.title"),
      });
    case "strk20-shadow-account":
      return strk20DisclosureCard(approval, status, {
        action: t("approval.shadow.action"),
        hint: t("approval.shadow.hint"),
        lockedHint: t("approval.shadow.locked"),
        title: t("approval.shadow.title"),
      });
    case "strk20-unavailable":
      return strk20UnavailableCard(approval);
    case "switch-chain":
      return switchCard(approval, status);
    case "declare":
      return declareCard(approval, status);
    case "connect":
      return connectCard(approval, status, preferences, picker);
  }
};
