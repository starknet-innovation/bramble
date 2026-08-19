/** Pure stable Argent multisig deployment form. */
import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { inputControl, selectField, textField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigView,
} from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  hardwareBadge,
  noAccountEmpty,
} from "../../shared/parts";
import { qrSvg } from "../../shared/qr";
import { formatFeeEstimate } from "../../shared/review-render";

/**
 * Renders escaped external funding controls from a fresh deployment review.
 * Local controls are cloned from trusted production markup by the binder.
 */
export const deploymentFundingStage = (
  review: ArgentMultisigDeploymentReview,
): string => `<section class="multisig-funding-stage" aria-labelledby="multisig-funding-title">
    <div class="multisig-funding-head">
      <div>
        <h2 id="multisig-funding-title">Fund this multisig</h2>
      </div>
      <span class="multisig-funding-token" aria-label="STRK">STRK</span>
    </div>
    <p class="hint">Send at least ${formatFeeEstimate(review.fee)} to this saved address. You can close this screen and resume safely.</p>
    <div class="multisig-funding-address">
      <div class="qr-card">${qrSvg(review.address, "Multisig funding address")}</div>
      <div class="address-line">
        <code title="${escapeHtml(review.address)}">${escapeHtml(accountLabel(review.address))}</code>
        ${iconButton({ attributes: { "data-copy": review.address }, icon: "copy", label: "Copy multisig funding address" })}
      </div>
    </div>
    ${button({
      attributes: { "data-multisig-check-funding": true },
      label: "Check funding again",
    })}
  </section>`;

const deploymentSignerOption = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  selected: boolean,
  eligible: boolean,
): string => `
  <button class="option-row multisig-deployment-signer" data-deployment-signer="${escapeHtml(account.id)}" data-deployment-signer-key="${escapeHtml(account.publicKeyX)}" type="button" aria-pressed="${selected}"${eligible ? "" : " hidden"}>
    <span class="option-avatar">${accountAvatar(account.address)}</span>
    <span class="option-copy">
      <span class="option-name"><strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>${hardwareBadge(account)}</span>
      <code>${escapeHtml(accountLabel(account.address))}</code>
      <span class="option-sub">${account.accountContractType === "argent" ? "Argent" : "OpenZeppelin"} · Key matches</span>
    </span>
    <span class="option-mark">${icon("check")}</span>
  </button>`;

type SignerKeySource = {
  readonly address: string;
  readonly label: string;
  readonly publicKeyX: string;
  readonly source: string;
};

const signerKeySources = (
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
  deploymentKeys: readonly string[],
): readonly SignerKeySource[] => {
  const seen = new Set<string>();
  return [
    ...accounts.map((candidate) => ({
      address: candidate.address,
      label: accountDisplayName(candidate, preferences),
      publicKeyX: candidate.publicKeyX,
      source: `${candidate.accountContractType === "argent" ? "Argent" : "OpenZeppelin"}${candidate.derivation.kind === "ledger" ? " · Ledger" : ""} account`,
    })),
    ...(preferences?.addressBook
      .filter((entry) => entry.publicKeyX !== undefined)
      .map((entry) => ({
        address: entry.address,
        label: entry.label,
        publicKeyX: entry.publicKeyX ?? "",
        source: "Saved contact",
      })) ?? []),
    ...deploymentKeys.map((publicKeyX) => ({
      address: publicKeyX,
      label: `Signer ${accountLabel(publicKeyX)}`,
      publicKeyX,
      source: "Deployment setup",
    })),
  ].filter(({ publicKeyX }) => {
    if (!publicKeyX || seen.has(publicKeyX)) return false;
    seen.add(publicKeyX);
    return true;
  });
};

const selectedSignerRow = (
  source: SignerKeySource,
  selected: boolean,
  onlySigner: boolean,
): string => `
  <div class="multisig-selected-signer" data-signer-public-key="${escapeHtml(source.publicKeyX)}" role="listitem"${selected ? "" : " hidden"}>
    <span class="option-avatar">${accountAvatar(source.address)}</span>
    <span class="option-copy">
      <strong>${escapeHtml(source.label)}</strong>
      <span class="option-sub">${source.source} · Key ${escapeHtml(accountLabel(source.publicKeyX))}</span>
    </span>
    ${iconButton({
      attributes: { "data-remove-signer-public-key": source.publicKeyX },
      disabled: selected && onlySigner,
      icon: "x",
      label: `Remove ${source.label}`,
      variant: "ghost",
    })}
  </div>`;

