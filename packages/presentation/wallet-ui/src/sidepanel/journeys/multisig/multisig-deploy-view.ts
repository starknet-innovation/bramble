/** Pure stable Argent multisig deployment form. */
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { selectField, textField } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigView,
} from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountFamilyName,
  accountLabel,
  copyButton,
  flowHeader,
  flowScreen,
  hardwareBadge,
  inlineCopyButton,
  noAccountEmpty,
} from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import {
  formatFeeEstimate,
  friAtLeast,
  friShownAtLeast,
  reviewCostNote,
  reviewOutcome,
  reviewPanel,
} from "../../shared/review-render";
import { type MultisigParticipantOption, multisigParticipantScreen } from "./multisig-participant";

/**
 * User decisions shown in the multisig creation progress indicator.
 */
export const MULTISIG_CREATION_STEPS = [
  ["participants", "Participants"],
  ["approval", "Approval"],
  ["fund", "Fund"],
  ["deploy", "Deploy"],
] as const;

/** The signer-set count line, shared by the form and its live binding. */
export const signerCountText = (count: number): string =>
  t(count === 1 ? "multisig.deploy.signerCountOne" : "multisig.deploy.signerCountMany", {
    count: String(count),
  });

/**
 * The least STRK the predicted address must hold before deployment, in exact
 * FRI: the reviewed fee rounded up to the precision the Fund step prints.
 * Null when the fee is not a readable FRI amount, so nothing is prefilled
 * from a figure the wallet cannot state exactly.
 */
export const deploymentFundingMinimum = (review: ArgentMultisigDeploymentReview): bigint | null => {
  if (review.fee.unit !== "FRI") return null;
  try {
    const fee = BigInt(review.fee.overallFee);
    return fee < 0n ? null : friShownAtLeast(fee);
  } catch {
    return null;
  }
};

/**
 * The funding minimum as the Fund step and its recovery toast print it. One
 * formatter for both, so the same figure never reads two ways.
 */
export const deploymentFundingMinimumText = (review: ArgentMultisigDeploymentReview): string => {
  const minimum = deploymentFundingMinimum(review);
  return minimum === null ? formatFeeEstimate(review.fee) : friAtLeast(minimum);
};

/**
 * Renders escaped external funding controls from a fresh deployment review.
 * Local controls are cloned from trusted production markup by the binder.
 */
export const deploymentFundingStage = (
  review: ArgentMultisigDeploymentReview,
): string => `<section class="multisig-funding-stage" aria-labelledby="multisig-funding-title">
    <div class="multisig-funding-head">
      <div>
        <h2 id="multisig-funding-title">${th("multisig.fund.title")}</h2>
      </div>
      <span class="multisig-funding-token" aria-label="STRK">STRK</span>
    </div>
    <p class="hint">${th("multisig.fund.sendAtLeast", { minimum: deploymentFundingMinimumText(review) })}</p>
    <div class="multisig-funding-address">
      <div class="qr-card">${qrSvg(review.address, t("multisig.fund.qrLabel"))}</div>
      <div class="address-line">
        <code title="${escapeHtml(review.address)}">${escapeHtml(accountLabel(review.address))}</code>
        ${iconButton({ attributes: { "data-copy": review.address }, icon: "copy", label: t("multisig.fund.copyAddress") })}
      </div>
    </div>
    ${button({
      attributes: { "data-multisig-check-funding": true },
      label: t("multisig.fund.check"),
      variant: "secondary",
    })}
  </section>`;

/**
 * Renders the reviewed deployment: the outcome line, the predicted address, the
 * irreversible-authority consequences, the fee ceiling, and the exact
 * constructor. Shared by the live approval quote and the submit path so both
 * paint the same review.
 */
