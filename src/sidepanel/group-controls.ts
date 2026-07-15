/**
 * Pure templates for the account-groups ("folders") UI, shared across the left
 * account drawer and the manage-accounts flow so every surface renders the same
 * controls from one source: an icon picker, the shared "New group" form, the
 * drawer filter chips, an account's folder icon line, and the per-account
 * single-select folder picker. The group-centric bulk members editor and its "Groups"
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
 * Renders the inline "edit group" form (rename input seeded with the current
 * name, icon picker seeded with the current glyph, save button). Shared by the
 * manage-accounts bulk editor and the drawer's "Manage groups" list so a group's
 * name and icon are edited from one template on every surface. Saving is wired by
 * ./group-ui.ts `bindEditForms`, which chains `renameGroup` then `setGroupIcon`.
 */
export const editGroupForm = (group: AccountGroup): string => `
  <form class="edit-group-form" data-edit-group="${escapeHtml(group.id)}">
    <input class="group-name-input" data-group-name maxlength="64" value="${escapeHtml(group.name)}" autocomplete="off" aria-label="Group name" />
    ${groupIconPicker(group.icon)}
    <button class="secondary small" type="submit" data-save-group="${escapeHtml(group.id)}">${icon("check")}Save changes</button>
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

// One option in the single-select folder picker. `pick` is the group id, or
// "none" for the ungrouped choice; `selected` marks the account's current
// folder. Reuses the .group-toggle styling as the rest of the picker.
const groupPickOption = (
  accountId: string,
  pick: string,
  name: string,
  glyph: string,
  selected: boolean,
): string =>
  `<button class="group-toggle" type="button" data-group-pick="${escapeHtml(pick)}" data-account="${escapeHtml(accountId)}" aria-pressed="${selected}">
    <span class="group-toggle-icon">${glyph}</span>
    <span class="group-toggle-name">${escapeHtml(name)}</span>
    ${selected ? `<span class="group-toggle-mark">${icon("check")}</span>` : ""}
  </button>`;

/**
 * Renders the per-account folder picker: a single-select list of the groups
 * plus a "None" (ungrouped) option, with the account's current folder marked.
 * Choosing an option files the account into exactly that folder (or clears it),
 * so an account is only ever in one group. `open` keeps the picker expanded
 * across re-renders (the open account id is held in the entrypoint), and
 * `currentGroupId` is the account's current folder (null = ungrouped). Creating
 * a group happens on the "Manage accounts & groups" view, not here.
 */
export const groupPickerPanel = (
  account: AccountRef,
  groups: AccountGroups,
  currentGroupId: string | null,
  open: boolean,
): string => `
  <div class="group-assign" data-group-assign="${escapeHtml(account.id)}"${open ? "" : " hidden"}>
    <p class="eyebrow">Folder</p>
    ${
      groups.length === 0
        ? '<p class="hint">No groups yet. Use "Manage accounts &amp; groups" to create one.</p>'
        : `<div class="group-toggle-list">
            ${groupPickOption(account.id, "none", "None", icon("x"), currentGroupId === null)}
            ${groups
              .map((group) =>
                groupPickOption(
                  account.id,
                  group.id,
                  group.name,
                  icon(group.icon),
                  currentGroupId === group.id,
                ),
              )
              .join("")}
          </div>`
    }
  </div>`;
