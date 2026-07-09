/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, the account-bar header, portfolio hero, action
 * tiles, dock, flow chrome, and list rows. Composed with the component layer
 * in ./styles.ts and the home/motion layer in ./styles-home.ts.
 *
 * Surface rules ("Clean Mono"): solid fills only (no gradients, no glass),
 * structure carried by gentle low elevation and hairline edges; list rows are
 * flat fills separated by space, never boxes nested inside boxes. The single
 * emerald accent is reserved for the primary CTA, active states, and positive
 * deltas — everything else stays in the near-mono neutral palette.
 */
import { CONTROL, FONT, MOTION, RADIUS, SPACE, TRACKING, TYPE } from "../ui/tokens";

/**
 * Base stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const BASE_STYLES = `

  :root {
    color-scheme: dark;
    --mc-font-mono: ${FONT.mono};
    --mc-font-ui: ${FONT.ui};
    /* Recessed group fill (tab tracks, permission/sign panels). */
    --mc-soft: var(--mc-sunken);
    --mc-hover: color-mix(in srgb, var(--mc-text) 6%, var(--mc-elevated));
    --mc-soft-press: color-mix(in srgb, var(--mc-text) 11%, var(--mc-elevated));
    --mc-accent-hover: color-mix(in srgb, var(--mc-text) 10%, var(--mc-accent));
    --mc-accent-press: color-mix(in srgb, var(--mc-text) 18%, var(--mc-accent));
    /* The accent tint stays whisper-quiet — enough to read as "active" without
       becoming a second colour field. */
    --mc-accent-soft: color-mix(in srgb, var(--mc-accent) 13%, var(--mc-panel));
    --mc-positive-soft: color-mix(in srgb, var(--mc-positive) 13%, var(--mc-panel));
    --mc-danger-soft: color-mix(in srgb, var(--mc-danger) 12%, var(--mc-panel));
    --mc-faint: color-mix(in srgb, var(--mc-muted) 58%, var(--mc-bg));
    --mc-shadow: var(--mc-elev-lg);
    --mc-shadow-sm: var(--mc-elev-sm);
    /* Flat per-account avatar palette: four restrained mid-tone fills (the
       first is the brand emerald) plus one dark ink for the glyph. Mid-tone by
       design so the same fills and ink read on both skins; defined once here as
       tokens so avatar chips carry no scattered colour literals. */
    --mc-avatar-0: hsl(152 55% 45%);
    --mc-avatar-1: hsl(222 62% 60%);
    --mc-avatar-2: hsl(28 78% 55%);
    --mc-avatar-3: hsl(265 52% 62%);
    --mc-avatar-ink: hsl(206 34% 13%);
  }
  * { box-sizing: border-box; }
  html, body, #app { min-height: 100%; }
  body {
    background: var(--mc-bg);
    color: var(--mc-text);
    font-family: var(--mc-font-ui);
    font-size: ${TYPE.body.size};
    -webkit-font-smoothing: antialiased;
    line-height: ${TYPE.body.line};
    margin: 0;
    overflow-x: hidden;
  }
  h1, h2, h3, p, ul { margin: 0; }
  ul { list-style: none; padding: 0; }
  h1 { font-size: ${TYPE.title.size}; font-weight: 700; letter-spacing: -0.02em; line-height: ${TYPE.title.line}; }
  h2 { font-size: ${TYPE.title.size}; font-weight: 700; letter-spacing: -0.01em; line-height: ${TYPE.title.line}; }
  p { color: var(--mc-muted); }
  .shell {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.lg};
    min-height: 100vh;
    padding: ${SPACE.md} ${SPACE.lg} ${SPACE.md};
  }
  .screen { align-content: start; display: grid; flex: 1; gap: ${SPACE.lg}; }
  /* Dock screens scroll their content UNDER the floating dock. Reserve
     clearance below the content equal to the dock footprint (nav height + its
     padding + its bottom offset) plus a gap, so the last row never hides beneath
     the sticky dock at any scroll position. Flow screens carry no dock. */
  .screen:not(.flow) { padding-bottom: calc(${CONTROL.nav} + ${SPACE.xl} + ${SPACE.sm}); }

  /* Layout primitives */
  .row, .address-line, .context-line, .callout, .token-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .row, .address-line { justify-content: space-between; }
  .stack { display: grid; gap: ${SPACE.sm}; }
  .stack-tight { display: grid; gap: 3px; min-width: 0; }
  .button-row {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    min-width: 0;
  }
  .section-head {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
    padding: 0 2px;
  }
  .section-head h2 { font-size: ${TYPE.body.size}; font-weight: 700; }
  .eyebrow {
    color: var(--mc-muted);
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
    color: var(--mc-text);
    display: flex;
    flex: 0 1 auto;
    gap: 10px;
    justify-content: flex-start;
    min-height: 0;
    min-width: 0;
    padding: 4px 12px 4px 4px;
    text-align: left;
  }
  button.account-trigger:not(:disabled):hover { background: var(--mc-hover); }
  button.account-trigger:not(:disabled):active { background: var(--mc-soft-press); }
  .brand-mark {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-muted);
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
    color: var(--mc-text);
    font-size: ${TYPE.body.size};
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-name .icon {
    color: var(--mc-muted);
    flex: none;
    height: 12px;
    transition: transform ${MOTION.tabMs}ms ${MOTION.ease};
    width: 12px;
  }
  .account-trigger[aria-expanded="true"] .account-name .icon { transform: rotate(180deg); }
  .account-net {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: 6px;
    min-width: 0;
  }
  .account-net .dot { height: 6px; width: 6px; }
  .header-actions { align-items: center; display: flex; flex: none; gap: ${SPACE.xs}; }

  /* Portfolio hero: left-aligned like the comp — eyebrow label, total, 24h
     delta, a portfolio sparkline with 7d/Today end labels, then the address
     chip. Compact so the tile row and tabs stay above the fold. */
  .hero {
    display: grid;
    gap: 5px;
    justify-items: start;
    padding: ${SPACE.md} 2px ${SPACE.sm};
    text-align: left;
  }
  .hero-eyebrow {
    color: var(--mc-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: ${TRACKING.eyebrow};
    text-transform: uppercase;
  }
  .hero-total {
    color: var(--mc-text);
    font-size: ${TYPE.amount.size};
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: ${TYPE.amount.line};
  }
  /* 24h delta: coloured magnitude (emerald up / red down) beside a muted
     "percent · 24h" window; tabular so digits never jitter as prices stream. */
  .hero-change {
    align-items: center;
    display: inline-flex;
    font-size: ${TYPE.label.size};
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    gap: 6px;
  }
  .hero-change .hero-change-amt { color: var(--mc-positive); }
  .hero-change.down .hero-change-amt { color: var(--mc-danger); }
  .hero-change .hero-change-win { color: var(--mc-muted); font-weight: 500; }
  /* Portfolio sparkline: reuses the shared sparkline geometry (see ./sparkline)
     as an emerald line over a whisper-quiet area fill; red when the window is
     down. Flat — no glass, one accent. */
  .hero-spark {
    display: block;
    height: 56px;
    margin: 10px 0 2px;
    width: 100%;
  }
  .hero-spark .spark-fill { fill: var(--mc-accent); opacity: 0.1; }
  .hero-spark.down .spark-fill { fill: var(--mc-danger); }
  .hero-spark .spark-line {
    fill: none;
    stroke: var(--mc-accent);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .hero-spark.down .spark-line { stroke: var(--mc-danger); }
  .spark-axis {
    color: var(--mc-faint);
    display: flex;
    font-size: 10.5px;
    justify-content: space-between;
    letter-spacing: 0.02em;
    width: 100%;
  }
  button.hero-chip {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    box-shadow: var(--mc-edge);
    color: var(--mc-muted);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.caption.size};
    gap: 7px;
    margin-top: 8px;
    min-height: 0;
    padding: 6px 11px;
  }
  button.hero-chip:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.hero-chip:not(:disabled):active { background: var(--mc-soft-press); }
  .hero-chip .icon { color: var(--mc-muted); height: 14px; width: 14px; }

  /* Action tiles: rounded-square elevated surfaces, icon over label */
  .action-row {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  button.action-tile {
    align-content: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    display: grid;
    gap: 6px;
    justify-items: center;
    min-height: 72px;
    padding: ${SPACE.md} ${SPACE.xs};
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      box-shadow ${MOTION.liftMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  button.action-tile:not(:disabled):hover { background: var(--mc-hover); }
  button.action-tile:not(:disabled):active {
    background: var(--mc-soft-press);
    box-shadow: var(--mc-edge);
    transform: translateY(0) scale(0.96);
  }
  button.action-tile:disabled { cursor: not-allowed; opacity: 0.4; }
  button.action-tile.primary { background: var(--mc-accent-soft); }
  button.action-tile.primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--mc-accent) 24%, var(--mc-panel));
  }
  button.action-tile.primary:not(:disabled):active {
    background: color-mix(in srgb, var(--mc-accent) 30%, var(--mc-panel));
  }
  .tile-icon { color: var(--mc-text); display: inline-flex; }
  button.action-tile.primary .tile-icon { color: var(--mc-accent); }
  .tile-label { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-weight: 650; }
  .tile-icon .icon { height: 20px; width: 20px; }

  /* Bottom dock: a floating solid nav card — hairline edge + a gentle low
     shadow lift it a hair off the page while content scrolls under it. Flat,
     no glass. */
  .wallet-dock {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    bottom: ${SPACE.sm};
    box-shadow: var(--mc-edge), var(--mc-elev-md);
    display: grid;
    gap: 2px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: auto;
    padding: 6px;
    position: sticky;
    z-index: 5;
  }
  button.nav-item {
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    font-weight: 600;
    gap: 4px;
    justify-items: center;
    min-height: ${CONTROL.nav};
    padding: ${SPACE.xs} 2px;
    transition: color ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  button.nav-item:not(:disabled):hover { background: transparent; color: var(--mc-text); }
  button.nav-item:not(:disabled):hover .tab-icon { background: var(--mc-hover); }
  button.nav-item:not(:disabled):active { background: transparent; transform: scale(0.92); }
  button.nav-item[aria-selected="true"] { color: var(--mc-accent); }
  button.nav-item[aria-selected="true"] .tab-icon { background: var(--mc-accent-soft); }
  .tab-icon {
    align-items: center;
    border-radius: ${RADIUS.full};
    display: inline-flex;
    justify-content: center;
    min-height: 22px;
    padding: 6px 16px;
    position: relative;
    transition: background ${MOTION.tabMs}ms ${MOTION.ease};
  }
  .tab-icon .icon { height: 22px; width: 22px; }
  .tab-icon .badge { position: absolute; right: -4px; top: -2px; }
  .tab-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

  /* Flow screens: back control + goal title */
  .flow-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: 2px 0 ${SPACE.xs};
  }
  .flow-title { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .flow-title h1 { font-size: ${TYPE.title.size}; }
  .flow-title p {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    overflow-wrap: anywhere;
  }

  /* Flat list rows: one solid fill, no border, separated by space */
  .menu-list, .option-list { display: grid; gap: 8px; }
  button.menu-row, button.option-row, a.menu-row {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    justify-content: flex-start;
    min-height: 58px;
    padding: 0 ${SPACE.md};
    text-align: left;
    text-decoration: none;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  button.menu-row:not(:disabled):hover, button.option-row:not(:disabled):hover, a.menu-row:hover {
    background: var(--mc-hover);
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active {
    background: var(--mc-soft-press);
    transform: scale(0.985);
  }
  button.option-row[aria-pressed="true"] { background: var(--mc-accent-soft); }
  button.option-row[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-accent-soft); }
  .menu-icon, .menu-chevron { color: var(--mc-muted); display: inline-flex; flex: none; }
  .menu-icon .icon { height: 20px; width: 20px; }
  .avatar { display: block; height: 100%; width: 100%; }
  .brand-mark .icon { height: 20px; width: 20px; }
  .option-avatar {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-muted);
    display: inline-flex;
    flex: none;
    height: 36px;
    justify-content: center;
    overflow: hidden;
    width: 36px;
  }
  input[type="file"] { padding: ${SPACE.sm} ${SPACE.md}; }
  .option-mark { color: var(--mc-accent); display: inline-flex; flex: none; }
  .menu-copy, .option-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .menu-copy strong, .option-copy strong { font-size: ${TYPE.body.size}; font-weight: 600; }
  .menu-value { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .option-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
`;