export const deploymentReviewMarkup = (review: ArgentMultisigDeploymentReview): string =>
  `${reviewOutcome(`Deploy a ${review.threshold}-of-${review.signerPublicKeys.length} Ready multisig.`)}
    <div class="multisig-deployment-target" aria-label="Predicted multisig address">
      <span>Predicted address</span>
      <code title="${escapeHtml(review.address)}">${escapeHtml(accountLabel(review.address))}</code>
      ${copyButton(review.address, "Copy predicted multisig address")}
    </div>
    ${reviewPanel([], "Deployment creates a new on-chain multisig account. Its address, signer set, threshold, and salt cannot be edited after this submission.")}
    ${reviewCostNote(`Maximum network fee: ${formatFeeEstimate(review.fee)}`)}
    <details class="disclosure" data-disclosure="multisig-deployment-technical">
      <summary>
        <span class="menu-copy"><strong>Technical details</strong><small>Exact constructor authority and signer</small></span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        <dl class="request-detail">
          <div><dt>Address</dt><dd><code>${escapeHtml(review.address)}</code>${copyButton(review.address, "Copy multisig address")}</dd></div>
          <div><dt>Contract</dt><dd>Ready Multisig ${ARGENT_MULTISIG_CONTRACT.version}</dd></div>
          <div><dt>Class hash</dt><dd><code>${escapeHtml(ARGENT_MULTISIG_CONTRACT.classHash)}</code>${copyButton(ARGENT_MULTISIG_CONTRACT.classHash, "Copy Ready Multisig class hash")}</dd></div>
          <div><dt>Network</dt><dd><code>${escapeHtml(review.networkId)}</code></dd></div>
          <div><dt>Signers</dt><dd>${review.signerPublicKeys.length}</dd></div>
          <div><dt>Public keys</dt><dd><code>${escapeHtml(review.signerPublicKeys.join(" "))}</code></dd></div>
          <div><dt>Threshold</dt><dd>${review.threshold}</dd></div>
          <div><dt>Salt</dt><dd><code>${escapeHtml(review.salt)}</code></dd></div>
          <div><dt>Deployment signer</dt><dd><code>${escapeHtml(review.signerAccountId)}</code></dd></div>
        </dl>
      </div>
    </details>`;

/**
 * Renders the receipt for a submitted deployment: the escaped address and
 * transaction hash, the way into the saved account, and an explorer link when
 * the network has one. Submitted is not confirmed; the copy says so.
 */
export const deploymentSubmittedMarkup = (
  result: {
    readonly address: string;
    readonly multisig: ArgentMultisigView;
    readonly transactionHash: string;
  },
  explorer: string | null,
): string => `<section class="multisig-deployment-success" role="status" aria-live="polite">
                <span class="multisig-deployment-success-mark">${icon("check")}</span>
                <div><p class="context-label">${th("multisig.deployed.submitted")}</p><h2>${th("multisig.deployed.inProgress")}</h2></div>
                <p>${th("multisig.deployed.saved")}</p>
                <dl class="request-detail">
                  <div><dt>${th("multisig.signers.address")}</dt><dd><code>${escapeHtml(accountLabel(result.address))}</code>${copyButton(result.address, t("multisig.signers.copyAddress"))}</dd></div>
                  <div><dt>${th("multisig.deployed.transaction")}</dt><dd><code>${escapeHtml(accountLabel(result.transactionHash))}</code>${copyButton(result.transactionHash, t("multisig.deployed.copyHash"))}</dd></div>
                </dl>
                <div class="multisig-deployment-success-actions">
                  ${button({ attributes: { "data-open-deployed-multisig": result.multisig.record.id }, label: t("multisig.deployed.open") })}
                  ${explorer ? `<a class="button secondary" href="${escapeHtml(explorer)}" target="_blank" rel="noopener noreferrer">${th("multisig.deployed.view")}</a>` : ""}
                </div>
              </section>`;

const deploymentSignerCopy = (
  account: AccountRef,
  preferences: WalletPreferences | null,
): string => `<span class="option-name"><strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>${hardwareBadge(account)}</span>
    <code>${escapeHtml(accountLabel(account.address))}</code>
    <span class="option-sub">${escapeHtml(accountFamilyName(account.accountContractType))} · ${th("multisig.deploy.keyMatches")}</span>`;

const deploymentSignerIdentity = (
  account: AccountRef,
  preferences: WalletPreferences | null,
): string => `
    <span class="option-avatar">${accountAvatar(account.address)}</span>
    <span class="option-copy">${deploymentSignerCopy(account, preferences)}</span>`;

