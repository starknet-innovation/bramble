/**
 * The Send journey's "Sending to" stage: the address book, the user's own
 * accounts grouped under their folders, and any shared (multisig) accounts.
 *
 * Accounts are grouped with the same split the account drawer uses, so a
 * recipient is found under the folder it was filed into rather than in a second
 * ordering invented here. The archive renders minimized; reaching into it, and
 * filtering the whole list, belong to ../send/transfer-compose-ui.ts, which owns
 * every visibility decision on this stage.
 *
 * Pure templates. State and bindings live in ../send/transfer-compose-ui.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { withDefaultGroups } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountAvatar, accountDisplayName, accountLabel } from "../../shared/parts";
import {
  type FolderSection,
  folderSections,
  INITIAL_COLLAPSED_FOLDERS,
} from "../../shell/drawer-folders";
import { multisigDisplayName } from "../multisig/multisig-views";
import { sendRecipientAccounts } from "./send-model";

const recipientAccountRow = (
  account: AccountRef,
  preferences: WalletPreferences | null,
  isSender = false,
): string => `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(account.address)}"
    data-send-recipient-label="${escapeHtml(accountDisplayName(account, preferences))}"
    data-send-search="${escapeHtml(`${accountDisplayName(account, preferences)} ${account.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(account.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>
      <code>${escapeHtml(accountLabel(account.address))}</code>
      ${isSender ? "<small>Current account · shield into its private balance</small>" : ""}
    </span>
    ${icon("chevronRight")}
  </button>`;

// One folder of the user's own accounts, reusing the drawer's split so a
// recipient sits under the same folder on both screens. The archive starts
// minimized; a search still reaches into it (see ../send/transfer-compose-ui.ts),
// because a recipient the user typed must be findable wherever it is filed.
// The mark is always chevronRight. The stylesheet rotates it while the folder
// is open, so the glyph follows data-collapsed instead of a glyph baked in at
// render. An empty hint is omitted while the folder is minimized.
const recipientFolder = (section: FolderSection, rows: string): string => {
  const collapsed = INITIAL_COLLAPSED_FOLDERS.includes(section.group.id);
  return `<div class="send-recipient-folder" data-send-folder="${escapeHtml(section.group.id)}"
    data-collapsed="${String(collapsed)}">
    <button class="send-list-heading send-folder-head" type="button"
      data-send-folder-toggle="${escapeHtml(section.group.id)}" aria-expanded="${String(!collapsed)}">
      ${icon(section.group.icon)}<strong>${escapeHtml(section.group.name)}</strong>
      <span class="send-folder-count">${section.accounts.length}</span>
      <span class="send-folder-mark">${icon("chevronRight")}</span>
    </button>
    ${rows}
    <p class="send-folder-empty hint" data-send-folder-empty${rows === "" && !collapsed ? "" : " hidden"}>No accounts in this folder.</p>
  </div>`;
};

const addressBookRow = (entry: NonNullable<WalletPreferences["addressBook"]>[number]): string => `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(entry.address)}"
    data-send-recipient-label="${escapeHtml(entry.label)}"
    data-send-search="${escapeHtml(`${entry.label} ${entry.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(entry.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(entry.label)}</strong>
      <code>${escapeHtml(accountLabel(entry.address))}</code>
    </span>
    ${icon("chevronRight")}
  </button>`;

const multisigRecipientRow = (record: ArgentMultisigRecord): string => {
  const name = multisigDisplayName(record);
  return `
  <button class="send-recipient-row" type="button"
    data-send-recipient="${escapeHtml(record.address)}"
    data-send-recipient-label="${escapeHtml(name)}"
    data-send-search="${escapeHtml(`${name} multisig ${record.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(record.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(name)}</strong>
      <code>${escapeHtml(accountLabel(record.address))}</code>
      <small>Ready Multisig account</small>
    </span>
    ${icon("chevronRight")}
  </button>`;
};

/**
 * Renders the "Sending to" stage: the address book, then the user's own
 * accounts under their folders, then any shared accounts.
 *
 * Every row is rendered whatever its folder's state, including the minimized
 * archive — the binding decides what is visible, so a search can reach a
 * recipient the folder would otherwise keep out of the way. An account in no
 * folder is listed under My accounts without anything being written for it.
 */
export const recipientStage = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  multisigs: readonly ArgentMultisigRecord[],
): string => {
  const accounts = sendRecipientAccounts(status.accounts, status.networkId);
  const sharedAccounts = multisigs.filter((record) => record.networkId === status.networkId);
  const contacts =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return `<section class="send-stage send-recipient-stage" id="send-recipient-stage">
    <div class="send-origin-context">
      <p class="send-section-title">Sending from</p>
      <div class="send-origin-account">
        <span class="send-recipient-avatar">${accountAvatar(account?.address ?? "")}</span>
        <span class="send-recipient-copy">
          <strong>${escapeHtml(account ? accountDisplayName(account, preferences) : "No account")}</strong>
          <code>${escapeHtml(account ? accountLabel(account.address) : "—")}</code>
        </span>
      </div>
    </div>
    <label class="send-search">
      <span>Sending to</span>
      <span class="send-search-control">${icon("search")}${inputControl({
        ariaLabel: "Recipient address or saved name",
        attributes: { id: "send-recipient-search" },
        autocomplete: "off",
        className: "mono",
        placeholder: "Address or saved name",
        spellcheck: false,
        type: "search",
      })}</span>
    </label>
    <div class="send-recipient-list" data-send-recipient-panel="contacts">
      <div class="send-list-heading">${icon("book")}<strong>Address book</strong></div>
      ${contacts.map(addressBookRow).join("")}
      <div id="send-recipient-save-row" hidden>
        ${button({
          attributes: { id: "send-recipient-save" },
          icon: "book",
          label: "Save address",
          variant: "secondary",
        })}
      </div>
    </div>
    <div class="send-recipient-list" data-send-recipient-panel="accounts">
      ${
        accounts.length > 0 || sharedAccounts.length > 0
          ? folderSections(withDefaultGroups(preferences?.groups ?? []), accounts)
              .map((section) =>
                recipientFolder(
                  section,
                  section.accounts
                    .map((stored) =>
                      recipientAccountRow(stored, preferences, stored.id === account?.id),
                    )
                    .join(""),
                ),
              )
              .join("") +
            (
              sharedAccounts.length === 0
                ? ""
                : `<div class="send-recipient-folder" data-send-folder="shared">
                  <div class="send-list-heading">${icon("users")}<strong>Shared accounts</strong></div>
                  ${sharedAccounts.map(multisigRecipientRow).join("")}
                </div>`
            )
          : emptyState("No other accounts are available on this network.")
      }
    </div>
    <p class="send-recipient-empty" id="send-recipient-empty" hidden>No matching recipient.</p>
    ${button({
      attributes: { id: "send-recipient-continue" },
      disabled: account === null,
      label: "Continue with address",
    })}
  </section>`;
};
