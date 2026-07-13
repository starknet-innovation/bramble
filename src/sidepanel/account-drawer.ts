/**
 * Left slide-in account drawer opened from the header avatar. Lists this
 * network's accounts with identicons and names, marks the active one, filters
 * by folder/group chips, lets each account be assigned to groups, and offers
 * add-account plus a jump into full account management. Pure template —
 * open/close state and bindings live in ./home-ui.ts, styles in
 * ./styles-home.ts. Rendered closed on every dock screen; the runtime restores
 * the open state (and selected group filter) across re-renders without
 * replaying the slide.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AccountGroups } from "../storage/account-groups";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { groupAssignPanel, groupFilterChips } from "./group-controls";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel } from "./parts";

const drawerAccountRow = (
  stored: AccountRef,
  activeId: string | null,
  preferences: WalletPreferences | null,
  groups: AccountGroups,
): string => `
  <li class="drawer-account-item">
    <div class="drawer-account-row">
      <button class="drawer-account" data-switch-account="${escapeHtml(stored.id)}" type="button" aria-pressed="${stored.id === activeId}">
        <span class="option-avatar">${accountAvatar(stored.address)}</span>
        <span class="drawer-copy">
          <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
          <code>${accountLabel(stored.address)}</code>
        </span>
        ${stored.id === activeId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>
      <button class="icon-button ghost drawer-assign" data-assign-toggle="${escapeHtml(stored.id)}" type="button" aria-expanded="false" aria-label="Assign to groups" title="Assign to groups">${icon("folder")}</button>
    </div>
    ${groupAssignPanel(stored, groups)}
  </li>`;

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it. `groupFilter` is the selected group id (null = "All"), narrowing
 * the listed accounts to that group's members.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  groupFilter: string | null = null,
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
          ? `<p class="empty">${activeGroup ? "No accounts in this group yet. Assign one from its folder button." : "No accounts on this network yet. Add one below."}</p>`
          : `<ul class="drawer-list">${visible
              .map((stored) => drawerAccountRow(stored, account?.id ?? null, preferences, groups))
              .join("")}</ul>`
      }
      <div class="drawer-foot">
        <button id="drawer-add-account" class="secondary" type="button">${icon("plus")}Add account</button>
        <button class="menu-row" data-view="account" type="button">
          <span class="menu-icon">${icon("settings")}</span>
          <span class="menu-copy"><strong>Manage accounts</strong></span>
          <span class="menu-chevron">${icon("chevronRight")}</span>
        </button>
      </div>
    </aside>
  </div>`;
};
