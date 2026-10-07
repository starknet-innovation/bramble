/**
 * The "Account names" section of the manage-accounts flow: every visible account
 * on the current network with its name as an editable field, rather than one form
 * for whichever account happens to be active. The placeholder is the generated
 * nickname the wallet falls back to, so an unnamed account shows the name it is
 * known by everywhere else instead of an empty box. Hidden accounts are not named
 * here; they live in the "Hidden accounts" section, which is also where they come
 * back from.
 *
 * Pure template. Each row is its own form keyed by account id
 * (`data-account-name-form`), which is what ./settings-ui.ts binds and what
 * lets a repaint restore a half-typed name into the right row. Folder
 * membership is shown, not edited here; the Groups accordion below owns
 * that.
 */
import { escapeHtml } from "@bramble/core/html";
import type { AccountGroups } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { menuRow } from "@bramble/ui-kit/navigation";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../../popup/responses/responses";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  friendlyAccountName,
  inlineCopyButton,
  noAccountEmpty,
} from "../../shared/parts";
import { accountGroupsLine } from "./group-controls";

// The bound `isLabel` enforces in the preferences store
// (foundation/wallet-model/preferences). Held here so the field stops the user
// at the same place the write would reject them, rather than after a round trip.
const NAME_MAXLENGTH = 64;

const accountNameRow = (
  stored: AccountRef,
  preferences: WalletPreferences | null,
  groups: AccountGroups,
): string => {
  const generated = friendlyAccountName(stored.address);
  const memberGroups = groups.filter((group) => group.accountIds.includes(stored.id));
  return `<form class="account-name-row" data-account-name-form="${escapeHtml(stored.id)}">
    <span class="option-avatar">${accountAvatar(stored.address)}</span>
    <div class="account-name-copy">
      ${textField({
        attributes: { "data-account-name": stored.id },
        autocomplete: "off",
        label: `Name for ${generated}`,
        labelHidden: true,
        maxlength: NAME_MAXLENGTH,
        name: "label",
        placeholder: generated,
        value: preferences?.accountLabels?.[stored.id] ?? "",
      })}
      <span class="account-name-meta">
        <code title="${escapeHtml(stored.address)}">${escapeHtml(accountLabel(stored.address))}</code>
        ${inlineCopyButton(stored.address, `Copy ${generated} address`)}
        ${accountGroupsLine(memberGroups)}
      </span>
    </div>
    <span class="account-name-actions">
      ${button({
        // Hiding is the reversible way to take an account out of the way, so the
        // row offers it directly. The account keeps its keys and its grants and
        // comes back from the "Hidden accounts" section below.
        attributes: {
          "aria-label": `Hide ${generated}`,
          "data-hide-account": stored.id,
        },
        icon: "eyeOff",
        label: "Hide",
        size: "small",
        type: "button",
        variant: "ghost",
      })}
      ${button({
        // One "Save" per row reads as a list of identical controls to a screen
        // reader, so each carries the account it saves. The accessible name still
        // starts with the visible word, which is what voice control matches on.
        attributes: { "aria-label": `Save name for ${generated}` },
        icon: "check",
        label: "Save",
        size: "small",
        type: "submit",
        variant: "secondary",
      })}
    </span>
  </form>`;
};

/**
 * Renders the account-names section: one editable name per visible account on
 * the active network, then "Add account". An empty name clears the stored label
 * and the account falls back to its generated nickname, which is what the field
 * shows as its placeholder. Accounts on other networks are not listed: this
 * section names what the current network shows.
 */
export const accountNamesSection = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  groups: AccountGroups,
): string => {
  const hidden = new Set(preferences?.hiddenAccountIds ?? []);
  const networkAccounts = status.accounts.filter(
    (stored) => stored.networkId === status.networkId && !hidden.has(stored.id),
  );
  return `<section class="section">
    <p class="eyebrow">Account names</p>
    <p class="hint">A name is shown instead of the address everywhere in the wallet. Leave one empty to go back to its generated name.</p>
    ${
      networkAccounts.length === 0
        ? noAccountEmpty(status)
        : `<div class="account-name-list">${networkAccounts
            .map((stored) => accountNameRow(stored, preferences, groups))
            .join("")}</div>`
    }
    ${menuRow({
      attributes: {
        id: "new-account",
        title: `Derives the next account on ${status.network} from this wallet's recovery phrase.`,
      },
      className: "row-action",
      icon: "plus",
      label: "Add account",
    })}
    <p id="label-result" role="status"></p>
    <p id="new-account-result" role="status"></p>
    <p id="account-visibility-result" role="status"></p>
  </section>`;
};

/**
 * Renders the "Hidden accounts" section: every account on the active network the
 * user has hidden, with the control that brings it back. Kept on the manage
 * screen beside "Account names" so hiding and restoring are the same trip. The
 * section renders nothing when no account is hidden, so a wallet that never used
 * the feature is unchanged.
 */
export const hiddenAccountsSection = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const hidden = new Set(preferences?.hiddenAccountIds ?? []);
  const hiddenAccounts = status.accounts.filter(
    (stored) => stored.networkId === status.networkId && hidden.has(stored.id),
  );
  if (hiddenAccounts.length === 0) {
    return "";
  }
  return `<section class="section">
    <p class="eyebrow">Hidden accounts</p>
    <p class="hint">Hidden accounts stay in this wallet. Each one is out of the drawer and the send pickers until you show it again.</p>
    <div class="account-name-list">
      ${hiddenAccounts
        .map((stored) => {
          const generated = friendlyAccountName(stored.address);
          return `<div class="account-name-row">
            <span class="option-avatar">${accountAvatar(stored.address)}</span>
            <div class="account-name-copy">
              <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
              <span class="account-name-meta">
                <code title="${escapeHtml(stored.address)}">${escapeHtml(accountLabel(stored.address))}</code>
              </span>
            </div>
            <span class="account-name-actions">
              ${button({
                attributes: {
                  "aria-label": `Show ${generated}`,
                  "data-reveal-account": stored.id,
                },
                icon: "eye",
                label: "Show",
                size: "small",
                type: "button",
                variant: "secondary",
              })}
            </span>
          </div>`;
        })
        .join("")}
    </div>
  </section>`;
};
