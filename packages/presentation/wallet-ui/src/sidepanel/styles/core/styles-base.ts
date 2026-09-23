/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, the account-bar header, portfolio hero, action
 * tiles, dock, flow chrome, and list rows. Composed with the component layer
 * in ./styles.ts and the home/motion layer in ./styles-home.ts.
 *
 * Surface rules ("Clean Mono"): solid fills only (no gradients, no glass),
 * structure carried by gentle low elevation and hairline edges; list rows are
 * flat fills separated by space, never boxes nested inside boxes. Primary
 * actions, active states, and focus use high-contrast neutral ink; compact
 * identity marks and positive/danger semantics are the restrained exceptions.
 */
import {
  CONTROL,
  FONT,
  MOTION,
  RADIUS,
  SIZE,
  SPACE,
  TRACKING,
  TYPE,
  WEIGHT,
} from "@bramble/ui-kit/tokens";
import { DOCK_OFFSET, DOCK_PADDING } from "./styles-dock";

/**
 * Base stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const BASE_STYLES = `

  :root {
    /* Default to the dark scheme of the default midnight skin; the entrypoint
       pins the resolved scheme (dark / light) inline before first paint. */
    color-scheme: dark;
    --bramble-font-mono: ${FONT.mono};
    --bramble-font-ui: ${FONT.ui};
    /* Recessed group fill (tab tracks, permission/sign panels). */
    --bramble-soft: var(--bramble-sunken);
    --bramble-hover: color-mix(in srgb, var(--bramble-text) 6%, var(--bramble-elevated));
    --bramble-soft-press: color-mix(in srgb, var(--bramble-text) 11%, var(--bramble-elevated));
    --bramble-focus-ring: color-mix(in srgb, var(--bramble-accent) 72%, var(--bramble-bg));
    --bramble-accent-hover: color-mix(in srgb, var(--bramble-text) 10%, var(--bramble-accent));
    --bramble-accent-press: color-mix(in srgb, var(--bramble-text) 18%, var(--bramble-accent));
    /* The action tint stays whisper-quiet — enough to read as "active" without
       becoming a second field of contrast. */
    --bramble-accent-soft: color-mix(in srgb, var(--bramble-accent) 13%, var(--bramble-panel));
    --bramble-positive-soft: color-mix(in srgb, var(--bramble-positive) 13%, var(--bramble-panel));
    --bramble-danger-soft: color-mix(in srgb, var(--bramble-danger) 12%, var(--bramble-panel));
    --bramble-shadow: var(--bramble-elev-lg);
    --bramble-shadow-sm: var(--bramble-elev-sm);
    /* Floating-dock footprint from the panel's bottom edge — the pill (a 44px
       root plus its padding) and the gap beneath it — one source of truth for
       the dock-screen scroll clearance and the toast stack offset. */
    --bramble-dock-h: calc(${CONTROL.dockItem} + ${DOCK_PADDING} * 2 + ${DOCK_OFFSET});
    /* Token fallbacks remain neutral so unverified assets do not acquire a
       decorative identity that could imply trust. */
    --bramble-avatar-0: hsl(0 0% 42%);
    --bramble-avatar-1: hsl(0 0% 52%);
    --bramble-avatar-2: hsl(0 0% 62%);
    --bramble-avatar-3: hsl(0 0% 72%);
  }
  * { box-sizing: border-box; }
  /* The document is the scroll container — .shell is min-height: 100vh and
     nothing between it and the viewport scrolls — so any row that grows past
     the viewport summons the document scrollbar. Without a reserved gutter the
     scrollbar takes its width from the content box and every element on the
     screen reflows narrower, which reads as the whole UI shifting sideways.
     The token rows are <details> elements: expanding one is exactly that case. */
  html { scrollbar-gutter: stable; }
  html, body, #app {
    max-width: 100%;
    min-height: 100%;
    min-width: 0;
    width: 100%;
  }
  body {
    background: var(--bramble-bg);
    color: var(--bramble-text);
    font-family: var(--bramble-font-ui);
    font-size: ${TYPE.body.size};
    -webkit-font-smoothing: antialiased;
    line-height: ${TYPE.body.line};
    margin: 0;
    overscroll-behavior-y: none;
    overflow-x: hidden;
  }
  body.popup-surface {
    height: 600px;
    width: 380px;
  }
  body.popup-surface #app { min-height: 600px; }
  h1, h2, h3, p, ul { margin: 0; }
  ul { list-style: none; padding: 0; }
  h1 { font-size: ${TYPE.display.size}; font-weight: 700; letter-spacing: -0.02em; line-height: ${TYPE.display.line}; }
  h2 { font-size: ${TYPE.title.size}; font-weight: 700; letter-spacing: -0.01em; line-height: ${TYPE.title.line}; }
  p { color: var(--bramble-muted); }
  .shell {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.lg};
    max-width: 100%;
    min-height: 100vh;
    min-width: 0;
    padding: ${SPACE.md} ${SPACE.lg} ${SPACE.md};
    width: 100%;
  }
  .screen {
    align-content: start;
    display: grid;
    flex: 1;
    gap: ${SPACE.lg};
    max-width: 100%;
    min-width: 0;
    width: 100%;
  }
  .screen > * { max-width: 100%; min-width: 0; }
  /* Dock screens scroll their content UNDER the anchored bottom bar. With the
     shell's own bottom padding, the clearance is exactly the bar footprint, so
     a screen scrolls only once its content would reach the pill. Any breathing
     gap reserved on top of that is space the user never sees, and it made a
     screen whose content already cleared the dock scroll by a few pixels. At
     the end of a long screen the last row meets the pill's edge, and the
     pill's shadow separates the two. Flow screens carry no dock. */
  .screen:not(.flow) { padding-bottom: calc(var(--bramble-dock-h) - ${SPACE.md}); }
  /* An empty status line that ends a dock screen holds nothing yet, and there
     is nothing below it to keep from shifting, so it takes no room: out of flow
     it drops both its reserved line and the grid gap before it. It stays in the
     document, so the live region still announces a message written into it. */
  .screen:not(.flow) > [role="status"]:empty:last-child,
  .screen:not(.flow) > :last-child > [role="status"]:empty:last-child { position: absolute; }

  /* Layout primitives */
  .row, .address-line, .context-line, .callout, .token-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .row, .address-line { justify-content: space-between; }
  .row.wrap { flex-wrap: wrap; justify-content: flex-start; }
  .stack { display: grid; gap: ${SPACE.sm}; }
  /* Single-column text stacks beside fixed-width controls. The column is
     minmax(0, 1fr), not the implicit auto track, so an unbreakable word (a dapp
     origin, a saved label) can never widen the row past its card and push the
     trailing control under the card's overflow clip at narrow panel widths;
     the word wraps as a last resort instead. */
  .stack-tight { display: grid; gap: 3px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  .stack-tight > * { min-width: 0; overflow-wrap: anywhere; }
  .button-row {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    min-width: 0;
  }
  /* Section heads sit on the page's text column with no inset of their own:
     de-boxed list rows (tokens, activity) put their content on that same
     column and bleed only their hover fill past it, so a heading, its rows,
     and the cards around them share one left edge. */
  .section-head {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
  }
  .section-head h2 { font-size: ${TYPE.body.size}; font-weight: 700; }
  .activity-head h1 {
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: ${TRACKING.display};
    line-height: ${TYPE.display.line};
  }
  .eyebrow {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Header: avatar-led account trigger (opens the drawer), ghost actions */
  .wallet-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    justify-content: space-between;
    padding: 2px 0 ${SPACE.xs};
  }
  button.account-trigger {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--bramble-text);
    display: flex;
    flex: 0 1 auto;
    gap: 10px;
    justify-content: flex-start;
    min-height: 0;
    min-width: 0;
    padding: 4px 12px 4px 4px;
    text-align: left;
  }
  @media (hover: hover) and (pointer: fine) {
    button.account-trigger:not(:disabled):hover { background: var(--bramble-hover); }
  }
  button.account-trigger:not(:disabled):active { background: var(--bramble-soft-press); }
  .brand-mark {
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
  .account-meta { display: grid; gap: 1px; min-width: 0; }
  .account-name {
    align-items: center;
    display: flex;
    gap: 4px;
    min-width: 0;
  }
  .account-name strong {
    color: var(--bramble-text);
    font-size: ${TYPE.body.size};
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-name .icon {
    color: var(--bramble-muted);
    flex: none;
    height: 12px;
    transition: transform ${MOTION.tabMs}ms ${MOTION.ease};
    width: 12px;
  }
  .account-trigger[aria-expanded="true"] .account-name .icon { transform: rotate(180deg); }
  .account-net {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-net .dot { flex: none; height: 6px; width: 6px; }
  .account-network-label { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .account-net.degraded .dot {
    animation: network-status-pulse 2400ms var(--ease-in-out) infinite;
    background: var(--bramble-warning);
  }
  @keyframes network-status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.42; }
  }
  .header-actions { align-items: center; display: flex; flex: none; gap: ${SPACE.xs}; }

  /* Portfolio hero: only the value and its time-bound change remain. Account
     identity already lives in the persistent header, so repeating the address
     and a "Total balance" label here would dilute the number's authority. */
  .hero {
    display: grid;
    gap: 6px;
    justify-items: center;
    padding: ${SPACE.md} 0 0;
    text-align: center;
  }
  /* The total carries real presence: large, heavy, tightly tracked, optically
     sized, and tabular so digits never jitter as prices stream. */
  .hero-total {
    color: var(--bramble-text);
    font-optical-sizing: auto;
    font-size: ${TYPE.portfolio.size};
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    letter-spacing: ${TRACKING.amount};
    line-height: ${TYPE.portfolio.line};
  }
  /* 24h delta: coloured magnitude (green up / red down) beside a muted
     "percent · 24h" window; tabular so digits never jitter as prices stream. */
  .hero-change {
    align-items: center;
    display: inline-flex;
    font-size: ${TYPE.label.size};
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    gap: 6px;
  }
  .hero-change .hero-change-amt { color: var(--bramble-positive); }
  .hero-change.down .hero-change-amt { color: var(--bramble-danger); }
  .hero-change .hero-change-win { color: var(--bramble-muted); font-weight: 500; }
  /* Shielded-balance qualifier stays quiet beneath the total; network
     freshness now belongs to the persistent header status. */
  .hero-stale {
    align-items: center;
    color: var(--bramble-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 500;
    gap: 5px;
  }
  .hero-stale .icon { height: 13px; width: 13px; }

  /* The frequent money actions are equal rounded-square tools. Their common
     shape makes the row instantly scannable; distinctive glyph silhouettes,
     not decorative colour, distinguish the jobs. */
  .home-actions { display: grid; gap: ${SPACE.md}; }
  .action-row {
    display: grid;
    gap: ${SPACE.sm};
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
  }
  /* The four home actions wear the floating dock's selected-root treatment —
     the accent's soft tint with accent ink, flat, no shadow — so the two
     pieces of chrome on the home screen read as one family. Hover and press
     stay on-family: a little more accent layered over the soft tint (the
     accent-side twin of the neutral --bramble-hover / --bramble-soft-press
     recipes), never the neutral hover fill. */
  .action-tile {
    align-content: center;
    background: var(--bramble-accent-soft);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-accent);
    display: grid;
    gap: ${SPACE.xs};
    justify-items: center;
    min-height: ${SIZE.actionTile};
    padding: ${SPACE.sm} ${SPACE.xs};
    text-decoration: none;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    .action-tile:not(:disabled):hover {
      background: color-mix(in srgb, var(--bramble-accent) 6%, var(--bramble-accent-soft));
      transform: translateY(-2px);
    }
  }
  .action-tile:not(:disabled):active {
    background: color-mix(in srgb, var(--bramble-accent) 11%, var(--bramble-accent-soft));
    transform: scale(0.97);
  }
  button.action-tile:disabled { cursor: not-allowed; opacity: 0.4; }
  .tile-icon {
    align-items: center;
    color: var(--bramble-accent);
    display: inline-flex;
    justify-content: center;
  }
  .tile-label { color: var(--bramble-accent); font-size: ${TYPE.caption.size}; font-weight: ${WEIGHT.semibold}; }
  .tile-icon .icon {
    height: ${CONTROL.majorIcon};
    stroke-width: 1.85;
    width: ${CONTROL.majorIcon};
  }

  /* Flow screens: back control + goal title */
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
