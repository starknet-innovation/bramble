/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, header, portfolio hero, quick actions, dock, flow
 * chrome, and list rows. Composed with the component layer in ./styles.ts.
 *
 * Surface rules: solid fills only (no gradients); at most one border per
 * component; list rows are flat fills separated by space, never boxes nested
 * inside boxes.
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

  /* Header: avatar, centered identity (name | network), lock */
  .wallet-header {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: 38px 1fr 40px;
    padding: 2px 0 ${SPACE.xs};
  }
  .brand-mark {
    align-items: center;
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
    display: inline-flex;
    flex: none;
    height: 38px;
    justify-content: center;
    width: 38px;
  }
  .account-id {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: center;
    min-width: 0;
  }
  .account-id strong {
    color: var(--mc-text);
    font-size: ${TYPE.body.size};
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-sep { color: var(--mc-muted); flex: none; }
  .account-net {
    color: var(--mc-muted);
    font-size: ${TYPE.body.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .header-actions { align-items: center; display: flex; flex: none; gap: ${SPACE.sm}; }

  /* Portfolio hero */
  .hero {
    align-items: center;
    display: grid;
    gap: ${SPACE.md};
    justify-items: center;
    padding: ${SPACE.xl} ${SPACE.sm} ${SPACE.lg};
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

  /* Quick actions: circular icon buttons with a short label */
  .quick-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    justify-items: center;
    padding: 0 ${SPACE.md};
  }
  button.quick-action {
    background: transparent;
    color: var(--mc-text);
    display: grid;
    gap: 8px;
    justify-items: center;
    min-height: 0;
    padding: 0;
  }
  .quick-disc {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    display: inline-flex;
    height: 56px;
    justify-content: center;
    transition: background 90ms ${MOTION.ease}, color 90ms ${MOTION.ease};
    width: 56px;
  }
  button.quick-action:not(:disabled):hover, button.quick-action:not(:disabled):active { background: transparent; }
  button.quick-action:not(:disabled):hover .quick-disc { background: var(--mc-hover); }
  button.quick-action:not(:disabled):active .quick-disc { background: var(--mc-soft-press); }
  button.quick-action.primary .quick-disc { background: var(--mc-accent); color: var(--mc-accent-text); }
  button.quick-action.primary:not(:disabled):hover .quick-disc { background: var(--mc-accent-hover); }
  button.quick-action:disabled { cursor: not-allowed; opacity: 0.4; }
  .quick-label { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-weight: 600; }
  .quick-disc .icon { height: 22px; width: 22px; }

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
  }
  button.nav-item:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.nav-item[aria-selected="true"] { color: var(--mc-accent); }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    min-height: 22px;
    position: relative;
  }
  .tab-icon .icon { height: 22px; width: 22px; }
  .tab-icon .badge { position: absolute; right: -12px; top: -4px; }
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
  }
  button.menu-row:not(:disabled):hover, button.option-row:not(:disabled):hover, a.menu-row:hover {
    background: var(--mc-hover);
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active { background: var(--mc-soft-press); }
  button.option-row[aria-pressed="true"] { background: var(--mc-accent-soft); }
  button.option-row[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-accent-soft); }
  .menu-icon, .menu-chevron { color: var(--mc-muted); display: inline-flex; flex: none; }
  .menu-icon .icon { height: 20px; width: 20px; }
  .avatar { display: block; height: 20px; width: 20px; }
  .brand-mark .avatar { color: var(--mc-accent-text); height: 20px; width: 20px; }
  .option-avatar {
    align-items: center;
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
    display: inline-flex;
    flex: none;
    height: 36px;
    justify-content: center;
    width: 36px;
  }
  input[type="file"] { padding: ${SPACE.sm} ${SPACE.md}; }
  .option-mark { color: var(--mc-accent); display: inline-flex; flex: none; }
  .menu-copy, .option-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .menu-copy strong, .option-copy strong { font-size: ${TYPE.body.size}; font-weight: 600; }
  .menu-value { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .option-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
`;