const signerKeyOptions = (
  sources: readonly SignerKeySource[],
  selectedPublicKeys: readonly string[],
): string =>
  sources
    .map(
      ({ address, label, publicKeyX, source }) => `
        <button class="option-row multisig-key-source" data-add-signer-public-key="${escapeHtml(publicKeyX)}" type="button"${selectedPublicKeys.some((key) => sameFelt(key, publicKeyX)) ? " hidden" : ""}>
          <span class="option-avatar">${accountAvatar(address)}</span>
          <span class="option-copy">
            <strong>${escapeHtml(label)}</strong>
            <code>${escapeHtml(accountLabel(address))}</code>
            <span class="option-sub">${source} · Key ${escapeHtml(accountLabel(publicKeyX))}</span>
          </span>
          <span class="option-mark">${icon("plus")}</span>
        </button>`,
    )
    .join("");

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
  if (!account) {
    return (
      flowHeader("Deploy Argent multisig", status) +
      flowScreen("multisig-deploy", noAccountEmpty(status))
    );
  }
  const accounts = status.accounts.filter((candidate) => candidate.networkId === status.networkId);
  const savedDeployment =
    selectedMultisig?.deployed === false ? selectedMultisig.record.deployment : undefined;
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
      flowHeader("Deploy Argent multisig", status) +
      flowScreen(
        "multisig-deploy",
        emptyState(
          "The pinned Argent Multisig 0.2 class is not declared on this network. Predeclare the audited class before deployment.",
        ),
      )
    );
  }
  return (
    flowHeader("Deploy Argent multisig", status, "Multiple signers approve together") +
    flowScreen(
      "multisig-deploy",
      `<section class="section multisig-deploy-section">
        <ol class="multisig-deploy-progress" aria-label="Multisig creation progress">
          ${["Signers", "Approval", "Address", "Fund", "Deploy", "Done"]
            .map(
              (label, index) =>
                `<li data-multisig-deploy-step="${index}" data-state="${index === 0 ? "active" : "pending"}"><span>${index + 1}</span><small>${label}</small></li>`,
            )
            .join("")}
        </ol>
        ${
          classState === null
            ? '<p class="hint">Checking the pinned class on this network…</p>'
            : classState === "error"
              ? '<p class="review-flag" role="alert">Class availability could not be verified. Deployment remains disabled.</p>'
              : ""
        }
        <form id="multisig-deploy-form" data-class-ready="${classState === true}" data-deployment-stage="setup">
          <div class="multisig-deploy-stage-frame">
            <div class="multisig-deploy-setup" data-multisig-deploy-setup>
            ${expectedAddress ? `<input name="expectedAddress" type="hidden" value="${escapeHtml(expectedAddress)}" />` : ""}
            <input name="fundingTokenId" type="hidden" value="${escapeHtml(strkToken?.id ?? "")}" />
            <template data-multisig-funding-controls>
              <div class="multisig-funding-local">
                ${selectField({
                  disabled: accounts.length === 0,
                  label: "Fund from",
                  name: "fundingAccountId",
                  options: accounts.map((candidate) => ({
                    label: `${accountDisplayName(candidate, preferences)} · ${candidate.accountContractType === "argent" ? "Argent" : "OpenZeppelin"}${candidate.derivation.kind === "ledger" ? " · Ledger" : ""}`,
                    value: candidate.id,
                  })),
                  selected: account.id,
                })}
                ${button({
                  attributes: { "data-multisig-fund-local": true },
                  disabled: !strkToken || accounts.length === 0,
                  icon: "send",
                  label: "Fund from this wallet",
                })}
              </div>
            </template>
            <div class="multisig-deploy-step-pane multisig-deploy-signers-step" data-multisig-deploy-stage="setup">
              ${
                savedDeployment
                  ? '<p class="hint" role="note">Saved setup restored. Confirm the signers, then continue.</p>'
                  : expectedAddress
                    ? '<p class="hint" role="note">Confirm the original signers. The review will verify that they reproduce the watched address.</p>'
                    : ""
              }
              ${textField({ label: "Shared account name (optional)", maxlength: 48, name: "name", value: selectedMultisig?.record.name ?? "" })}
              <section class="multisig-signer-set" aria-labelledby="multisig-signer-set-title">
            <div class="multisig-signer-set-head">
              <strong id="multisig-signer-set-title">Signer set</strong>
              <span class="hint" data-signer-count>${selectedPublicKeys.length} signer${selectedPublicKeys.length === 1 ? "" : "s"}</span>
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
            <details class="disclosure multisig-signer-sources">
              <summary>
                <span class="menu-copy"><strong>Add signer</strong><small>Choose an identity or enter one public key</small></span>
                <span class="disclosure-mark">${icon("chevronRight")}</span>
              </summary>
              <div class="disclosure-body">
                <div class="option-list" role="group" aria-label="Available signer identities">
                  ${signerKeyOptions(signerSources, selectedPublicKeys)}
                </div>
                <div class="multisig-manual-signer">
                  ${inputControl({
                    ariaLabel: "Signer public key",
                    attributes: { "data-manual-signer-public-key": true },
                    autocapitalize: "none",
                    className: "mono",
                    placeholder: "0x…",
                    spellcheck: false,
                  })}
                  ${button({
                    attributes: { "data-add-manual-signer": true },
                    icon: "plus",
                    label: "Add key",
                    size: "small",
                    variant: "secondary",
                  })}
                </div>
                <p class="hint">Save frequent co-signers in Address book to select them by identity next time.</p>
                <p class="multisig-manual-signer-result" data-manual-signer-result role="status"></p>
              </div>
            </details>
            <template data-manual-signer-template>
              <div class="multisig-selected-signer" data-manual-signer role="listitem">
                <span class="option-avatar">${icon("user")}</span>
                <span class="option-copy"><strong>Manual signer</strong><span class="option-sub" data-manual-signer-label></span></span>
                ${iconButton({
                  attributes: { "data-remove-signer-public-key": true },
                  icon: "x",
                  label: "Remove manual signer",
                  variant: "ghost",
                })}
              </div>
            </template>
              </section>
              ${button({ attributes: { "data-multisig-deploy-continue": true }, disabled: !deploymentSigner, label: "Continue to approval" })}
              <p class="multisig-manual-signer-result" data-deployment-signer-status role="status">${deploymentSigner ? "" : "Add an account from this wallet to the signer set before continuing."}</p>
            </div>
            <div class="multisig-deploy-step-pane multisig-deploy-approval-step" data-multisig-deploy-stage="approval">
              ${
                savedDeployment && !deploymentSigner
                  ? '<p class="review-flag" role="alert">None of this wallet\'s accounts is a saved deployment signer. Import one before deploying.</p>'
                  : ""
              }
              ${textField({
                hint: "How many signers must approve each transaction?",
                inputmode: "numeric",
                label: "Signatures required",
                max: selectedPublicKeys.length,
                min: 1,
                name: "threshold",
                required: true,
                type: "number",
                value: String(savedDeployment?.threshold ?? 1),
              })}
              <div class="multisig-deployment-signer-field" role="group" aria-label="Deployment signer">
                <span class="context-label">Deployment signer</span>
                <input name="signerAccountId" type="hidden" value="${escapeHtml(deploymentSigner?.id ?? "")}" />
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
                <span class="hint">This account signs and pays for deployment.</span>
              </div>
              <details class="disclosure multisig-deploy-advanced">
                <summary><span class="menu-copy"><strong>Advanced deployment settings</strong><small>Default salt · 0x0</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  ${textField({ className: "mono", label: "Deployment salt", name: "salt", required: true, spellcheck: false, value: savedDeployment?.salt ?? "0x0" })}
                </div>
              </details>
            </div>
            </div>
            <div id="multisig-deploy-review" aria-live="polite"></div>
            <div class="multisig-deploy-actions">
              ${button({ attributes: { "data-multisig-deploy-back": true }, label: "Back", variant: "secondary" })}
              ${button({ disabled: classState !== true || !deploymentSigner, label: "Review deployment", type: "submit" })}
            </div>
            <p id="multisig-deploy-result" role="status"></p>
          </div>
        </form>
      </section>`,
    )
  );
};
