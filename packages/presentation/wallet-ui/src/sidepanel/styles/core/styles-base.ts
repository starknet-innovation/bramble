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
    /* Anchored bottom-bar footprint: one source of truth consumed by the dock
       itself, the dock-screen scroll clearance, and the toast stack offset. */
    --bramble-dock-h: calc(${CONTROL.nav} + ${SPACE.sm});
    /* Token fallbacks remain neutral so unverified assets do not acquire a
       decorative identity that could imply trust. */
    --bramble-avatar-0: hsl(0 0% 42%);
    --bramble-avatar-1: hsl(0 0% 52%);
    --bramble-avatar-2: hsl(0 0% 62%);
    --bramble-avatar-3: hsl(0 0% 72%);
  }
  * { box-sizing: border-box; }
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
  /* Dock screens scroll their content UNDER the anchored bottom bar. Reserve
     clearance below the content equal to the bar footprint plus a breathing
     gap, so the last row never hides beneath it at any scroll position. Flow
     screens carry no dock. */
  .screen:not(.flow) { padding-bottom: calc(var(--bramble-dock-h) + ${SPACE.lg}); }

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
  .stack-tight { display: grid; gap: 3px; min-width: 0; }
  .button-row {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    min-width: 0;
  }
  /* Section heads share the 8px horizontal inset of the de-boxed list rows
     beneath them, so headings and row content sit on one left edge. The same
     inset applies to heading rows (a .row leading with an h2) so the Activity
     screen's titles line up with the transaction text below them. */
  .section-head {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
    padding: 0 ${SPACE.sm};
  }
  .section > .row:has(> h2) { padding: 0 ${SPACE.sm}; }
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
  .action-tile {
    align-content: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-text);
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
    .action-tile:not(:disabled):hover { background: var(--bramble-hover); transform: translateY(-2px); }
    .action-tile:not(:disabled):hover .tile-label { color: var(--bramble-text); }
  }
  .action-tile:not(:disabled):active { background: var(--bramble-soft-press); transform: scale(0.97); }
  button.action-tile:disabled { cursor: not-allowed; opacity: 0.4; }
  .tile-icon {
    align-items: center;
    color: var(--bramble-text);
    display: inline-flex;
    justify-content: center;
  }
  .tile-label { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; font-weight: ${WEIGHT.semibold}; }
  .tile-icon .icon {
    height: ${CONTROL.majorIcon};
    stroke-width: 1.85;
    width: ${CONTROL.majorIcon};
  }

  /* Flow screens: back control + goal title */
  .flow-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: 2px 0 ${SPACE.xs};
  }
  .flow-title { display: grid; flex: 1; gap: 1px; min-width: 0; }
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
  button.menu-row, button.option-row, a.menu-row {
    align-items: center;
    background: transparent;
    border-radius: 0;
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
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active {
    background: var(--bramble-soft-press);
  }
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
