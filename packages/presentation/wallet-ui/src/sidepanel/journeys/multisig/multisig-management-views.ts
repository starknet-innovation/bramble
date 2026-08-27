/** Focused add, signer, receive, and intent-import screens for Argent multisig. */
import { escapeHtml } from "@mc-wallet/core/html";
import { canSignArgentMultisig } from "@mc-wallet/multisig/signer-account";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField, textField } from "@mc-wallet/ui-kit/fields";
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
  noAccountEmpty,
} from "../../shared/parts";
import { accountContractLabel } from "../../shell/account-types";
import { receiveAddressView } from "../send/receive-view";
import { type MultisigParticipantOption, multisigParticipantScreen } from "./multisig-participant";
import { multisigDisplayName } from "./multisig-views";

const argentMultisigContractLabel = (): string =>
  `Argent Multisig ${ARGENT_MULTISIG_CONTRACT.version}`;

type SignerIdentity = {
  readonly address: string;
  readonly detail: string;
  readonly label: string;
  readonly publicKey: string;
};

const unsupportedSignerLabel = (
  type: ArgentMultisigView["unsupportedSigners"][number]["type"],
): string =>
  ({
    eip191: "EIP-191 signer",
    secp256k1: "Secp256k1 signer",
    secp256r1: "Secp256r1 signer",
    webauthn: "Passkey signer",
  })[type];

const authorityFailureMessage = (status: ArgentMultisigView["authorityStatus"]): string =>
  ({
    available: "Current signer authority is unavailable.",
    "invalid-config": "This account returned an invalid signer configuration. Signing is disabled.",
    "network-unavailable": "Signer authority could not be refreshed. Check the network and retry.",
    undeployed: "This account is not deployed yet. Complete deployment before managing signers.",
    "unsupported-class": "This address is not the pinned Argent Multisig 0.2 account.",
    "unsupported-signers": "This account includes signer types this wallet cannot manage.",
  })[status];

