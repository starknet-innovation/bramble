/**
 * Folder sections for the account drawer: every account is listed under the
 * folder it belongs to, rather than in one flat list with a per-row picker.
 *
 * An account in no folder is shown in the home folder ("My accounts"), so a new
 * account appears there without anything being written; filing it elsewhere is
 * what writes. The archive sorts last and starts collapsed, because it is where
 * accounts go to be out of the way — the accounts inside it are otherwise
 * ordinary, and nothing else in the wallet treats them differently.
 *
 * Pure template. Drag-and-drop behaviour lives in ../journeys/settings/group-ui.
 */

import { escapeHtml } from "@bramble/core/html";
import {
  type AccountGroup,
  type AccountGroups,
  DEFAULT_GROUP_IDS,
  displayedAccountGroup,
} from "@bramble/settings/groups";
import { button } from "@bramble/ui-kit/controls";
import { inputControl } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { icon } from "../shared/icons";

/**
 * The folders collapsed when the drawer is first painted. The archive is the one
 * folder that starts closed: it is where accounts go to be out of the way. Read
 * by the drawer template's default, the dashboard's default, and the runtime's
 * folder state, so all three agree without a second literal.
 */
export const INITIAL_COLLAPSED_FOLDERS: readonly string[] = [DEFAULT_GROUP_IDS.archived];

/** One folder with the accounts that belong to it, in drawer order. */
export type FolderSection = {
  readonly group: AccountGroup;
  readonly accounts: readonly AccountRef[];
};

/**
 * Splits accounts across the folders. Membership is single, so each account
 * appears once; one whose folder is unknown or unset falls to the home folder,
 * which is why an account never disappears from the drawer.
 */
export const folderSections = (
  groups: AccountGroups,
  accounts: readonly AccountRef[],
): readonly FolderSection[] =>
  groups.map((group) => ({
    accounts: accounts.filter(
      (stored) => displayedAccountGroup(groups, stored.id)?.id === group.id,
    ),
    group,
  }));

const folderCount = (count: number): string =>
  count === 0 ? "Empty" : `${count} account${count === 1 ? "" : "s"}`;

/**
 * Renders one folder: its heading, and its accounts as rendered by the caller.
 * The whole section is the drop target, so an account can be dropped onto an
 * empty folder as well as between rows.
 */
export const folderSection = (section: FolderSection, rows: string, collapsed: boolean): string => `
  <section class="drawer-folder" data-folder="${escapeHtml(section.group.id)}" data-collapsed="${String(collapsed)}">
    <button class="drawer-folder-head" type="button" data-folder-toggle="${escapeHtml(section.group.id)}"
      aria-expanded="${String(!collapsed)}">
      <span class="drawer-folder-icon">${icon(section.group.icon)}</span>
      <span class="drawer-folder-copy">
        <strong>${escapeHtml(section.group.name)}</strong>
        <small>${escapeHtml(folderCount(section.accounts.length))}</small>
      </span>
      <span class="drawer-folder-mark">${icon(collapsed ? "chevronRight" : "chevronDown")}</span>
    </button>
    <ul class="drawer-list"${collapsed ? " hidden" : ""}>${
      section.accounts.length === 0
        ? '<li class="drawer-folder-empty">Drag an account here.</li>'
        : rows
    }</ul>
  </section>`;

/**
 * Renders the create-a-folder control under the last folder: a button that
 * becomes a name field in place, so the whole flow stays in the drawer.
 */
export const addFolderControl = (open: boolean): string => `
  <div class="drawer-add-folder" data-add-folder-root>
    ${
      open
        ? `<form id="drawer-folder-form" class="drawer-folder-form">
            ${inputControl({
              ariaLabel: "Folder name",
              attributes: { id: "drawer-folder-name", name: "folderName" },
              autocomplete: "off",
              maxlength: 64,
              placeholder: "Folder name",
            })}
            ${button({ attributes: { id: "drawer-folder-create" }, label: "Add", size: "small", type: "submit" })}
            ${button({
              attributes: { id: "drawer-folder-cancel" },
              label: "Cancel",
              size: "small",
              variant: "ghost",
            })}
          </form>`
        : button({
            attributes: { id: "drawer-add-folder" },
            icon: "plus",
            label: "Add folder",
            size: "small",
            variant: "ghost",
          })
    }
    <p class="drawer-folder-error" id="drawer-folder-result" role="status"></p>
  </div>`;
