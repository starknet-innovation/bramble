/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, the account-bar header, portfolio hero, action
 * tiles, dock, flow chrome, and list rows. Composed with the component layer
 * in ./styles.ts and the home/motion layer in ./styles-home.ts.
 *
 * Surface rules: solid fills only (no gradients), structure carried by
 * elevation instead of borders; list rows are flat fills separated by space,
 * never boxes nested inside boxes.
 */
import { CONTROL, FONT, MOTION, RADIUS, SPACE, TYPE } from "../ui/tokens";

/**
 * Base stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const BASE_STYLES = `

  :root {
    color-scheme: dark;
    --mc-font-mono: ${FONT.mono};
    --mc-font-ui: ${FONT.ui};
    --mc-soft: var(--mc-elevated);
    --mc-hover: color-mix(in srgb, var(--mc-text) 7%, var(--mc-elevated));
    --mc-soft-press: color-mix(in srgb, var(--mc-text) 12%, var(--mc-elevated));
    --mc-accent-hover: color-mix(in srgb, var(--mc-text) 12%, var(--mc-accent));
    --mc-accent-press: color-mix(in srgb, var(--mc-text) 22%, var(--mc-accent));
    --mc-accent-soft: color-mix(in srgb, var(--mc-accent) 16%, var(--mc-panel));
    --mc-positive-soft: color-mix(in srgb, var(--mc-positive) 15%, var(--mc-panel));
    --mc-danger-soft: color-mix(in srgb, var(--mc-danger) 14%, var(--mc-panel));
    --mc-hairline: color-mix(in srgb, var(--mc-text) 8%, transparent);
    --mc-shadow: 0 20px 50px color-mix(in srgb, var(--mc-bg) 72%, transparent);
    --mc-shadow-sm: 0 6px 18px color-mix(in srgb, var(--mc-bg) 55%, transparent);
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
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
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

  /* Portfolio hero: compact so the tile row and tabs stay above the fold */
  .hero {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    justify-items: center;
    padding: ${SPACE.lg} ${SPACE.sm} ${SPACE.sm};
    text-align: center;
  }
  .hero-total {
    color: var(--mc-text);
    font-size: ${TYPE.amount.size};
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: ${TYPE.amount.line};
  }
  button.hero-chip {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.body.size};
    gap: 7px;
    min-height: 0;
    padding: 4px 6px;
  }
  button.hero-chip:not(:disabled):hover { background: transparent; color: var(--mc-text); }
  button.hero-chip:not(:disabled):active { background: transparent; }
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
  button.action-tile:not(:disabled):hover {
    background: var(--mc-hover);
    box-shadow: var(--mc-shadow-sm);
    transform: translateY(-2px);
  }
  button.action-tile:not(:disabled):active {
    background: var(--mc-soft-press);
    box-shadow: none;
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

  /* Bottom dock */
  .wallet-dock {
    background: color-mix(in srgb, var(--mc-panel) 86%, transparent);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    border-radius: ${RADIUS.lg};
    bottom: ${SPACE.sm};
    box-shadow: var(--mc-shadow);
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
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
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
