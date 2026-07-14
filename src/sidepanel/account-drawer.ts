/**
 * Left slide-in account drawer opened from the header avatar. Lists this
 * network's accounts with identicons and names, marks the active one, filters
 * by folder/group chips, shows each account's real group membership, lets each
 * account be assigned to groups from a persistent panel, and offers a
 * discoverable "New group" entry plus a jump into full account management. Pure
 * template — open/close state and bindings live in ./home-ui.ts, styles in
 * ./styles-home.ts. Rendered closed on every dock screen; the runtime restores
 * the open state (selected group filter, open assign panel, and create form)
 * across re-renders without replaying the slide.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AccountGroups } from "../storage/account-groups";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import {
  accountGroupsLine,
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

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it. `groupFilter` is the selected group id (null = "All"), narrowing
 * the listed accounts to that group's members. `openAssignId` keeps one
 * account's assign panel expanded across re-renders; `createOpen` keeps the
 * foot "New group" form revealed across re-renders.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  groupFilter: string | null = null,
  openAssignId: string | null = null,
  createOpen = false,
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
        <div class="drawer-new-group">
          <button id="drawer-new-group" class="secondary" type="button" aria-expanded="${createOpen}" aria-controls="drawer-new-group-form">${icon("plus")}New group</button>
          <div id="drawer-new-group-form"${createOpen ? "" : " hidden"}>${newGroupForm()}</div>
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
