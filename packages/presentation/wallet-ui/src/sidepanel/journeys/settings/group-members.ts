/**
 * Pure templates for the group-centric bulk members editor rendered in the
 * manage-accounts "Groups" section. Where the per-account picker in
 * ./group-controls.ts files a single account into one folder, this editor
 * transposes the relationship: it opens one group and lists EVERY wallet
 * account (across networks) as a checklist, so a user can bucket many accounts
 * into a group in one pass without opening each account. The group's rename,
 * icon, and delete controls are consolidated into the editor header so managing
 * a group and its membership happen in one place, and a leading "Create a group"
 * panel shares the same accordion so this section owns the whole group lifecycle.
 * Each account toggle reuses
 * the existing `data-group-toggle`/`data-account` contract wired by
 * ./group-ui.ts `bindGroupControls`, so there is no parallel data path.
 * Behaviour (expand/collapse persistence, membership toggles) lives in
 * ./group-ui.ts; styles in ./styles-home.ts.
 */

import { escapeHtml } from "@bramble/core/html";
import {
  type AccountGroup,
  type AccountGroups,
  DEFAULT_GROUP_IDS,
  displayedAccountGroup,
  isDefaultGroup,
} from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { iconButton } from "@bramble/ui-kit/controls";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { NetworkOption } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountAvatar, accountDisplayName, accountLabel } from "../../shared/parts";
import { editGroupForm, newGroupForm } from "./group-controls";
import { CREATE_GROUP_PANEL } from "./group-state";

// The "Create a group" accordion row: a header toggle plus the shared create
// form as its body. It reuses the same `data-group-expand`/`.group-expand`
// contract as the per-group editors — with the {@link CREATE_GROUP_PANEL}
// sentinel as its id — so ./group-ui.ts's `bindGroupExpanders` drives it and it
// shares the one expanded-panel slot: opening it collapses any open group, and
// opening a group collapses it. `open` seeds its expanded state.
const createGroupRow = (open: boolean): string => `
  <li class="group-manage-row">
    <button class="group-expand" type="button" data-group-expand="${CREATE_GROUP_PANEL}" aria-expanded="${open}" aria-controls="group-create-panel">
      <span class="group-manage-icon">${icon("plus")}</span>
      <span class="group-manage-copy"><strong>Create a group</strong></span>
      <span class="group-expand-mark">${icon(open ? "chevronDown" : "chevronRight")}</span>
    </button>
    <div class="group-members" id="group-create-panel"${open ? "" : " hidden"}>
      ${newGroupForm()}
    </div>
  </li>`;

// One account row in a group's members checklist: avatar, display label,
// truncated address, an optional network badge (only when the wallet spans
// networks), and a membership mark. Emits the shared toggle contract
// (`data-group-toggle`/`data-account`/`aria-pressed`) so ./group-ui.ts's
// existing `bindGroupControls` toggles membership via `setAccountInGroup`.
const accountChecklistRow = (
  account: AccountRef,
  group: AccountGroup,
  groups: AccountGroups,
  preferences: WalletPreferences | null,
  networkName: string | null,
): string => {
  const member = displayedAccountGroup(groups, account.id)?.id === group.id;
  // An account shown in My accounts stays there until it is filed elsewhere.
  // Clearing that row would leave the account on screen, so the control is
  // not offered.
  const staysInHome = member && group.id === DEFAULT_GROUP_IDS.home;
  return `<button class="account-check" type="button" data-group-toggle="${escapeHtml(group.id)}" data-account="${escapeHtml(account.id)}" aria-pressed="${member}"${staysInHome ? ' disabled title="File this account into another folder to move it."' : ""}>
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
  groups: AccountGroups,
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
  networkNameFor: (account: AccountRef) => string | null,
  expanded: boolean,
): string => {
  const count = accounts.filter(
    (account) => displayedAccountGroup(groups, account.id)?.id === group.id,
  ).length;
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
        ${
          isDefaultGroup(group.id)
            ? ""
            : iconButton({
                attributes: { "data-remove-group": group.id },
                icon: "x",
                label: `Delete ${group.name}`,
                tone: "danger",
              })
        }
      </div>
      ${editGroupForm(group)}
      ${
        accounts.length === 0
          ? '<p class="hint">No accounts yet. Add one above to start bucketing.</p>'
          : `<div class="account-check-list">${accounts
              .map((account) =>
                accountChecklistRow(account, group, groups, preferences, networkNameFor(account)),
              )
              .join("")}</div>`
      }
    </div>
  </li>`;
};

/**
 * Renders the manage-accounts "Groups" section: the one home for group
 * management — creating a group, renaming/re-iconing each, deleting a folder
 * the user made (the two default folders have no delete control), and bucketing
 * accounts into it — as a single accordion. A "Create a group" panel leads, then
 * one row per group; each group expands into a members checklist listing every
 * wallet account (across networks) with the group's rename/icon/delete controls
 * in its header. An account in no folder counts as a member of My accounts,
 * matching the drawer, and that row cannot be cleared. `expandedGroupId` selects the single open panel — a group id,
 * the {@link CREATE_GROUP_PANEL} sentinel, or null (all collapsed) — so opening
 * one panel collapses the previously open one and never piles up. With no groups
 * yet the create panel starts open so the first group is one step away. A
 * per-account network badge appears only when `accounts` span more than one
 * network.
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
  // The create panel is open when explicitly selected, or by default while no
  // groups exist (nothing else can be open, so the accordion invariant holds).
  const createOpen = expandedGroupId === CREATE_GROUP_PANEL || groups.length === 0;
  return `
  <section class="section">
    <p class="eyebrow">Groups</p>
    <ul class="group-manage-list">
      ${createGroupRow(createOpen)}
      ${groups
        .map((group) =>
          groupMembersEditor(
            group,
            groups,
            accounts,
            preferences,
            networkNameFor,
            group.id === expandedGroupId,
          ),
        )
        .join("")}
    </ul>
  </section>`;
};
