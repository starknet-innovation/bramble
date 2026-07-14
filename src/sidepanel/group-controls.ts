/**
 * Pure templates for the account-groups ("folders") UI, shared across the left
 * account drawer and the manage-accounts flow so every surface renders the same
 * controls from one source: an icon picker, the shared "New group" form, the
 * drawer filter chips, an account's member-group icon line, and the per-account
 * assignment panel. The group-centric bulk members editor and its "Groups"
 * section wrapper live in ./group-members.ts, which reuses the picker and form
 * templates here — the canonical place to rename, re-icon, or delete a group.
 * Behaviour lives in ./group-ui.ts; styles in ./styles-home.ts.
 */
import { escapeHtml } from "../shared/html";
import {
  type AccountGroup,
  type AccountGroupIcon,
  type AccountGroups,
  GROUP_ICONS,
} from "../storage/account-groups";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";

/**
 * Renders the icon grid used by every create/edit-group form. Selection is
 * held in a hidden input (`data-group-icon-value`) that ./group-ui.ts updates
 * as options are pressed; `selected` seeds the initial choice.
 */
export const groupIconPicker = (selected: AccountGroupIcon = "folder"): string => `
  <div class="group-icon-picker" role="radiogroup" aria-label="Group icon">
    ${GROUP_ICONS.map(
      (glyph) =>
        `<button class="group-icon-option" type="button" data-group-icon="${glyph}" aria-pressed="${glyph === selected}" aria-label="${glyph}" title="${glyph}">${icon(glyph)}</button>`,
    ).join("")}
    <input type="hidden" data-group-icon-value value="${escapeHtml(selected)}" />
  </div>`;

/**
 * Renders the inline "new group" form (name input, icon picker, create
 * button). Reused inside assignment panels and the groups-management section.
 */
export const newGroupForm = (): string => `
  <form class="new-group-form">
    <input class="group-name-input" data-group-name maxlength="64" placeholder="New group name" autocomplete="off" aria-label="New group name" />
    ${groupIconPicker()}
    <button class="secondary small" type="submit" data-create-group>${icon("plus")}Create group</button>
  </form>`;

/**
 * Renders the drawer's folder filter chips: an "All" chip plus one per group,
 * each showing the group's chosen icon. `activeFilter` is the selected group id,
 * or null for "All". Selecting a chip narrows the listed accounts to that
 * group's members; renaming, re-iconing, or deleting a group lives on the
 * manage-accounts "Groups" section rather than the cramped drawer chip row.
 * Returns "" when there are no groups — the drawer offers "New group" instead.
 */
export const groupFilterChips = (groups: AccountGroups, activeFilter: string | null): string => {
  if (groups.length === 0) {
    return "";
  }
  const chip = (id: string | null, label: string, glyph: string): string =>
    `<button class="group-chip" type="button" data-group-filter="${escapeHtml(id ?? "all")}" aria-pressed="${(id ?? null) === activeFilter}">${glyph}<span>${escapeHtml(label)}</span></button>`;
  return `<div class="group-chips" role="group" aria-label="Filter by group">
    ${chip(null, "All", icon("wallet"))}
    ${groups.map((group) => chip(group.id, group.name, icon(group.icon))).join("")}
  </div>`;
};

/**
 * Renders the icon line shown on an account row for the groups it belongs to,
 * so every surface reflects real membership (and each group's chosen icon)
 * consistently. `memberGroups` is the subset of groups containing the account;
 * returns "" when the account is in none.
 */
export const accountGroupsLine = (memberGroups: AccountGroups): string =>
  memberGroups.length === 0
    ? ""
    : `<span class="account-groups-line" aria-label="Groups: ${escapeHtml(
        memberGroups.map((group) => group.name).join(", "),
      )}">${memberGroups.map((group) => icon(group.icon)).join("")}</span>`;

const groupToggle = (account: AccountRef, group: AccountGroup): string => {
  const member = group.accountIds.includes(account.id);
  return `<button class="group-toggle" type="button" data-group-toggle="${escapeHtml(group.id)}" data-account="${escapeHtml(account.id)}" aria-pressed="${member}">
    <span class="group-toggle-icon">${icon(group.icon)}</span>
    <span class="group-toggle-name">${escapeHtml(group.name)}</span>
    <span class="group-toggle-mark">${member ? icon("check") : icon("plus")}</span>
  </button>`;
};

/**
 * Renders the per-account group-assignment panel: one membership toggle per
 * group, each showing the group's icon and whether the account is a member.
 * `open` keeps the panel expanded across re-renders (the open account id is held
 * in the entrypoint), so toggling several groups in one pass never collapses it.
 * Creating a group happens from the surface's own "New group" control, not from
 * inside this panel — keeping one create entry per surface.
 */
export const groupAssignPanel = (
  account: AccountRef,
  groups: AccountGroups,
  open: boolean,
): string => `
  <div class="group-assign" data-group-assign="${escapeHtml(account.id)}"${open ? "" : " hidden"}>
    <p class="eyebrow">In groups</p>
    ${
      groups.length === 0
        ? '<p class="hint">No groups yet. Use "New group" below to create your first.</p>'
        : `<div class="group-toggle-list">${groups.map((group) => groupToggle(account, group)).join("")}</div>`
    }
  </div>`;
