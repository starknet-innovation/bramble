/**
 * Flow-chrome and list layer of the side panel stylesheet, split from
 * ./styles-base.ts by the size budget: the flow-screen header (back control,
 * goal title, network pill), grouped lists and their rows, standalone option
 * rows, and the group-terminal action row. Composed immediately after the base
 * layer in ../index.ts, so the cascade order is unchanged.
 */
import { MOTION, RADIUS, SPACE, TYPE } from "@bramble/ui-kit/tokens";

/**
 * Flow-chrome and list stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const LIST_STYLES = `  /* Flow screens: back control + goal title */
  /* Back control, title, network pill on one row, the pill vertically centred
     against the title block. The title column is minmax(0, 1fr) so a long title
     wraps its words rather than sliding under the pill; the pill itself never
     wraps or shrinks. */
  .flow-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: 2px 0 ${SPACE.xs};
  }
  .flow-header > .pill { flex: none; }
  .flow-title { display: grid; flex: 1; gap: 1px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  .flow-title h1 { font-size: ${TYPE.display.size}; }
  .flow-title p {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    overflow-wrap: anywhere;
  }

  /* Grouped lists: ONE soft container per group of related rows, flat rows
     inside split by inset hairline dividers — never a border per row. This is
     the structural backbone of every settings and picker screen: the group
     communicates "these belong together", the divider carries separation, and
     no ring chrome competes with the content. The flex layout is declared on
     rows directly (not inherited): anchor rows (Help & docs) never pass
     through the base button rule. */
  .menu-list, .option-list {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: 0;
    overflow: hidden;
  }
  /* A row inside a group is a cell of the card, not a rounded control of its
     own: it takes no radius, so the group's corners clip the first and last
     fills to the card's curve and a selected or hovered row never shows a
     second, tighter curve against the card edge or its neighbour's divider. */
  :is(.menu-list, .option-list) > :is(button.menu-row, a.menu-row, button.option-row, .option-row-line) {
    border-radius: 0;
  }
  /* A row that is itself a control (select this account) carries its copy
     action beside it on one line, never inside it; the line is the row — it
     carries the selected and hover fill so the copy action sits inside the
     highlight — and the group's inset divider treats it as one. */
  .option-list > .option-row-line > .icon-button { margin-right: ${SPACE.sm}; }
  .option-row-line { border-radius: ${RADIUS.md}; transition: background ${MOTION.pressMs}ms ${MOTION.ease}; }
  .option-row-line:has(> button.option-row[aria-pressed="true"]) { background: var(--bramble-accent-soft); }
  .option-row-line > button.option-row, .option-row-line > button.option-row[aria-pressed="true"] { background: transparent; }
  .menu-list > * + *, .option-list > * + * { position: relative; }
  .menu-list > * + *::before, .option-list > * + *::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    left: ${SPACE.lg};
    position: absolute;
    right: 0;
    top: 0;
  }
  /* A standalone row (Manage tokens, a lone option) is a rounded control;
     inside a grouped list the rule above squares it into a cell. */
  button.menu-row, button.option-row, a.menu-row {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 52px;
    padding: 0 ${SPACE.lg};
    text-align: left;
    text-decoration: none;
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    button.menu-row:not(:disabled):hover, button.option-row:not(:disabled):hover, a.menu-row:hover {
      background: var(--bramble-hover);
    }
    button.option-row[aria-pressed="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); }
    .option-row-line:has(> button.option-row:not(:disabled):hover) { background: var(--bramble-hover); }
    .option-row-line:has(> button.option-row[aria-pressed="true"]:not(:disabled):hover) { background: var(--bramble-accent-soft); }
    .option-row-line > button.option-row:not(:disabled):hover, .option-row-line > button.option-row[aria-pressed="true"]:not(:disabled):hover { background: transparent; }
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active {
    background: var(--bramble-soft-press);
  }
  .option-row-line:has(> button.option-row:not(:disabled):active) { background: var(--bramble-soft-press); }
  .option-row-line > button.option-row:not(:disabled):active { background: transparent; }
  button.option-row[aria-pressed="true"] { background: var(--bramble-accent-soft); }
  /* Action row: a group-terminal action (e.g. "Add account") reads as accent
     text inside the group rather than a standalone boxed button. */
  button.menu-row.row-action { color: var(--bramble-accent); }
  button.menu-row.row-action .menu-icon { color: var(--bramble-accent); }
  .menu-icon, .menu-chevron { color: var(--bramble-muted); display: inline-flex; flex: none; }
  .menu-icon .icon { height: 20px; width: 20px; }
  .avatar {
    border-radius: ${RADIUS.full};
    display: block;
    height: 100%;
    overflow: hidden;
    width: 100%;
  }
  .brand-mark .icon { height: 20px; width: 20px; }
  .brand-mark .brand-glyph { height: 20px; width: 20px; }
  .option-avatar {
    align-items: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    display: inline-flex;
    flex: none;
    height: 36px;
    justify-content: center;
    overflow: hidden;
    width: 36px;
  }
  input[type="file"] { padding: ${SPACE.sm} ${SPACE.md}; }
  .option-mark { color: var(--bramble-accent); display: inline-flex; flex: none; }
  .menu-copy, .option-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .menu-copy strong, .option-copy strong { font-size: ${TYPE.body.size}; font-weight: 600; }
  .menu-value { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; }
  .option-copy code { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; }
  .option-sub { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; }
`;
