/**
 * Left slide-in account drawer opened from the header avatar. Kept lean: it
 * lists this network's single-signer and multisig accounts with identicons and
 * names, marks the selected one,
 * filters by folder/group chips, lets each account be filed into a single
 * folder from the row's inline quick picker,
 * offers "Add account", and links to the dedicated "Manage accounts & groups"
 * view. All group management (create/rename/change-icon/delete and bulk
 * assignment) lives on that view, not here — the drawer carries no group-CRUD
 * controls. Pure template — open/close state and bindings live in ./home-ui.ts,
 * styles in ./styles-home.ts. Rendered closed on every dock screen; the runtime
 * restores the open state (selected group filter, open assign panel) across
 * re-renders without replaying the slide.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import { type AccountGroups, accountGroup } from "../storage/account-groups";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState } from "../ui/content";
import { button, iconButton } from "../ui/controls";
import { menuRow } from "../ui/navigation";
import { groupFilterChips, groupPickerPanel } from "./group-controls";
import { icon } from "./icons";
import { accountAvatar, accountDisplayName, accountLabel, hardwareBadge } from "./parts";

const drawerMultisigRow = (
  record: MultisigRecord,
  proposals: readonly MultisigProposalRecord[],
  selectedId: string | null,
): string => {
  const open = proposals.filter(
    (proposal) => proposal.multisigId === record.id && proposal.state !== "executed",
  ).length;
  return `<li class="drawer-account-item">
    <button class="drawer-account drawer-multisig" data-multisig-select="${escapeHtml(record.id)}" type="button" aria-pressed="${record.id === selectedId}">
      <span class="option-avatar">${accountAvatar(record.address)}</span>
      <span class="drawer-copy">
        <strong>${escapeHtml(record.name ?? "Multisig account")}</strong>
        <code>${escapeHtml(accountLabel(record.address))}</code>
        <span class="account-groups-line">Multisig · ${record.quorum} of ${record.signers.length} signers required${open > 0 ? ` · ${open} open` : ""}</span>
      </span>
      <span class="option-mark">${icon(record.id === selectedId ? "check" : "chevronRight")}</span>
    </button>
  </li>`;
};

const drawerAccountRow = (
  stored: AccountRef,
  activeId: string | null,
  singleSignerSelected: boolean,
  preferences: WalletPreferences | null,
  groups: AccountGroups,
  openAssignId: string | null,
  selectedMultisig: MultisigRecord | null,
): string => {
  const folder = accountGroup(groups, stored.id);
  const assignOpen = stored.id === openAssignId;
  // The row icon reflects the account's folder (its group's chosen glyph), or a
  // muted "no folder" folder when ungrouped; tapping it opens the inline picker.
  const rowGlyph = folder ? folder.icon : "folder";
  const pickerLabel = folder ? `Folder: ${folder.name}` : "No folder — choose one";
  const name = accountDisplayName(stored, preferences);
  const selectedMultisigSigner =
    selectedMultisig?.signers.some((signer) => sameFelt(signer, stored.address)) ?? false;
  return `
  <li class="drawer-account-item">
    <div class="drawer-account-row">
      <button class="drawer-account" data-switch-account="${escapeHtml(stored.id)}" data-active-signer="${stored.id === activeId}"${selectedMultisigSigner ? ' data-selected-multisig-signer="true"' : ""} type="button" aria-pressed="${singleSignerSelected && stored.id === activeId}">
        <span class="option-avatar">${accountAvatar(stored.address)}</span>
        <span class="drawer-copy">
          <span class="drawer-name"><strong>${escapeHtml(name)}</strong>${hardwareBadge(stored)}</span>
          <code>${accountLabel(stored.address)}</code>
          ${selectedMultisigSigner ? `<span class="account-groups-line">Signer for ${escapeHtml(selectedMultisig?.name ?? "selected multisig")}</span>` : ""}
        </span>
        ${singleSignerSelected && stored.id === activeId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>
      ${iconButton({
        attributes: {
          "aria-expanded": String(assignOpen),
          "data-assign-toggle": stored.id,
        },
        className: `drawer-assign${folder ? "" : " is-ungrouped"}`,
        icon: rowGlyph,
        label: `${pickerLabel} for ${name}`,
        title: pickerLabel,
        variant: "ghost",
      })}
    </div>
    ${groupPickerPanel(stored, groups, folder?.id ?? null, assignOpen)}
  </li>`;
};

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it. `groupFilter` is the selected group id (null = "All"), narrowing
 * the listed accounts to that group's members. `openAssignId` keeps one
 * account's quick folder picker expanded across re-renders. Group management is
 * reached through the "Manage accounts & groups" entry, not rendered inline.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  groupFilter: string | null = null,
  openAssignId: string | null = null,
  multisigs: readonly MultisigRecord[] = [],
  proposals: readonly MultisigProposalRecord[] = [],
  selectedMultisigId: string | null = null,
): string => {
  const groups = preferences?.groups ?? [];
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const activeGroup = groupFilter ? groups.find((group) => group.id === groupFilter) : undefined;
  const visible = activeGroup
    ? accounts.filter((stored) => activeGroup.accountIds.includes(stored.id))
    : accounts;
  const shared = groupFilter
    ? []
    : multisigs.filter((record) => record.networkId === status.networkId);
  const selectedMultisig = shared.find((record) => record.id === selectedMultisigId) ?? null;
  const hasVisibleAccounts = visible.length > 0 || shared.length > 0;
  return `
  <div class="drawer-root" data-open="false">
    <div class="drawer-backdrop" data-drawer-close></div>
    <aside class="account-drawer" role="dialog" aria-modal="true" aria-label="Accounts">
      <header class="drawer-head">
        <div class="drawer-title">
          <h2>Accounts</h2>
          <p>${escapeHtml(status.network)}</p>
        </div>
        ${iconButton({
          attributes: { "data-drawer-close": true },
          className: "drawer-close",
          icon: "x",
          label: "Close accounts",
          variant: "ghost",
        })}
      </header>
      ${groupFilterChips(groups, groupFilter)}
      ${
        !hasVisibleAccounts
          ? emptyState(
              activeGroup
                ? "No accounts in this group yet. Open an account's folder button to add it."
                : "No accounts on this network yet. Add one below.",
            )
          : `<ul class="drawer-list">${visible
              .map((stored) =>
                drawerAccountRow(
                  stored,
                  account?.id ?? null,
                  selectedMultisigId === null,
                  preferences,
                  groups,
                  openAssignId,
                  selectedMultisig,
                ),
              )
              .join("")}${shared
              .map((record) => drawerMultisigRow(record, proposals, selectedMultisigId))
              .join("")}</ul>`
      }
      <div class="drawer-foot">
        ${button({
          attributes: { id: "drawer-add-account" },
          icon: "plus",
          label: "Add account",
          variant: "secondary",
        })}
        ${menuRow({
          attributes: { "data-view": "account" },
          icon: "settings",
          label: "Manage accounts & groups",
        })}
      </div>
    </aside>
  </div>`;
};