const deploymentSignerOption = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  selected: boolean,
  eligible: boolean,
): string => `
  <button class="option-row multisig-deployment-signer" data-deployment-signer="${escapeHtml(account.id)}" data-deployment-signer-key="${escapeHtml(account.publicKeyX)}" type="button" aria-pressed="${selected}"${eligible ? "" : " hidden"}>
    ${deploymentSignerIdentity(account, preferences)}
    <span class="option-mark">${icon("check")}</span>
  </button>`;

const signerKeySources = (
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
  deploymentKeys: readonly string[],
): readonly MultisigParticipantOption[] => {
  const seen = new Set<string>();
  return [
    ...accounts.map((candidate) => ({
      address: candidate.address,
      label: accountDisplayName(candidate, preferences),
      publicKeyX: candidate.publicKeyX,
      source: t("multisig.participant.familyAccount", {
        family: `${accountFamilyName(candidate.accountContractType)}${candidate.derivation.kind === "ledger" ? " · Ledger" : ""}`,
      }),
    })),
    ...(preferences?.addressBook
      .filter((entry) => entry.publicKeyX !== undefined)
      .map((entry) => ({
        address: entry.address,
        label: entry.label,
        publicKeyX: entry.publicKeyX ?? "",
        source: t("multisig.participant.savedContact"),
      })) ?? []),
    ...deploymentKeys.map((publicKeyX) => ({
      address: publicKeyX,
      label: t("multisig.participant.signerLabel", { key: accountLabel(publicKeyX) }),
      publicKeyX,
      source: t("multisig.participant.deploymentSetup"),
    })),
  ].filter(({ publicKeyX }) => {
    if (!publicKeyX || seen.has(publicKeyX)) return false;
    seen.add(publicKeyX);
    return true;
  });
};

const selectedSignerRow = (
  source: MultisigParticipantOption,
  selected: boolean,
  onlySigner: boolean,
): string => `
  <div class="multisig-selected-signer" data-signer-public-key="${escapeHtml(source.publicKeyX)}" role="listitem"${selected ? "" : " hidden"}>
    <span class="option-avatar">${accountAvatar(source.address)}</span>
    <span class="option-copy">
      <strong>${escapeHtml(source.label)}</strong>
      <span class="option-sub" title="${escapeHtml(source.publicKeyX)}">${escapeHtml(source.source)} · ${th("multisig.participant.key", { key: accountLabel(source.publicKeyX) })}</span>
    </span>
    ${inlineCopyButton(source.publicKeyX, t("multisig.signers.copyKey", { name: source.label }))}
    ${iconButton({
      attributes: { "data-remove-signer-public-key": source.publicKeyX },
      disabled: selected && onlySigner,
      icon: "x",
      label: t("multisig.deploy.remove", { name: source.label }),
      variant: "ghost",
    })}
  </div>`;

