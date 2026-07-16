/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, the account-bar header, portfolio hero, action
 * tiles, dock, flow chrome, and list rows. Composed with the component layer
 * in ./styles.ts and the home/motion layer in ./styles-home.ts.
 *
 * Surface rules ("Clean Mono"): solid fills only (no gradients, no glass),
 * structure carried by gentle low elevation and hairline edges; list rows are
 * flat fills separated by space, never boxes nested inside boxes. The single
 * cobalt accent is reserved for the primary CTA, active states, and focus;
 * market semantics (green gains, red losses) stay their own tokens — nothing
 * else leaves the near-mono neutral palette.
 */
import { CONTROL, FONT, MOTION, RADIUS, SPACE, TRACKING, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Base stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const BASE_STYLES = `

  :root {
    /* Default to the dark scheme of the default midnight skin; the entrypoint
       pins the resolved scheme (dark / light) inline before first paint. */
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
    --mc-shadow: var(--mc-elev-lg);
    --mc-shadow-sm: var(--mc-elev-sm);
    /* Anchored bottom-bar footprint: one source of truth consumed by the dock
       itself, the dock-screen scroll clearance, and the toast stack offset. */
    --mc-dock-h: calc(${CONTROL.nav} + ${SPACE.sm});
    /* Flat per-account avatar palette: four restrained mid-tone fills (the
       first is the brand cobalt) plus one dark ink for the glyph. Mid-tone by
       design so the same fills and ink read on both skins; defined once here as
       tokens so avatar chips carry no scattered colour literals. */
    --mc-avatar-0: hsl(222 68% 62%);
    --mc-avatar-1: hsl(168 46% 44%);
    --mc-avatar-2: hsl(28 78% 55%);
    --mc-avatar-3: hsl(265 52% 62%);
    --mc-avatar-ink: hsl(220 34% 12%);
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
  /* Dock screens scroll their content UNDER the anchored bottom bar. Reserve
     clearance below the content equal to the bar footprint plus a breathing
     gap, so the last row never hides beneath it at any scroll position. Flow
     screens carry no dock. */
  .screen:not(.flow) { padding-bottom: calc(var(--mc-dock-h) + ${SPACE.lg}); }

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
  @media (hover: hover) and (pointer: fine) {
    button.account-trigger:not(:disabled):hover { background: var(--mc-hover); }
  }
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

  /* Portfolio hero: the home screen's focal point. A quiet eyebrow label, the
     total set as a large optically-sized figure, the 24h delta, then the
     address chip. Centre-aligned as a single block — the eyebrow, total, delta,
     and address chip all share one horizontal centre line — so the balance
     reads as a calm, symmetric focal point with breathing room on both sides
     (the client asked to move off the hard left edge). Spacing sits on the
     4/8px grid: the eyebrow, total, and delta read as one tight 4px cluster,
     with the address chip set apart by a full 8px step so it groups as its own
     element and the number is given room to breathe. */
  .hero {
    display: grid;
    gap: ${SPACE.xs};
    justify-items: center;
    padding: ${SPACE.sm} 0 0;
    text-align: center;
  }
  /* Muted, not fainter: an extra-faded tier fell below WCAG AA (≈2.4:1 on the
     light skin), so the eyebrow reads quiet through size, weight, and case
     while keeping the compliant muted ink. */
  .hero-eyebrow {
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.medium};
    letter-spacing: ${TRACKING.eyebrow};
    text-transform: uppercase;
  }
  /* The total carries real presence: large, heavy, tightly tracked, optically
     sized, and tabular so digits never jitter as prices stream. */
  .hero-total {
    color: var(--mc-text);
    font-optical-sizing: auto;
    font-size: ${TYPE.amount.size};
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    letter-spacing: ${TRACKING.amount};
    line-height: ${TYPE.amount.line};
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
  .hero-change .hero-change-amt { color: var(--mc-positive); }
  .hero-change.down .hero-change-amt { color: var(--mc-danger); }
  .hero-change .hero-change-win { color: var(--mc-muted); font-weight: 500; }
  /* Degraded-price notice: a muted, low-key line so saved/unavailable prices
     read as an honest caveat under the total, never as an error state. */
  .hero-stale {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 500;
    gap: 5px;
  }
  .hero-stale .icon { height: 13px; width: 13px; }
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
    gap: 6px;
    margin-top: ${SPACE.sm};
    min-height: 0;
    padding: 6px ${SPACE.md};
  }
  @media (hover: hover) and (pointer: fine) {
    button.hero-chip:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  }
  button.hero-chip:not(:disabled):active { background: var(--mc-soft-press); }
  .hero-chip .icon { color: var(--mc-muted); height: 14px; width: 14px; }

  /* Action tiles: borderless icon buttons — a plain icon over its label, no
     box treatment (no fill, no hairline, no elevation, no boxy min-height), so
     the row reads as clean icons rather than cards and the homepage breathes.
     The two (Send / Receive) sit as a centred, equal-width pair beneath the
     centred hero — a content-sized auto-column grid centred in the row rather
     than stretched edge-to-edge, so removing the former third tile leaves the
     pair balanced instead of drifting apart. Send stays subtly primary through
     the accent tint on its icon alone — never a filled box. Feedback is a light
     press scale plus a hover icon-brighten; the accent focus ring still frames
     the whole hit target. */
  .action-row {
    display: flex;
    gap: ${SPACE.xl};
    justify-content: center;
  }
  button.action-tile {
    align-content: start;
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    flex: 0 0 auto;
    min-width: 88px;
    display: grid;
    gap: ${SPACE.sm};
    justify-items: center;
    padding: ${SPACE.sm} ${SPACE.xs};
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    button.action-tile:not(:disabled):hover { background: var(--mc-hover); }
    button.action-tile:not(:disabled):hover .tile-label { color: var(--mc-text); }
  }
  button.action-tile:not(:disabled):active { background: var(--mc-soft-press); transform: scale(0.94); }
  button.action-tile:disabled { cursor: not-allowed; opacity: 0.4; }
  .tile-icon {
    align-items: center;
    color: var(--mc-text);
    display: inline-flex;
    justify-content: center;
  }
  button.action-tile.primary .tile-icon { color: var(--mc-accent); }
  .tile-label { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-weight: 650; }
  .tile-icon .icon { height: 24px; width: 24px; }

  /* Bottom dock: an anchored, full-bleed bottom bar — a solid panel drawn to
     the panel edges, separated from scrolling content by a top hairline and
     the softest upward shadow. Flat, no glass, no floating card: navigation
     reads as structural chrome, not a component drifting over the page. */
  .wallet-dock {
    background: var(--mc-panel);
    bottom: 0;
    box-shadow: inset 0 1px 0 var(--mc-hairline), var(--mc-elev-up);
    display: grid;
    gap: ${SPACE.xs};
    grid-template-columns: repeat(3, minmax(0, 1fr));
    left: 0;
    min-height: var(--mc-dock-h);
    padding: ${SPACE.xs} ${SPACE.lg};
    position: fixed;
    right: 0;
    z-index: 5;
  }
  button.nav-item {
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.medium};
    gap: 3px;
    justify-items: center;
    letter-spacing: ${TRACKING.caption};
    min-height: ${CONTROL.nav};
    padding: ${SPACE.sm} 2px ${SPACE.xs};
    transition: color ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    button.nav-item:not(:disabled):hover { background: transparent; color: var(--mc-text); }
    /* The active item keeps its accent under the pointer — hovering the tab
       you are already on must never read as leaving it. */
    button.nav-item[aria-selected="true"]:not(:disabled):hover { color: var(--mc-accent); }
  }
  button.nav-item:not(:disabled):active { background: transparent; transform: scale(0.96); }
  /* Active state is carried by ink alone — the accent tints the icon and its
     label, with inactive items muted — never a filled background pill behind
     it. The dock stays flat: no moving indicator, no accent-soft field. */
  button.nav-item[aria-selected="true"] { color: var(--mc-accent); }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    min-height: 22px;
    padding: 0 ${SPACE.md};
    position: relative;
    transition: color ${MOTION.tabMs}ms ${MOTION.ease};
  }
  .tab-icon .icon { height: 22px; width: 22px; }
  .tab-icon .badge { position: absolute; right: 0; top: -2px; }
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

  /* Flat list rows: one solid fill, no border, separated by space. The flex
     layout is declared here (not inherited): anchor rows (Help & docs) never
     pass through the base button rule, and without it their grid-displayed
     copy block breaks onto its own line. */
  .menu-list, .option-list { display: grid; gap: 8px; }
  button.menu-row, button.option-row, a.menu-row {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 58px;
    padding: 0 ${SPACE.md};
    text-align: left;
    text-decoration: none;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    button.menu-row:not(:disabled):hover, button.option-row:not(:disabled):hover, a.menu-row:hover {
      background: var(--mc-hover);
    }
    button.option-row[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-accent-soft); }
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active {
    background: var(--mc-soft-press);
    transform: scale(0.985);
  }
  button.option-row[aria-pressed="true"] { background: var(--mc-accent-soft); }
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
  .option-sub { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
`;
