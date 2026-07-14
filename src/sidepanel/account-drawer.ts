/**
 * Left slide-in account drawer opened from the header avatar. Lists this
 * network's accounts with identicons and names, marks the active one, filters
 * by folder/group chips, shows each account's real group membership, lets each
 * account be assigned to groups from a persistent panel, and offers a
 * discoverable "Manage groups" disclosure — create a group and, per existing
 * group, rename it, change its icon (via the shared picker), or delete it
 * (two-tap confirm) — plus a jump into full account management. Pure template —
 * open/close state and bindings live in ./home-ui.ts, styles in ./styles-home.ts.
 * Rendered closed on every dock screen; the runtime restores the open state
 * (selected group filter, open assign panel, open manage disclosure, and the
 * group being edited) across re-renders without replaying the slide.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AccountGroup, AccountGroups } from "../storage/account-groups";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import {
  accountGroupsLine,
  editGroupForm,
  groupAssignPanel,
  groupFilterChips,
  newGroupForm,
} from "./group-controls";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel } from "./parts";

const drawerAccountRow = (
  stored: AccountRef,
  activeId: string | null,
  preferences: WalletPreferences | null,
  groups: AccountGroups,
  openAssignId: string | null,
): string => {
  const memberGroups = groups.filter((group) => group.accountIds.includes(stored.id));
  const assignOpen = stored.id === openAssignId;
  return `
  <li class="drawer-account-item">
    <div class="drawer-account-row">
      <button class="drawer-account" data-switch-account="${escapeHtml(stored.id)}" type="button" aria-pressed="${stored.id === activeId}">
        <span class="option-avatar">${accountAvatar(stored.address)}</span>
        <span class="drawer-copy">
          <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
          <code>${accountLabel(stored.address)}</code>
          ${accountGroupsLine(memberGroups)}
        </span>
        ${stored.id === activeId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>
      <button class="icon-button ghost drawer-assign" data-assign-toggle="${escapeHtml(stored.id)}" type="button" aria-expanded="${assignOpen}" aria-label="Edit groups for ${escapeHtml(accountDisplayName(stored, preferences))}" title="Edit groups">${icon("folder")}</button>
    </div>
    ${groupAssignPanel(stored, groups, assignOpen)}
  </li>`;
};

// One row in the drawer's "Manage groups" list: a header that expands the
// group's editor, and — when expanded — a two-tap delete plus the shared
// rename/icon edit form. Reuses the same `data-group-expand`/`data-remove-group`
// /`data-save-group` contracts (and `expandedGroupId` open-state) as the
// manage-accounts Groups section, so ./group-ui.ts binds both identically. This
// list edits a group's name/icon/existence only; membership stays on the
// per-account assign panel, so no surface does the same job twice.
const drawerManageRow = (group: AccountGroup, expanded: boolean): string => `
  <li class="group-manage-row">
    <button class="group-expand" type="button" data-group-expand="${escapeHtml(group.id)}" aria-expanded="${expanded}" aria-controls="drawer-group-editor-${escapeHtml(group.id)}">
      <span class="group-manage-icon">${icon(group.icon)}</span>
      <span class="group-manage-copy"><strong>${escapeHtml(group.name)}</strong></span>
      <span class="group-expand-mark">${icon(expanded ? "chevronDown" : "chevronRight")}</span>
    </button>
    <div class="group-members" id="drawer-group-editor-${escapeHtml(group.id)}"${expanded ? "" : " hidden"}>
      <div class="group-members-head">
        <p class="eyebrow">Edit group</p>
        <button class="icon-button danger" type="button" data-remove-group="${escapeHtml(group.id)}" aria-label="Delete ${escapeHtml(group.name)}" title="Delete ${escapeHtml(group.name)}">${icon("x")}</button>
      </div>
      ${editGroupForm(group)}
    </div>
  </li>`;

// The drawer's "Manage groups" disclosure body: the editable list of existing
// groups plus the single shared create form. Discoverable in one tap (open the
// disclosure) and edit any group's name/icon/existence in two (expand its row).
const drawerManageGroups = (groups: AccountGroups, expandedGroupId: string | null): string => `
  ${
    groups.length === 0
      ? '<p class="hint">No groups yet. Create your first below.</p>'
      : `<ul class="group-manage-list">${groups
          .map((group) => drawerManageRow(group, group.id === expandedGroupId))
          .join("")}</ul>`
  }
  ${newGroupForm()}`;

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it. `groupFilter` is the selected group id (null = "All"), narrowing
 * the listed accounts to that group's members. `openAssignId` keeps one
 * account's assign panel expanded across re-renders; `manageOpen` keeps the foot
 * "Manage groups" disclosure revealed, and `expandedGroupId` keeps one group's
 * inline editor open within it, both across re-renders.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  groupFilter: string | null = null,
  openAssignId: string | null = null,
  manageOpen = false,
  expandedGroupId: string | null = null,
): string => {
  const groups = preferences?.groups ?? [];
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const activeGroup = groupFilter ? groups.find((group) => group.id === groupFilter) : undefined;
  const visible = activeGroup
    ? accounts.filter((stored) => activeGroup.accountIds.includes(stored.id))
    : accounts;
  return `
  <div class="drawer-root" data-open="false">
    <div class="drawer-backdrop" data-drawer-close></div>
    <aside class="account-drawer" role="dialog" aria-modal="true" aria-label="Accounts">
      <header class="drawer-head">
        <div class="drawer-title">
          <h2>Accounts</h2>
          <p>${escapeHtml(status.network)}</p>
        </div>
        <button class="icon-button ghost drawer-close" data-drawer-close type="button" aria-label="Close accounts">${icon("x")}</button>
      </header>
      ${groupFilterChips(groups, groupFilter)}
      ${
        visible.length === 0
          ? `<p class="empty">${activeGroup ? "No accounts in this group yet. Open an account's folder button to add it." : "No accounts on this network yet. Add one below."}</p>`
          : `<ul class="drawer-list">${visible
              .map((stored) =>
                drawerAccountRow(stored, account?.id ?? null, preferences, groups, openAssignId),
              )
              .join("")}</ul>`
      }
      <div class="drawer-foot">
        <div class="drawer-manage-groups">
          <button id="drawer-manage-groups" class="secondary" type="button" aria-expanded="${manageOpen}" aria-controls="drawer-manage-groups-panel">${icon("settings")}Manage groups</button>
          <div id="drawer-manage-groups-panel" class="drawer-manage-panel"${manageOpen ? "" : " hidden"}>${drawerManageGroups(groups, expandedGroupId)}</div>
        </div>
        <button id="drawer-add-account" class="secondary" type="button">${icon("plus")}Add account</button>
        <button class="menu-row" data-view="account" type="button">
          <span class="menu-icon">${icon("settings")}</span>
          <span class="menu-copy"><strong>Manage accounts &amp; groups</strong></span>
          <span class="menu-chevron">${icon("chevronRight")}</span>
        </button>
      </div>
    </aside>
  </div>`;
};