const signerIdentities = (
  publicKeys: readonly string[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
): readonly SignerIdentity[] =>
  publicKeys.map((publicKey) => {
    const account = status.accounts.find((candidate) => sameFelt(candidate.publicKeyX, publicKey));
    if (account) {
      const contract = accountContractLabel(account.accountContractType);
      return {
        address: account.address,
        detail: `${contract}${account.derivation.kind === "ledger" ? " · Ledger" : ""} · Key ${accountLabel(publicKey)}`,
        label: accountDisplayName(account, preferences),
        publicKey,
      };
    }
    const contact = preferences?.addressBook.find((entry) =>
      entry.publicKeyX ? sameFelt(entry.publicKeyX, publicKey) : false,
    );
    return contact
      ? {
          address: contact.address,
          detail: `Address book · Key ${accountLabel(publicKey)}`,
          label: contact.label,
          publicKey,
        }
      : {
          address: publicKey,
          detail: `Signer key ${accountLabel(publicKey)}`,
          label: "External signer",
          publicKey,
        };
  });

const availableSignerParticipants = (
  currentKeys: readonly string[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
): readonly MultisigParticipantOption[] => [
  ...status.accounts
    .filter(
      (account) =>
        account.networkId === status.networkId &&
        canSignArgentMultisig(account) &&
        !currentKeys.some((key) => sameFelt(key, account.publicKeyX)),
    )
    .map((account) => ({
      address: account.address,
      label: `${accountDisplayName(account, preferences)} · ${accountContractLabel(account.accountContractType)}${account.derivation.kind === "ledger" ? " · Ledger" : ""}`,
      publicKeyX: account.publicKeyX,
      source: "Wallet account",
    })),
  ...(preferences?.addressBook
    .filter(
      (entry) =>
        entry.networkId === status.networkId &&
        entry.publicKeyX !== undefined &&
        !currentKeys.some((key) => sameFelt(key, entry.publicKeyX ?? "")),
    )
    .map((entry) => ({
      address: entry.address,
      label: entry.label,
      publicKeyX: entry.publicKeyX ?? "",
      source: "Saved contact",
    })) ?? []),
];

const availableSignerOptions = (participants: readonly MultisigParticipantOption[]) => [
  { label: "Enter a public key", value: "" },
  ...participants.map(({ label, publicKeyX, source }) => ({
    label: `${label} · ${source}`,
    value: publicKeyX,
  })),
];

const thresholdOptions = (count: number, current: number) =>
  Array.from({ length: count }, (_, index) => index + 1).map((value) => ({
    label: `${value} of ${count}`,
    value: String(value),
    ...(value === current ? { disabled: true } : {}),
  }));

const setupOption = (
  view: "multisig-deploy" | "multisig-watch",
  iconName: "search" | "users",
  label: string,
  supportingText: string,
): string => `
  <button class="add-account-option multisig-setup-option" data-view="${view}" type="button">
    <span class="add-account-option-icon">${icon(iconName)}</span>
    <span class="add-account-option-copy"><strong>${label}</strong><span>${supportingText}</span></span>
    <span class="menu-chevron">${icon("chevronRight")}</span>
  </button>`;

/**
 * Renders the shared-account gateway without mutating chain state.
 */
export const multisigAddFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Argent Multisig", status, "Multiple signers approve together") +
  flowScreen(
    "multisig-add",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <div class="multisig-setup-options" role="group" aria-label="Argent multisig setup">
        ${setupOption("multisig-deploy", "users", "Create a multisig", "Set participants, fund, and deploy.")}
        ${setupOption("multisig-watch", "search", "Add a shared address", "Sync it or resume setup.")}
      </div>
    </section>`,
  );

/**
 * Renders address-only discovery; authority is read from chain and matched locally.
 */
export const multisigWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Add shared account", status, "Sync or resume an Argent multisig") +
  flowScreen(
    "multisig-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="multisig-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before use.",
          label: "Multisig address",
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({ disabled: account === null, label: "Add shared account", type: "submit" })}
        <p id="multisig-add-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders fresh signer GUID authority, never stale setup claims.
 */
export const multisigSignersFlow = (
  status: WalletStatus,
  _account: AccountRef | null,
  view: ArgentMultisigView | null,
  preferences: WalletPreferences | null = null,
): string => {
  if (!view) {
    return (
      flowHeader("Signers", status) +
      flowScreen("multisig-signers", emptyState("This Argent multisig is no longer watched."))
    );
  }
  const { record, config } = view;
  const stored = record.currentConfig;
  const completeConfig =
    config !== null &&
    stored !== undefined &&
    stored.threshold === config.threshold &&
    stored.signerPublicKeys.length === config.signerGuids.length &&
    stored.signerPublicKeys.every((key, index) =>
      sameFelt(argentSignerGuid(key), config.signerGuids[index] ?? ""),
    )
      ? stored
      : null;
  const identities = signerIdentities(completeConfig?.signerPublicKeys ?? [], status, preferences);
  const recoverySigners =
    config?.signerGuids.map((guid) => {
      const unsupported = view.unsupportedSigners.find((signer) => sameFelt(signer.guid, guid));
      const account = status.accounts.find(
        (candidate) =>
          candidate.networkId === record.networkId &&
          sameFelt(argentSignerGuid(candidate.publicKeyX), guid),
      );
      const contact = preferences?.addressBook.find(
        (candidate) =>
          candidate.networkId === record.networkId &&
          candidate.publicKeyX !== undefined &&
          sameFelt(argentSignerGuid(candidate.publicKeyX), guid),
      );
      const publicKey = account?.publicKeyX ?? contact?.publicKeyX;
      const identity = publicKey
        ? signerIdentities([publicKey], status, preferences)[0]
        : undefined;
      return { identity, publicKey, unsupported };
    }) ?? [];
  const unresolvedSignerCount = recoverySigners.filter(
    (signer) => !signer.publicKey && !signer.unsupported,
  ).length;
  const participantOptions = availableSignerParticipants(
    completeConfig?.signerPublicKeys ?? [],
    status,
    preferences,
  );
  const candidates = availableSignerOptions(participantOptions);
  return (
    flowHeader("Signers", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-signers",
      `<div data-participant-origin>
      <section class="section multisig-authority-summary">
        ${receipt([
          { label: "Contract", value: argentMultisigContractLabel() },
          { label: "Address", value: accountLabel(record.address), valueStyle: "code" },
          { label: "Required", value: config ? String(config.threshold) : "Unavailable" },
          {
            label: "Current signers",
            value: config ? String(config.signerGuids.length) : "Unavailable",
          },
        ])}
        ${
          completeConfig
            ? `<div class="multisig-signer-roster" role="list">${identities
                .map(
                  (identity) => `<article class="multisig-signer-identity" role="listitem">
                    <span class="option-avatar">${accountAvatar(identity.address)}</span>
                    <span class="option-copy"><strong>${escapeHtml(identity.label)}</strong><span class="option-sub">${escapeHtml(identity.detail)}</span></span>
                    <details class="disclosure multisig-signer-manage">
                      <summary aria-label="Manage ${escapeHtml(identity.label)}"><span>${icon("moreHorizontal")}</span></summary>
                      <div class="disclosure-body">
                        <form data-ms-manage="replace" data-multisig-id="${escapeHtml(record.id)}">
                          <input name="removePublicKey" type="hidden" value="${escapeHtml(identity.publicKey)}" />
                          ${selectField({ label: "Replace with", name: "selectedPublicKey", options: candidates })}
                          ${textField({ className: "mono", label: "Or enter signer public key", name: "publicKey", placeholder: "0x…", spellcheck: false })}
                          ${button({ label: "Review replacement", type: "submit", variant: "secondary" })}
                        </form>
                        <form data-ms-manage="remove" data-multisig-id="${escapeHtml(record.id)}">
                          <input name="publicKey" type="hidden" value="${escapeHtml(identity.publicKey)}" />
                          ${selectField({
                            disabled: identities.length <= 1,
                            label: "Approvals after removal",
                            name: "threshold",
                            options: thresholdOptions(Math.max(1, identities.length - 1), -1),
                            selected: String(
                              Math.min(
                                completeConfig.threshold,
                                Math.max(1, identities.length - 1),
                              ),
                            ),
                          })}
                          ${button({
                            disabled: identities.length <= 1,
                            label: "Review removal",
                            tone: "danger",
                            type: "submit",
                            variant: "secondary",
                          })}
                        </form>
                      </div>
                    </details>
                  </article>`,
                )
                .join("")}</div>`
            : config
              ? `<div class="multisig-complete-config">
                  <p class="multisig-config-note" role="note">${
                    view.unsupportedSigners.length > 0
                      ? `This account includes ${view.unsupportedSigners.length === 1 ? "a signer type" : "signer types"} this wallet cannot sign with. It remains available to watch, receive, and inspect.`
                      : `We could not recover every current Stark signer from chain history. Add the ${unresolvedSignerCount === 1 ? "missing public key below" : `${unresolvedSignerCount} missing public keys below in any order`}.`
                  }</p>
                  <form id="multisig-complete-config-form" data-multisig-id="${escapeHtml(record.id)}">
                    ${config.signerGuids.map((guid) => `<input name="signerGuid" type="hidden" value="${escapeHtml(guid)}" />`).join("")}
                    <div class="multisig-signer-recovery-list" role="list">
                      ${recoverySigners
                        .map((signer) =>
                          signer.identity && signer.publicKey
                            ? `<article class="multisig-signer-recovery-row" role="listitem">
                                <span class="option-avatar">${accountAvatar(signer.identity.address)}</span>
                                <span class="option-copy"><strong>${escapeHtml(signer.identity.label)}</strong><span class="option-sub">Signer matched · ${escapeHtml(signer.identity.detail)}</span></span>
                                <span class="multisig-signer-match">${icon("check")}</span>
                                <input name="signerPublicKey" type="hidden" value="${escapeHtml(signer.publicKey)}" />
                              </article>`
                            : signer.unsupported
                              ? `<article class="multisig-signer-recovery-row" role="listitem">
                                  <span class="option-avatar">${icon("shield")}</span>
                                  <span class="option-copy"><strong>${escapeHtml(unsupportedSignerLabel(signer.unsupported.type))}</strong><span class="option-sub">Recognized on-chain · Watch only · GUID ${escapeHtml(accountLabel(signer.unsupported.guid))}</span></span>
                                </article>`
                              : `<div class="multisig-signer-recovery-field" role="listitem">
                                ${textField({
                                  attributes: { "data-signer-key": "true" },
                                  className: "mono",
                                  hint: "Enter a Stark public key. It will be checked against the live account.",
                                  label: "Missing signer public key",
                                  name: "signerPublicKey",
                                  placeholder: "0x…",
                                  required: true,
                                  spellcheck: false,
                                })}
                              </div>`,
                        )
                        .join("")}
                    </div>
                    ${unresolvedSignerCount > 0 ? button({ label: "Verify missing signer keys", type: "submit" }) : ""}
                    ${unresolvedSignerCount > 0 ? '<p id="multisig-complete-config-result" role="status"></p>' : ""}
                  </form>
                </div>`
              : `<p class="review-flag" role="alert">${escapeHtml(authorityFailureMessage(view.authorityStatus))}</p>`
        }
      </section>
      ${
        completeConfig
          ? `<section class="section multisig-authority-actions">
              <details class="disclosure">
                <summary><span class="menu-copy"><strong>Add participant</strong><small>Use an account address or shared public key</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  <form data-ms-manage="add" data-current-signer-keys="${escapeHtml(completeConfig.signerPublicKeys.join(" "))}" data-multisig-id="${escapeHtml(record.id)}">
                    <input name="selectedPublicKey" type="hidden" value="" />
                    <div class="multisig-participant-selection" data-participant-selection hidden>
                      <span class="option-avatar">${icon("user")}</span>
                      <span class="option-copy"><strong data-participant-selection-name></strong><span class="option-sub" data-participant-selection-detail></span></span>
                    </div>
                    ${button({ attributes: { "data-open-participant-picker": true }, icon: "plus", label: "Choose participant", variant: "secondary" })}
                    ${selectField({
                      label: "Approvals after adding",
                      name: "threshold",
                      options: thresholdOptions(identities.length + 1, -1),
                      selected: String(completeConfig.threshold),
                    })}
                    ${button({ disabled: true, label: "Review signer addition", type: "submit" })}
                  </form>
                </div>
              </details>
              <details class="disclosure">
                <summary><span class="menu-copy"><strong>Change approvals required</strong><small>Currently ${completeConfig.threshold} of ${identities.length}</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  <form data-ms-manage="threshold" data-multisig-id="${escapeHtml(record.id)}">
                    ${selectField({
                      label: "New approval threshold",
                      name: "threshold",
                      options: thresholdOptions(identities.length, completeConfig.threshold),
                    })}
                    ${button({ disabled: identities.length <= 1, label: "Review threshold change", type: "submit" })}
                  </form>
                </div>
              </details>
              ${button({ attributes: { "data-view": "address-book" }, icon: "book", label: "Manage signer contacts", variant: "ghost" })}
              <p id="multisig-signers-result" role="status"></p>
            </section>`
          : ""
      }
      <section class="section">
        <p class="hint">Removing stops local tracking only. It never changes the on-chain account.</p>
        ${button({ attributes: { "data-multisig-remove": record.id }, label: "Stop watching", variant: "ghost" })}
      </section>
      </div>
      ${completeConfig ? multisigParticipantScreen(status.networkId, participantOptions) : ""}`,
    )
  );
};

/**
 * Renders the public shared receive address.
 */
export const multisigReceiveFlow = (
  status: WalletStatus,
  view: ArgentMultisigView | null,
): string => {
  if (!view) {
    return (
      flowHeader("Receive", status) +
      flowScreen("multisig-receive", emptyState("This Argent multisig is no longer watched."))
    );
  }
  return (
    flowHeader("Receive", status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-receive",
      receiveAddressView({
        address: view.record.address,
        copyLabel: "Copy address",
        hint: `Send only Starknet assets on ${status.network}.`,
        networkId: status.networkId,
      }),
    )
  );
};

/**
 * Renders full frozen-intent import for independent co-signers.
 */
export const multisigTrackFlow = (status: WalletStatus, view: ArgentMultisigView | null): string =>
  flowHeader("Import signing intent", status, view ? multisigDisplayName(view.record) : undefined) +
  flowScreen(
    "multisig-track",
    view
      ? `<section class="section">
          <p class="review-flag" role="note">Import only the full immutable package. The wallet re-hashes every signed field and requires this exact account, chain, nonce, class and current signer authority.</p>
          <form id="multisig-track-form">
            ${textareaField({ className: "mono", label: "Intent package", name: "intentPackage", required: true, rows: 8, spellcheck: false })}
            ${button({ label: "Verify and import", type: "submit" })}
            <p id="multisig-track-result" role="status"></p>
          </form>
        </section>`
      : emptyState("Select a watched Argent multisig first."),
  );
