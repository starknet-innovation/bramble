/**
 * Pure templates for the account-groups ("folders") UI, shared by the left
 * account drawer and the manage-accounts flow so the two entry points render
 * the same controls: an icon picker, filter chips, a per-account assignment
 * panel, and the full groups-management section. Behaviour lives in
 * ./group-ui.ts; styles in ./styles-home.ts.
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
 * `activeFilter` is the selected group id, or null for "All".
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

const groupManagerRow = (group: AccountGroup): string => `
  <li class="group-manage-row">
    <div class="group-manage-head">
      <span class="group-manage-icon">${icon(group.icon)}</span>
      <span class="group-manage-copy">
        <strong>${escapeHtml(group.name)}</strong>
        <span class="hint">${group.accountIds.length} account${group.accountIds.length === 1 ? "" : "s"}</span>
      </span>
      <button class="icon-button danger" type="button" data-remove-group="${escapeHtml(group.id)}" aria-label="Delete ${escapeHtml(group.name)}" title="Delete ${escapeHtml(group.name)}">${icon("x")}</button>
    </div>
    <form class="edit-group-form" data-edit-group="${escapeHtml(group.id)}">
      <input class="group-name-input" data-group-name maxlength="64" value="${escapeHtml(group.name)}" autocomplete="off" aria-label="Group name" />
      ${groupIconPicker(group.icon)}
      <button class="secondary small" type="submit" data-save-group="${escapeHtml(group.id)}">${icon("check")}Save changes</button>
    </form>
  </li>`;

/**
 * Renders the manage-accounts "Groups" section: the list of existing groups
 * with inline rename, icon change, and delete controls, plus a new-group form.
 */
export const groupsSection = (groups: AccountGroups): string => `
  <section class="section">
    <h2>Groups</h2>
    <p class="hint">Organise accounts into named folders. An account can belong to several groups.</p>
    ${
      groups.length === 0
        ? '<p class="empty">No groups yet. Create your first below.</p>'
        : `<ul class="group-manage-list">${groups.map(groupManagerRow).join("")}</ul>`
    }
    ${newGroupForm()}
    <p id="groups-result" role="status"></p>
  </section>`;
