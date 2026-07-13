/**
 * Pure templates for the account-groups ("folders") UI, shared by the left
 * account drawer and the manage-accounts flow so the two entry points render
 * the same controls: an icon picker, the shared "New group" form, filter chips
 * (with an edit affordance on the active chip), and the per-account assignment
 * panel. The group-centric bulk members editor and its "Groups" section wrapper
 * live in ./group-members.ts, which reuses the picker and form templates here.
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
 * Renders the drawer's folder filter chips: an "All" chip plus one per group.
 * `activeFilter` is the selected group id, or null for "All". The chip matching
 * the active filter grows an edit affordance (`data-edit-group-view`) that jumps
 * to the manage-accounts flow and opens that group's bulk members editor — a
 * fast path into bulk editing without duplicating the heavy editor in the
 * cramped drawer.
 */
export const groupFilterChips = (groups: AccountGroups, activeFilter: string | null): string => {
  if (groups.length === 0) {
    return "";
  }
  const chip = (id: string | null, label: string, glyph: string): string =>
    `<button class="group-chip" type="button" data-group-filter="${escapeHtml(id ?? "all")}" aria-pressed="${(id ?? null) === activeFilter}">${glyph}<span>${escapeHtml(label)}</span></button>`;
  const groupChip = (group: AccountGroup): string => {
    const base = chip(group.id, group.name, icon(group.icon));
    if (group.id !== activeFilter) {
      return base;
    }
    return `<span class="group-chip-active">${base}<button class="icon-button ghost group-chip-edit" type="button" data-edit-group-view="${escapeHtml(group.id)}" aria-label="Edit ${escapeHtml(group.name)} members" title="Edit members">${icon("settings")}</button></span>`;
  };
  return `<div class="group-chips" role="group" aria-label="Filter by group">
    ${chip(null, "All", icon("wallet"))}
    ${groups.map(groupChip).join("")}
  </div>`;
};

const groupToggle = (account: AccountRef, group: AccountGroup): string => {
  const member = group.accountIds.includes(account.id);
  return `<button class="group-toggle" type="button" data-group-toggle="${escapeHtml(group.id)}" data-account="${escapeHtml(account.id)}" aria-pressed="${member}">
    <span class="group-toggle-icon">${icon(group.icon)}</span>
    <span class="group-toggle-name">${escapeHtml(group.name)}</span>
    <span class="group-toggle-mark">${member ? icon("check") : icon("plus")}</span>
  </button>`;
};

/**
 * Renders the collapsed per-account group-assignment panel: a membership
 * toggle per group and a "new group" affordance. Hidden until ./group-ui.ts
 * opens it from the account's folder button.
 */
export const groupAssignPanel = (account: AccountRef, groups: AccountGroups): string => `
  <div class="group-assign" data-group-assign="${escapeHtml(account.id)}" hidden>
    <p class="eyebrow">Groups</p>
    ${
      groups.length === 0
        ? '<p class="hint">No groups yet. Create one below to start organising.</p>'
        : `<div class="group-toggle-list">${groups.map((group) => groupToggle(account, group)).join("")}</div>`
    }
    ${newGroupForm()}
  </div>`;
