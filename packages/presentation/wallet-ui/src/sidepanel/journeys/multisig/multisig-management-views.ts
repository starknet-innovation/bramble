/** Focused add, signer, receive, and intent-import screens for Argent multisig. */
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textareaField, textField } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountFamilyName,
  accountLabel,
  flowHeader,
  flowScreen,
  inlineCopyButton,
  noAccountEmpty,
} from "../../shared/parts";
import { receiveAddressView } from "../send/receive-view";
import { type MultisigParticipantOption, multisigParticipantScreen } from "./multisig-participant";
import { multisigDisplayName } from "./multisig-views";

const argentMultisigContractLabel = (): string =>
  `Ready Multisig ${ARGENT_MULTISIG_CONTRACT.version}`;

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
    eip191: t("multisig.signers.eip191"),
    secp256k1: t("multisig.signers.secp256k1"),
    secp256r1: t("multisig.signers.secp256r1"),
    webauthn: t("multisig.signers.passkey"),
  })[type];

const authorityFailureMessage = (status: ArgentMultisigView["authorityStatus"]): string =>
  ({
    available: t("multisig.authority.currentUnavailable"),
    "invalid-config": t("multisig.signers.invalidConfig"),
    "network-unavailable": t("multisig.authority.networkUnavailable"),
    undeployed: t("multisig.signers.undeployed"),
    "unsupported-class": t("multisig.signers.unsupportedClass"),
    "unsupported-signers": t("multisig.signers.cannotManage"),
  })[status];

