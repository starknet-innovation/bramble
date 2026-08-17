/** Pure stable Argent multisig deployment form. */
import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { inputControl, textField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
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

const deploymentSignerOption = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  selected: boolean,
): string => `
  <button class="option-row multisig-deployment-signer" data-deployment-signer="${escapeHtml(account.id)}" type="button" aria-pressed="${selected}">
    <span class="option-avatar">${accountAvatar(account.address)}</span>
    <span class="option-copy">
      <span class="option-name"><strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>${hardwareBadge(account)}</span>
      <code>${escapeHtml(accountLabel(account.address))}</code>
    </span>
    <span class="option-mark">${icon("check")}</span>
  </button>`;

type SignerKeySource = {
  readonly address: string;
  readonly label: string;
  readonly publicKeyX: string;
  readonly source: "Deployment setup" | "Saved contact" | "Wallet account";
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
      source: "Wallet account" as const,
    })),
    ...(preferences?.addressBook
      .filter((entry) => entry.publicKeyX !== undefined)
      .map((entry) => ({
        address: entry.address,
        label: entry.label,
        publicKeyX: entry.publicKeyX ?? "",
        source: "Saved contact" as const,
      })) ?? []),
    ...deploymentKeys.map((publicKeyX) => ({
      address: publicKeyX,
      label: `Signer ${accountLabel(publicKeyX)}`,
      publicKeyX,
      source: "Deployment setup" as const,
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
  const deploymentSigner = savedDeployment
    ? accounts.find((candidate) =>
        savedDeployment.signerPublicKeys.some((key) => sameFelt(key, candidate.publicKeyX)),
      )
    : account;
  const signerSources = signerKeySources(accounts, preferences, selectedPublicKeys);
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
    flowHeader("Deploy Argent multisig", status, "True M-of-N signatures") +
    flowScreen(
      "multisig-deploy",
      `<section class="section multisig-deploy-section">
        ${receipt(
          [
            { label: "Contract", value: `Argent Multisig ${ARGENT_MULTISIG_CONTRACT.version}` },
            {
              action: {
                attributes: { "data-copy": ARGENT_MULTISIG_CONTRACT.classHash },
                icon: "copy",
                label: "Copy class hash",
              },
              label: "Class hash",
              value: accountLabel(ARGENT_MULTISIG_CONTRACT.classHash),
              valueStyle: "code",
            },
            { label: "Network", value: status.network },
            ...(expectedAddress
              ? [
                  {
                    action: {
                      attributes: { "data-copy": expectedAddress },
                      icon: "copy" as const,
                      label: "Copy watched address",
                    },
                    label: "Watched address",
                    value: accountLabel(expectedAddress),
                    valueStyle: "code" as const,
                  },
                ]
              : []),
          ],
          { "data-multisig-deploy-summary": true },
        )}
        ${
          classState === null
            ? '<p class="hint">Checking the pinned class on this network…</p>'
            : classState === "error"
              ? '<p class="review-flag" role="alert">Class availability could not be verified. Deployment remains disabled.</p>'
              : ""
        }
        ${
          savedDeployment
            ? '<p class="review-flag" role="note">Deployment required. The saved signer set, threshold, and salt are restored below.</p>'
            : expectedAddress
              ? '<p class="review-flag" role="note">Deployment required. Enter the original signer set, threshold, and salt; review will verify that they reproduce the watched address.</p>'
              : ""
        }
        ${
          savedDeployment && !deploymentSigner
            ? '<p class="review-flag" role="alert">None of this wallet\'s accounts is a saved deployment signer. Import one before deploying.</p>'
            : ""
        }
        <form id="multisig-deploy-form">
          ${expectedAddress ? `<input name="expectedAddress" type="hidden" value="${escapeHtml(expectedAddress)}" />` : ""}
          ${textField({ label: "Name (optional)", maxlength: 48, name: "name", value: selectedMultisig?.record.name ?? "" })}
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
          ${textField({ inputmode: "numeric", label: "Signatures required", name: "threshold", required: true, value: String(savedDeployment?.threshold ?? 1) })}
          ${textField({ className: "mono", label: "Deployment salt", name: "salt", required: true, spellcheck: false, value: savedDeployment?.salt ?? "0x0" })}
          <div class="multisig-deployment-signer-field" role="group" aria-label="Deployment signer">
            <span class="context-label">Deployment signer</span>
            <input name="signerAccountId" type="hidden" value="${escapeHtml(deploymentSigner?.id ?? "")}" />
            <div class="option-list">
              ${accounts.map((candidate) => deploymentSignerOption(candidate, preferences, candidate.id === deploymentSigner?.id)).join("")}
            </div>
            <span class="hint">Must match a signer key and authorizes this deployment only.</span>
          </div>
          <div id="multisig-deploy-review" aria-live="polite"></div>
          ${button({ disabled: classState !== true || !deploymentSigner, label: "Review deployment", type: "submit" })}
          <p id="multisig-deploy-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};