/**
 * Renders exact constructor input and an explicit local deployment signer.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  classState: boolean | "error" | null,
  preferences: WalletPreferences | null = null,
  selectedMultisig: ArgentMultisigView | null = null,
): string => {
  const flowTitle =
    selectedMultisig?.deployed === false
      ? t("multisig.deploy.completeTitle")
      : t("multisig.list.create");
  if (!account) {
    return flowHeader(flowTitle, status) + flowScreen("multisig-deploy", noAccountEmpty(status));
  }
  const accounts = status.accounts.filter((candidate) => candidate.networkId === status.networkId);
  // Braavos stays out of the funding list: whether this wallet can sign for
  // one (no active 2FA, wallet key as first stark signer) is only known from a
  // live read at submission, so it is not offered as a funding source here.
  const fundingAccounts = accounts.filter(
    (candidate) => candidate.accountContractType !== "braavos",
  );
  const fundingAccount =
    fundingAccounts.find((candidate) => candidate.id === account.id) ?? fundingAccounts[0];
  const savedDeployment =
    selectedMultisig?.deployed === false ? selectedMultisig.record.deployment : undefined;
  const initialStage = savedDeployment ? "approval" : "participants";
  const initialStageIndex = MULTISIG_CREATION_STEPS.findIndex(([stage]) => stage === initialStage);
  const expectedAddress =
    selectedMultisig?.deployed === false ? selectedMultisig.record.address : undefined;
  const selectedPublicKeys = savedDeployment?.signerPublicKeys ?? [account.publicKeyX];
  const eligibleAccounts = accounts.filter((candidate) =>
    selectedPublicKeys.some((key) => sameFelt(key, candidate.publicKeyX)),
  );
  const deploymentSigner = savedDeployment ? eligibleAccounts[0] : account;
  const signerSources = signerKeySources(accounts, preferences, selectedPublicKeys);
  const strkToken = preferences?.tokens.find(
    (token) => token.networkId === status.networkId && sameFelt(token.address, STRK_TOKEN_ADDRESS),
  );
  if (classState === false) {
    return (
      flowHeader(flowTitle, status) +
      flowScreen("multisig-deploy", emptyState(t("multisig.deploy.classMissing")))
    );
  }
  return (
    flowHeader(flowTitle, status, t("multisig.add.subtitle")) +
    flowScreen(
      "multisig-deploy",
      `<section class="section multisig-deploy-section">
        <ol class="multisig-deploy-progress" aria-label="${th("multisig.deploy.progress")}">
          ${MULTISIG_CREATION_STEPS.map(([stage], index) => {
            const state =
              index < initialStageIndex
                ? "complete"
                : index === initialStageIndex
                  ? "active"
                  : "pending";
            return `<li data-multisig-deploy-step="${index}" data-stage="${stage}" data-state="${state}"${index === initialStageIndex ? ' aria-current="step"' : ""}><span>${index + 1}</span><small>${th(`multisig.step.${stage}`)}</small></li>`;
          }).join("")}
        </ol>
        ${
          classState === null
            ? `<p class="hint">${th("multisig.deploy.checkingClass")}</p>`
            : classState === "error"
              ? `<p class="review-flag" role="alert">${th("multisig.deploy.classUnverified")}</p>`
              : ""
        }
        <form id="multisig-deploy-form" data-class-ready="${classState === true}" data-deployment-stage="${initialStage}">
          <div class="multisig-deploy-stage-frame">
            <div class="multisig-deploy-setup" data-multisig-deploy-setup>
            ${expectedAddress ? `<input name="expectedAddress" type="hidden" value="${escapeHtml(expectedAddress)}" />` : ""}
            <input name="fundingTokenId" type="hidden" value="${escapeHtml(strkToken?.id ?? "")}" />
            <template data-multisig-funding-controls>
              <div class="multisig-funding-local">
                ${selectField({
                  disabled: fundingAccounts.length === 0,
                  label: t("multisig.fund.from"),
                  name: "fundingAccountId",
                  options: fundingAccounts.map((candidate) => ({
                    label: `${accountDisplayName(candidate, preferences)} · ${accountFamilyName(candidate.accountContractType)}${candidate.derivation.kind === "ledger" ? " · Ledger" : ""}`,
                    value: candidate.id,
                  })),
                  ...(fundingAccount ? { selected: fundingAccount.id } : {}),
                })}
                ${button({
                  attributes: { "data-multisig-fund-local": true },
                  disabled: !strkToken || fundingAccounts.length === 0,
                  icon: "send",
                  label: t("multisig.fund.fromWallet"),
                })}
              </div>
            </template>
            <div class="multisig-deploy-step-pane multisig-deploy-signers-step" data-multisig-deploy-stage="participants">
              <div data-participant-origin>
              ${
                savedDeployment
                  ? `<p class="hint" role="note">${th("multisig.deploy.restored")}</p>`
                  : expectedAddress
                    ? `<p class="hint" role="note">${th("multisig.deploy.confirmOriginal")}</p>`
                    : ""
              }
              ${textField({ label: t("multisig.deploy.name"), maxlength: 48, name: "name", value: selectedMultisig?.record.name ?? "" })}
              <section class="multisig-signer-set" aria-labelledby="multisig-signer-set-title">
            <div class="multisig-signer-set-head">
              <strong id="multisig-signer-set-title">${th("multisig.deploy.signerSet")}</strong>
              <span class="hint" data-signer-count>${escapeHtml(signerCountText(selectedPublicKeys.length))}</span>
            </div>
            <input name="signerPublicKeys" type="hidden" value="${escapeHtml(selectedPublicKeys.join(" "))}" />
            <div class="multisig-selected-signers" data-selected-signers role="list" aria-live="polite">
              ${signerSources
                .map((source) =>
                  selectedSignerRow(
                    source,
                    selectedPublicKeys.some((key) => sameFelt(key, source.publicKeyX)),
                    selectedPublicKeys.length === 1,
                  ),
                )
                .join("")}
            </div>
            ${button({ attributes: { "data-open-participant-picker": true }, icon: "plus", label: t("multisig.signers.addParticipant"), variant: "secondary" })}
            <template data-manual-signer-template>
              <div class="multisig-selected-signer" data-manual-signer role="listitem">
                <span class="option-avatar">${icon("user")}</span>
                <span class="option-copy"><strong data-manual-signer-name>${th("multisig.deploy.participant")}</strong><span class="option-sub" data-manual-signer-label></span></span>
                ${inlineCopyButton("", t("multisig.participant.copyAddress"), { "data-manual-signer-copy": true, hidden: true })}
                ${iconButton({
                  attributes: { "data-remove-signer-public-key": true },
                  icon: "x",
                  label: t("multisig.deploy.removeManual"),
                  variant: "ghost",
                })}
              </div>
            </template>
              </section>
              ${button({ attributes: { "data-multisig-deploy-continue": true }, disabled: !deploymentSigner, label: t("multisig.deploy.continue") })}
              <p class="multisig-manual-signer-result" data-deployment-signer-status role="status">${deploymentSigner ? "" : th("multisig.deploy.addLocalSigner")}</p>
              </div>
              ${multisigParticipantScreen(status.networkId, signerSources)}
            </div>
            <div class="multisig-deploy-step-pane multisig-deploy-approval-step" data-multisig-deploy-stage="approval">
              ${
                savedDeployment && !deploymentSigner
                  ? `<p class="review-flag" role="alert">${th("multisig.deploy.noSavedSigner")}</p>`
                  : ""
              }
              ${textField({
                hint: t("multisig.deploy.thresholdHint"),
                inputmode: "numeric",
                label: t("multisig.deploy.threshold"),
                max: selectedPublicKeys.length,
                min: 1,
                name: "threshold",
                required: true,
                type: "number",
                value: String(savedDeployment?.threshold ?? 1),
              })}
              <div class="multisig-deployment-signer-field" role="group" aria-label="${th("multisig.deploy.signer")}">
                <span class="context-label">${th("multisig.deploy.signer")}</span>
                <input name="signerAccountId" type="hidden" value="${escapeHtml(deploymentSigner?.id ?? "")}" />
                <details class="disclosure multisig-deployment-signer-picker" data-deployment-signer-picker>
                  <summary>
                    <span class="option-avatar" data-deployment-signer-current-avatar${deploymentSigner ? "" : " hidden"}>${deploymentSigner ? accountAvatar(deploymentSigner.address) : ""}</span>
                    <span class="option-copy" data-deployment-signer-current-copy>${deploymentSigner ? deploymentSignerCopy(deploymentSigner, preferences) : `<strong>${th("multisig.deploy.noLocalSigner")}</strong>`}</span>
                    <span class="disclosure-mark">${icon("chevronRight")}</span>
                  </summary>
                  <div class="disclosure-body">
                    <div class="option-list">
                      ${accounts
                        .map((candidate) =>
                          deploymentSignerOption(
                            candidate,
                            preferences,
                            candidate.id === deploymentSigner?.id,
                            eligibleAccounts.some((eligible) => eligible.id === candidate.id),
                          ),
                        )
                        .join("")}
                    </div>
                  </div>
                </details>
                <span class="hint">${th("multisig.deploy.signerHint")}</span>
              </div>
              <details class="disclosure multisig-deploy-advanced">
                <summary><span class="menu-copy"><strong>${th("multisig.deploy.advanced")}</strong><small>${th("multisig.deploy.defaultSalt")}</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  ${textField({ className: "mono", label: t("multisig.deploy.salt"), name: "salt", required: true, spellcheck: false, value: savedDeployment?.salt ?? "0x0" })}
                </div>
              </details>
            </div>
            </div>
            <div id="multisig-deploy-review" aria-live="polite"></div>
            <div class="multisig-deploy-actions">
              ${button({ disabled: classState !== true || !deploymentSigner, label: "Check fee and address", type: "submit" })}
            </div>
            <p id="multisig-deploy-result" role="status"></p>
          </div>
        </form>
      </section>`,
    )
  );
};
