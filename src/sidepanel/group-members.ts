/**
 * Pure templates for the group-centric bulk members editor rendered in the
 * manage-accounts "Groups" section. Where the per-account panel in
 * ./group-controls.ts toggles a single account across every group, this editor
 * transposes the relationship: it opens one group and lists EVERY wallet
 * account (across networks) as a checklist, so a user can bucket many accounts
 * into a group in one pass without opening each account. The group's rename,
 * icon, and delete controls are consolidated into the editor header so managing
 * a group and its membership happen in one place. Each account toggle reuses
 * the existing `data-group-toggle`/`data-account` contract wired by
 * ./group-ui.ts `bindGroupControls`, so there is no parallel data path.
 * Behaviour (expand/collapse persistence, membership toggles) lives in
 * ./group-ui.ts; styles in ./styles-home.ts.
 */
import type { NetworkOption } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AccountGroup, AccountGroups } from "../storage/account-groups";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { editGroupForm, newGroupForm } from "./group-controls";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel } from "./parts";

// One account row in a group's members checklist: avatar, display label,
// truncated address, an optional network badge (only when the wallet spans
// networks), and a membership mark. Emits the shared toggle contract
// (`data-group-toggle`/`data-account`/`aria-pressed`) so ./group-ui.ts's
// existing `bindGroupControls` toggles membership via `setAccountInGroup`.
const accountChecklistRow = (
  account: AccountRef,
  group: AccountGroup,
  preferences: WalletPreferences | null,
  networkName: string | null,
): string => {
  const member = group.accountIds.includes(account.id);
  return `<button class="account-check" type="button" data-group-toggle="${escapeHtml(group.id)}" data-account="${escapeHtml(account.id)}" aria-pressed="${member}">
    <span class="option-avatar">${accountAvatar(account.address)}</span>
    <span class="account-check-copy">
      <strong>${escapeHtml(accountDisplayName(account, preferences))}</strong>
      <code>${accountLabel(account.address)}</code>
    </span>
    ${networkName ? `<span class="account-check-net">${escapeHtml(networkName)}</span>` : ""}
    <span class="account-check-mark">${member ? icon("check") : icon("plus")}</span>
  </button>`;
};

// A single group's expandable row: a header toggle (icon, name, member count)
// that opens the editor, and the editor itself — consolidated rename/icon/delete
// controls plus the full-account checklist. `expanded` seeds the open state,
// persisted across re-renders by ./group-ui.ts.
const groupMembersEditor = (
  group: AccountGroup,
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
  networkNameFor: (account: AccountRef) => string | null,
  expanded: boolean,
): string => {
  const count = group.accountIds.length;
  const plural = count === 1 ? "" : "s";
  return `<li class="group-manage-row">
    <button class="group-expand" type="button" data-group-expand="${escapeHtml(group.id)}" aria-expanded="${expanded}" aria-controls="group-editor-${escapeHtml(group.id)}">
      <span class="group-manage-icon">${icon(group.icon)}</span>
      <span class="group-manage-copy">
        <strong>${escapeHtml(group.name)}</strong>
        <span class="hint">${count} account${plural}</span>
      </span>
      <span class="group-expand-mark">${icon(expanded ? "chevronDown" : "chevronRight")}</span>
    </button>
    <div class="group-members" id="group-editor-${escapeHtml(group.id)}"${expanded ? "" : " hidden"}>
      <div class="group-members-head">
        <p class="eyebrow">${count} member${plural}</p>
        <button class="icon-button danger" type="button" data-remove-group="${escapeHtml(group.id)}" aria-label="Delete ${escapeHtml(group.name)}" title="Delete ${escapeHtml(group.name)}">${icon("x")}</button>
      </div>
      ${editGroupForm(group)}
      ${
        accounts.length === 0
          ? '<p class="hint">No accounts yet. Add one above to start bucketing.</p>'
          : `<div class="account-check-list">${accounts
              .map((account) =>
                accountChecklistRow(account, group, preferences, networkNameFor(account)),
              )
              .join("")}</div>`
      }
    </div>
  </li>`;
};

/**
 * Renders the manage-accounts "Groups" section: the group-centric bulk editor.
 * Each group expands into a members checklist listing every wallet account
 * (across networks) with the group's rename/icon/delete controls in its header;
 * `expandedGroupId` selects which group's editor is open (null = all collapsed).
 * A per-account network badge appears only when `accounts` span more than one
 * network. Keeps the shared "New group" create form at the foot.
 */
export const groupsSection = (
  groups: AccountGroups,
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
  expandedGroupId: string | null,
  networks: readonly NetworkOption[],
): string => {
  const spanNetworks = new Set(accounts.map((account) => account.networkId)).size > 1;
  const nameById = new Map(networks.map((network) => [network.id, network.name]));
  const networkNameFor = (account: AccountRef): string | null =>
    spanNetworks ? (nameById.get(account.networkId) ?? account.networkId) : null;
  return `
  <section class="section">
    <h2>Groups</h2>
    <p class="hint">Organise accounts into named folders. Open a group to bucket accounts into it in one pass; an account can belong to several groups.</p>
    ${
      groups.length === 0
        ? '<p class="empty">No groups yet. Create your first below.</p>'
        : `<ul class="group-manage-list">${groups
            .map((group) =>
              groupMembersEditor(
                group,
                accounts,
                preferences,
                networkNameFor,
                group.id === expandedGroupId,
              ),
            )
            .join("")}</ul>`
    }
    ${newGroupForm()}
  </section>`;
};
