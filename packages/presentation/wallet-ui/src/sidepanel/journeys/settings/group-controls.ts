/**
 * Pure templates for the account-groups ("folders") UI, shared across the left
 * account drawer and the manage-accounts flow so every surface renders the same
 * controls from one source: an icon picker, the shared "New group" form, and an
 * account's folder icon line. The group-centric bulk members editor and its
 * "Groups" section wrapper live in ./group-members.ts, which reuses the form
 * templates here — the canonical place to rename, re-icon, or delete a group.
 * Behaviour lives in ./group-ui.ts; styles in ./styles-home.ts.
 */
import { escapeHtml } from "@bramble/core/html";
import {
  type AccountGroup,
  type AccountGroupIcon,
  type AccountGroups,
  GROUP_ICONS,
} from "@bramble/settings/groups";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";

import { icon } from "../../shared/icons";

/**
 * Renders the icon grid used by every create/edit-group form. Selection is
 * held in a hidden input (`data-group-icon-value`) that ./group-ui.ts updates
 * as options are pressed; `selected` seeds the initial choice.
 */
const groupIconPicker = (selected: AccountGroupIcon = "folder"): string => `
  <div class="group-icon-picker" role="radiogroup" aria-label="Folder icon">
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
    ${inputControl({
      ariaLabel: "New folder name",
      attributes: { "data-group-name": true },
      autocomplete: "off",
      className: "group-name-input",
      maxlength: 64,
      placeholder: "Folder name",
    })}
    ${groupIconPicker()}
    ${button({
      attributes: { "data-create-group": true },
      icon: "plus",
      label: "Create folder",
      size: "small",
      type: "submit",
      variant: "secondary",
    })}
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
    ${inputControl({
      ariaLabel: "Folder name",
      attributes: { "data-group-name": true },
      autocomplete: "off",
      className: "group-name-input",
      maxlength: 64,
      value: group.name,
    })}
    ${groupIconPicker(group.icon)}
    ${button({
      attributes: { "data-save-group": group.id },
      icon: "check",
      label: "Save changes",
      size: "small",
      type: "submit",
      variant: "secondary",
    })}
  </form>`;

/**
 * Renders the icon line shown on an account row for the groups it belongs to,
 * so every surface reflects real membership (and each group's chosen icon)
 * consistently. `memberGroups` is the subset of groups containing the account;
 * returns "" when the account is in none.
 */
export const accountGroupsLine = (memberGroups: AccountGroups): string =>
  memberGroups.length === 0
    ? ""
    : `<span class="account-groups-line" aria-label="Folders: ${escapeHtml(
        memberGroups.map((group) => group.name).join(", "),
      )}">${memberGroups.map((group) => icon(group.icon)).join("")}</span>`;
