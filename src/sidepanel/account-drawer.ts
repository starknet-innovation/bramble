/**
 * Left slide-in account drawer opened from the header avatar. Lists this
 * network's accounts with identicons and names, marks the active one, and
 * offers add-account plus a jump into full account management. Pure template —
 * open/close state and bindings live in ./home-ui.ts, styles in
 * ./styles-home.ts. Rendered closed on every dock screen; the runtime restores
 * the open state across re-renders without replaying the slide.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel } from "./parts";

const drawerAccountRow = (
  stored: AccountRef,
  activeId: string | null,
  preferences: WalletPreferences | null,
): string => `
  <li>
    <button class="drawer-account" data-switch-account="${escapeHtml(stored.id)}" type="button" aria-pressed="${stored.id === activeId}">
      <span class="option-avatar">${accountAvatar(stored.address)}</span>
      <span class="drawer-copy">
        <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
        <code>${accountLabel(stored.address)}</code>
      </span>
      ${stored.id === activeId ? `<span class="option-mark">${icon("check")}</span>` : ""}
    </button>
  </li>`;

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
): string => {
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
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
      ${
        accounts.length === 0
          ? '<p class="empty">No accounts on this network yet. Add one below.</p>'
          : `<ul class="drawer-list">${accounts
              .map((stored) => drawerAccountRow(stored, account?.id ?? null, preferences))
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