const signerIdentities = (
  publicKeys: readonly string[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
): readonly SignerIdentity[] =>
  publicKeys.map((publicKey) => {
    const account = status.accounts.find((candidate) => sameFelt(candidate.publicKeyX, publicKey));
    if (account) {
      const contract = accountFamilyName(account.accountContractType);
      return {
        address: account.address,
        detail: `${contract}${account.derivation.kind === "ledger" ? " · Ledger" : ""} · ${t("multisig.participant.key", { key: accountLabel(publicKey) })}`,
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
          detail: `${t("multisig.signers.addressBook")} · ${t("multisig.participant.key", { key: accountLabel(publicKey) })}`,
          label: contact.label,
          publicKey,
        }
      : {
          address: publicKey,
          detail: t("multisig.signers.signerKey", { key: accountLabel(publicKey) }),
          label: t("multisig.signers.external"),
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
        !currentKeys.some((key) => sameFelt(key, account.publicKeyX)),
    )
    .map((account) => ({
      address: account.address,
      label: `${accountDisplayName(account, preferences)} · ${accountFamilyName(account.accountContractType)}${account.derivation.kind === "ledger" ? " · Ledger" : ""}`,
      publicKeyX: account.publicKeyX,
      source: t("multisig.participant.walletAccount"),
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
      source: t("multisig.participant.savedContact"),
    })) ?? []),
];

const availableSignerOptions = (participants: readonly MultisigParticipantOption[]) => [
  { label: t("multisig.signers.enterKey"), value: "" },
  ...participants.map(({ label, publicKeyX, source }) => ({
    label: `${label} · ${source}`,
    value: publicKeyX,
  })),
];

const thresholdOptions = (count: number, current: number) =>
  Array.from({ length: count }, (_, index) => index + 1).map((value) => ({
    label: t("multisig.signers.thresholdOption", { count: String(count), value: String(value) }),
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
  flowHeader(t("multisig.detail.title"), status, t("multisig.add.subtitle")) +
  flowScreen(
    "multisig-add",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <div class="multisig-setup-options" role="group" aria-label="${th("multisig.add.setup")}">
        ${setupOption("multisig-deploy", "users", th("multisig.list.create"), th("multisig.add.createNote"))}
        ${setupOption("multisig-watch", "search", th("multisig.add.existing"), th("multisig.add.existingNote"))}
      </div>
    </section>`,
  );

/**
 * Renders address-only discovery; authority is read from chain and matched locally.
 */
export const multisigWatchFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader(t("multisig.list.add"), status) +
  flowScreen(
    "multisig-watch",
    `<section class="section">
      ${account ? "" : noAccountEmpty(status)}
      <form id="multisig-add-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          label: t("multisig.add.address"),
          name: "address",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({ disabled: account === null, label: t("multisig.list.add"), type: "submit" })}
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
      flowHeader(t("multisig.home.signers"), status) +
      flowScreen("multisig-signers", emptyState(t("multisig.detail.unwatched")))
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
    flowHeader(t("multisig.home.signers"), status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-signers",
      `<div data-participant-origin>
      <section class="section multisig-authority-summary">
        ${receipt([
          { label: t("multisig.signers.contract"), value: argentMultisigContractLabel() },
          {
            action: {
              attributes: { "data-copy": record.address },
              icon: "copy",
              label: t("multisig.signers.copyAddress"),
            },
            label: t("multisig.signers.address"),
            value: accountLabel(record.address),
            valueStyle: "code",
          },
          {
            label: t("multisig.signers.required"),
            value: config ? String(config.threshold) : t("multisig.signers.unavailable"),
          },
          {
            label: t("multisig.signers.current"),
            value: config ? String(config.signerGuids.length) : t("multisig.signers.unavailable"),
          },
        ])}
        ${
          completeConfig
            ? `<div class="multisig-signer-roster" role="list">${identities
                .map(
                  (identity) => `<article class="multisig-signer-identity" role="listitem">
                    <span class="option-avatar">${accountAvatar(identity.address)}</span>
                    <span class="option-copy"><strong>${escapeHtml(identity.label)}</strong><span class="option-sub" title="${escapeHtml(identity.publicKey)}">${escapeHtml(identity.detail)}</span></span>
                    ${inlineCopyButton(identity.publicKey, t("multisig.signers.copyKey", { name: identity.label }))}
                    <details class="disclosure multisig-signer-manage">
                      <summary aria-label="${th("multisig.signers.manage", { name: identity.label })}"><span>${icon("moreHorizontal")}</span></summary>
                      <div class="disclosure-body">
                        <form data-ms-manage="replace" data-multisig-id="${escapeHtml(record.id)}">
                          <input name="removePublicKey" type="hidden" value="${escapeHtml(identity.publicKey)}" />
                          ${selectField({ label: t("multisig.signers.replaceWith"), name: "selectedPublicKey", options: candidates })}
                          ${textField({ className: "mono", label: t("multisig.signers.orEnterKey"), name: "publicKey", placeholder: "0x…", spellcheck: false })}
                          ${button({ label: t("multisig.signers.reviewReplacement"), type: "submit", variant: "secondary" })}
                        </form>
                        <form data-ms-manage="remove" data-multisig-id="${escapeHtml(record.id)}">
                          <input name="publicKey" type="hidden" value="${escapeHtml(identity.publicKey)}" />
                          ${selectField({
                            disabled: identities.length <= 1,
                            label: t("multisig.signers.approvalsAfterRemoval"),
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
                            label: t("multisig.signers.reviewRemoval"),
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
                      ? th(
                          view.unsupportedSigners.length === 1
                            ? "multisig.signers.unsupportedOne"
                            : "multisig.signers.unsupportedMany",
                        )
                      : unresolvedSignerCount === 1
                        ? th("multisig.signers.missingOne")
                        : th("multisig.signers.missingMany", {
                            count: String(unresolvedSignerCount),
                          })
                  }</p>
                  <form id="multisig-complete-config-form" data-multisig-id="${escapeHtml(record.id)}">
                    ${config.signerGuids.map((guid) => `<input name="signerGuid" type="hidden" value="${escapeHtml(guid)}" />`).join("")}
                    <div class="multisig-signer-recovery-list" role="list">
                      ${recoverySigners
                        .map((signer) =>
                          signer.identity && signer.publicKey
                            ? `<article class="multisig-signer-recovery-row" role="listitem">
                                <span class="option-avatar">${accountAvatar(signer.identity.address)}</span>
                                <span class="option-copy"><strong>${escapeHtml(signer.identity.label)}</strong><span class="option-sub">${th("multisig.signers.matched")} · ${escapeHtml(signer.identity.detail)}</span></span>
                                <span class="multisig-signer-match">${icon("check")}</span>
                                <input name="signerPublicKey" type="hidden" value="${escapeHtml(signer.publicKey)}" />
                              </article>`
                            : signer.unsupported
                              ? `<article class="multisig-signer-recovery-row" role="listitem">
                                  <span class="option-avatar">${icon("shield")}</span>
                                  <span class="option-copy"><strong>${escapeHtml(unsupportedSignerLabel(signer.unsupported.type))}</strong><span class="option-sub">${th("multisig.signers.recognized")} · ${th("multisig.config.watchOnly")} · GUID ${escapeHtml(accountLabel(signer.unsupported.guid))}</span></span>
                                </article>`
                              : `<div class="multisig-signer-recovery-field" role="listitem">
                                ${textField({
                                  attributes: { "data-signer-key": "true" },
                                  className: "mono",
                                  hint: t("multisig.signers.missingKeyHint"),
                                  label: t("multisig.signers.missingKey"),
                                  name: "signerPublicKey",
                                  placeholder: "0x…",
                                  required: true,
                                  spellcheck: false,
                                })}
                              </div>`,
                        )
                        .join("")}
                    </div>
                    ${unresolvedSignerCount > 0 ? button({ label: t("multisig.signers.verifyMissing"), type: "submit" }) : ""}
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
                <summary><span class="menu-copy"><strong>${th("multisig.signers.addParticipant")}</strong><small>${th("multisig.signers.addParticipantNote")}</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  <form data-ms-manage="add" data-current-signer-keys="${escapeHtml(completeConfig.signerPublicKeys.join(" "))}" data-multisig-id="${escapeHtml(record.id)}">
                    <input name="selectedPublicKey" type="hidden" value="" />
                    <div class="multisig-participant-selection" data-participant-selection hidden>
                      <span class="option-avatar">${icon("user")}</span>
                      <span class="option-copy"><strong data-participant-selection-name></strong><span class="option-sub" data-participant-selection-detail></span></span>
                      ${inlineCopyButton("", t("multisig.participant.copyAddress"), { "data-participant-selection-copy": true, hidden: true })}
                    </div>
                    ${button({ attributes: { "data-open-participant-picker": true }, icon: "plus", label: t("multisig.participant.choose"), variant: "secondary" })}
                    ${selectField({
                      label: t("multisig.signers.approvalsAfterAdding"),
                      name: "threshold",
                      options: thresholdOptions(identities.length + 1, -1),
                      selected: String(completeConfig.threshold),
                    })}
                    ${button({ disabled: true, label: t("multisig.signers.reviewAddition"), type: "submit" })}
                  </form>
                </div>
              </details>
              <details class="disclosure">
                <summary><span class="menu-copy"><strong>${th("multisig.signers.changeThreshold")}</strong><small>${th("multisig.signers.currently", { threshold: String(completeConfig.threshold), total: String(identities.length) })}</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
                <div class="disclosure-body">
                  <form data-ms-manage="threshold" data-multisig-id="${escapeHtml(record.id)}">
                    ${selectField({
                      label: t("multisig.signers.newThreshold"),
                      name: "threshold",
                      options: thresholdOptions(identities.length, completeConfig.threshold),
                    })}
                    ${button({ disabled: identities.length <= 1, label: t("multisig.signers.reviewThreshold"), type: "submit" })}
                  </form>
                </div>
              </details>
              ${button({ attributes: { "data-view": "address-book" }, icon: "book", label: t("multisig.signers.manageContacts"), variant: "ghost" })}
              <p id="multisig-signers-result" role="status"></p>
            </section>`
          : ""
      }
      <section class="section">
        <p class="hint">${th("multisig.signers.removeNote")}</p>
        ${button({ attributes: { "data-multisig-remove": record.id }, label: t("multisig.signers.stopWatching"), variant: "ghost" })}
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
      flowHeader(t("multisig.home.receive"), status) +
      flowScreen("multisig-receive", emptyState(t("multisig.detail.unwatched")))
    );
  }
  return (
    flowHeader(t("multisig.home.receive"), status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-receive",
      receiveAddressView({
        address: view.record.address,
        copyLabel: t("multisig.receive.copy"),
        hint: t("multisig.receive.hint", { network: status.network }),
        networkId: status.networkId,
      }),
    )
  );
};

/**
 * Renders full frozen-intent import for independent co-signers.
 */
export const multisigTrackFlow = (status: WalletStatus, view: ArgentMultisigView | null): string =>
  flowHeader(
    t("multisig.intents.import"),
    status,
    view ? multisigDisplayName(view.record) : undefined,
  ) +
  flowScreen(
    "multisig-track",
    view
      ? `<section class="section">
          <p class="review-flag" role="note">${th("multisig.track.note")}</p>
          <form id="multisig-track-form">
            ${textareaField({ className: "mono", label: t("multisig.track.package"), name: "intentPackage", required: true, rows: 8, spellcheck: false })}
            ${button({ label: t("multisig.track.verify"), type: "submit" })}
            <p id="multisig-track-result" role="status"></p>
          </form>
        </section>`
      : emptyState(t("multisig.track.selectFirst")),
  );
