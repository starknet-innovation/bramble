/**
 * Account-group (folder) layer of the side panel stylesheet: the drawer's
 * filter chips, the per-account assignment panel, the icon picker, the
 * manage-accounts group accordion with its bulk members editor, and the
 * account-names list that sits above it on the same screen. Split from
 * ./styles-home.ts to keep both layers within the size budget; composed just
 * before the home layer in ./styles.ts so home's reduced-motion block still
 * wins over everything here.
 */
import { CONTROL, RADIUS, SPACE, TYPE } from "@bramble/ui-kit/tokens";

/**
 * Group-management stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const GROUP_STYLES = `
  /* Account groups (folders): filter chips, per-account assignment panel, the
     icon picker grid, and the manage-accounts group list. Calm, hairline,
     skin-token only — matching the drawer aesthetic. */
  .group-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 2px; }
  button.group-chip {
    align-items: center;
    background: var(--bramble-soft);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 650;
    gap: 5px;
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
  }
  button.group-chip .icon { height: 14px; width: 14px; }
  /* Selected chips/toggles keep their accent-soft state under the pointer: the
     pressed-state hover rules below outrank the resting hover rules, so
     hovering a selected control never visually deselects it. */
  @media (hover: hover) and (pointer: fine) {
    button.group-chip:not(:disabled):hover { background: var(--bramble-hover); color: var(--bramble-text); }
    button.group-chip[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  }
  button.group-chip[aria-pressed="true"] { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  .drawer-account-item { display: grid; gap: 4px; }
  .drawer-account-row, .option-row-line { align-items: center; display: flex; gap: 6px; }
  .drawer-account-row .drawer-account, .option-row-line .option-row { flex: 1; min-width: 0; }
  button.drawer-assign { flex: none; }
  /* Ungrouped rows show a muted folder as a "pick a folder" affordance; a filed
     account shows its folder's icon at full ink. */
  button.drawer-assign.is-ungrouped { color: var(--bramble-muted); }
  .option-group-item { display: grid; gap: 4px; }
  .option-name { align-items: center; display: flex; gap: 6px; min-width: 0; }
  .option-name strong { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .account-groups-line { display: inline-flex; flex: none; gap: 4px; }
  .account-groups-line .icon { color: var(--bramble-muted); height: 13px; width: 13px; }
  .group-assign {
    background: var(--bramble-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.sm};
  }
  .group-assign .eyebrow { margin: 0; }
  .group-toggle-list { display: grid; gap: 4px; }
  button.group-toggle {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    button.group-toggle:not(:disabled):hover { background: var(--bramble-hover); }
    button.group-toggle[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); }
  }
  button.group-toggle[aria-pressed="true"] { background: var(--bramble-accent-soft); }
  .group-toggle-icon { align-items: center; color: var(--bramble-muted); display: inline-flex; }
  .group-toggle-icon .icon { height: 16px; width: 16px; }
  .group-toggle-name { flex: 1; font-size: ${TYPE.body.size}; overflow: hidden; text-align: left; text-overflow: ellipsis; text-wrap: nowrap; }
  .group-toggle-mark .icon { height: 16px; width: 16px; }
  button.group-toggle[aria-pressed="true"] .group-toggle-mark .icon { color: var(--bramble-accent); }
  .new-group-form, .edit-group-form { display: grid; gap: ${SPACE.sm}; }
  .group-name-input {
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  .group-icon-picker {
    display: grid;
    gap: 4px;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  button.group-icon-option {
    align-items: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.sm};
    color: var(--bramble-muted);
    display: inline-flex;
    justify-content: center;
    min-height: ${CONTROL.hitSmall};
    padding: 0;
  }
  button.group-icon-option .icon { height: 18px; width: 18px; }
  @media (hover: hover) and (pointer: fine) {
    button.group-icon-option:not(:disabled):hover { background: var(--bramble-hover); color: var(--bramble-text); }
    button.group-icon-option[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  }
  button.group-icon-option[aria-pressed="true"] { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  /* Account names: one row per account — avatar, the name field with the
     account's address and folders beneath it, and its own save control. The
     field carries the generated name as a placeholder, so an unnamed account
     still reads as the name the rest of the wallet shows. */
  .account-name-list {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .account-name-row {
    align-items: start;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: ${SPACE.sm};
    position: relative;
  }
  .account-name-row + .account-name-row::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    left: ${SPACE.sm};
    position: absolute;
    right: ${SPACE.sm};
    top: 0;
  }
  .account-name-row > .option-avatar { margin-top: 4px; }
  .account-name-actions { align-self: start; display: flex; gap: 4px; margin-top: 4px; }
  .account-name-copy { display: grid; gap: 4px; min-width: 0; }
  .account-name-copy label { display: grid; }
  .account-name-copy input {
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.sm};
    color: var(--bramble-text);
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  .account-name-meta {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: 4px;
    min-width: 0;
  }
  .account-name-meta code { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .group-manage-list {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .group-manage-row { display: grid; position: relative; }
  .group-manage-row + .group-manage-row::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    left: ${SPACE.lg};
    position: absolute;
  }
  .group-manage-icon { align-items: center; color: var(--bramble-muted); display: inline-flex; }
  .group-manage-copy { display: grid; flex: 1; gap: 1px; min-width: 0; text-align: left; }
  .group-manage-copy strong { font-size: ${TYPE.body.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  /* Two-tap delete confirm: the first tap arms the control and reveals an
     explicit "Delete?" label beside the icon; a second tap deletes. */
  button[data-remove-group].is-confirming {
    color: var(--bramble-danger);
    gap: 4px;
    padding: 0 ${SPACE.sm};
    width: auto;
  }
  button[data-remove-group].is-confirming::after {
    content: "Delete?";
    font-size: ${TYPE.caption.size};
    font-weight: 650;
  }

  /* Group-centric bulk members editor: an expandable header per group, then a
     roomy checklist of every wallet account. Hairline + skin-token only. */
  button.group-expand {
    align-items: center;
    background: transparent;
    border-radius: 0;
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 52px;
    padding: 0 ${SPACE.lg};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    button.group-expand:not(:disabled):hover { background: var(--bramble-hover); }
    button.group-expand[aria-expanded="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); }
  }
  button.group-expand[aria-expanded="true"] { background: var(--bramble-accent-soft); }
  button.group-expand[aria-expanded="true"] .group-manage-icon { color: var(--bramble-accent); }
  .group-expand-mark { align-items: center; color: var(--bramble-muted); display: inline-flex; flex: none; }
  .group-expand-mark .icon { height: 16px; width: 16px; }
  .group-members {
    background: var(--bramble-sunken);
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .group-members-head { align-items: center; display: flex; gap: ${SPACE.sm}; }
  .group-members-head .eyebrow { flex: 1; margin: 0; }
  .account-check-list { display: grid; gap: 4px; max-height: 320px; overflow-y: auto; }
  button.account-check {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 48px;
    padding: 0 ${SPACE.sm};
    position: relative;
    text-align: left;
    width: 100%;
  }
  .account-check-list > * + *::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    left: ${SPACE.sm};
    position: absolute;
  }
  @media (hover: hover) and (pointer: fine) {
    button.account-check:not(:disabled):hover { background: var(--bramble-hover); }
    button.account-check[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); }
  }
  button.account-check[aria-pressed="true"] { background: var(--bramble-accent-soft); }
  .account-check .option-avatar { flex: none; }
  .account-check-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .account-check-copy strong { font-size: ${TYPE.body.size}; font-weight: 650; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .account-check-copy code { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; }
  .account-check-net {
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    flex: none;
    font-size: ${TYPE.caption.size};
    font-weight: 650;
    max-width: 92px;
    overflow: hidden;
    padding: 2px ${SPACE.sm};
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-check-mark { flex: none; }
  .account-check-mark .icon { color: var(--bramble-muted); height: 18px; width: 18px; }
  button.account-check[aria-pressed="true"] .account-check-mark .icon { color: var(--bramble-accent); }
`;
