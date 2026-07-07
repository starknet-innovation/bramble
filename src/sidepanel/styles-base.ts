/**
 * Base layer of the side panel stylesheet: skin-derived custom properties,
 * reset, layout primitives, header, dock, flow chrome, and menu rows.
 * Composed with the component layer in ./styles.ts.
 */
import { CONTROL, FONT, RADIUS, SPACE, TYPE } from "../ui/tokens";

/**
 * Base stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const BASE_STYLES = `

  :root {
    color-scheme: light;
    --mc-font-mono: ${FONT.mono};
    --mc-font-ui: ${FONT.ui};
    --mc-soft: color-mix(in srgb, var(--mc-border) 26%, var(--mc-panel));
    --mc-soft-press: color-mix(in srgb, var(--mc-border) 55%, var(--mc-panel));
    --mc-accent-hover: color-mix(in srgb, var(--mc-text) 14%, var(--mc-accent));
    --mc-accent-press: color-mix(in srgb, var(--mc-text) 26%, var(--mc-accent));
    --mc-accent-soft: color-mix(in srgb, var(--mc-accent) 9%, var(--mc-panel));
    --mc-accent-border: color-mix(in srgb, var(--mc-accent) 28%, var(--mc-border));
    --mc-danger-soft: color-mix(in srgb, var(--mc-danger) 8%, var(--mc-panel));
    --mc-danger-border: color-mix(in srgb, var(--mc-danger) 32%, var(--mc-border));
    --mc-shadow: 0 12px 28px color-mix(in srgb, var(--mc-text) 14%, transparent);
  }
  * { box-sizing: border-box; }
  html, body, #app { min-height: 100%; }
  body {
    background: var(--mc-bg);
    color: var(--mc-text);
    font-family: var(--mc-font-ui);
    font-size: ${TYPE.body.size};
    line-height: ${TYPE.body.line};
    margin: 0;
    overflow-x: hidden;
  }
  h1, h2, h3, p, ul { margin: 0; }
  ul { list-style: none; padding: 0; }
  h1 { font-size: ${TYPE.title.size}; letter-spacing: -0.01em; line-height: ${TYPE.title.line}; }
  h2 { font-size: ${TYPE.body.size}; font-weight: 700; line-height: ${TYPE.title.line}; }
  p { color: var(--mc-muted); }
  .shell {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.md};
    min-height: 100vh;
    padding: ${SPACE.md};
  }

  /* Layout primitives */
  .row, .wallet-header, .address-line, .context-line, .callout, .token-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .row, .wallet-header, .address-line { justify-content: space-between; }
  .stack { display: grid; gap: ${SPACE.sm}; }
  .stack-tight { display: grid; gap: 2px; min-width: 0; }
  .button-row {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    min-width: 0;
  }

  /* Header */
  .brand { align-items: center; display: flex; gap: ${SPACE.sm}; min-width: 0; }
  .brand-mark {
    align-items: center;
    background: var(--mc-text);
    border-radius: ${RADIUS.md};
    color: var(--mc-panel);
    display: inline-flex;
    flex: none;
    height: 36px;
    justify-content: center;
    width: 36px;
  }
  .brand-copy { display: grid; gap: 1px; min-width: 0; }
  .brand-context {
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.caption.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .header-actions { display: flex; flex: none; gap: ${SPACE.sm}; }

  /* Bottom dock: home-screen navigation pinned under the content */
  .wallet-dock {
    background: var(--mc-panel);
    border: 1px solid var(--mc-border);
    border-radius: ${RADIUS.lg};
    bottom: ${SPACE.md};
    box-shadow: var(--mc-shadow);
    display: grid;
    gap: 2px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: auto;
    padding: 3px;
    position: sticky;
    z-index: 5;
  }
  button.nav-item {
    background: transparent;
    border-color: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    font-weight: 600;
    gap: 2px;
    justify-items: center;
    min-height: ${CONTROL.nav};
    padding: ${SPACE.xs} 2px;
  }
  button.nav-item:not(:disabled):hover { background: var(--mc-soft); border-color: transparent; color: var(--mc-text); }
  button.nav-item:not(:disabled):active { background: var(--mc-soft-press); border-color: transparent; }
  button.nav-item[aria-selected="true"] {
    background: var(--mc-soft);
    border-color: var(--mc-border);
    color: var(--mc-text);
  }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    min-height: 20px;
    position: relative;
  }
  .tab-icon .badge { position: absolute; right: -12px; top: -4px; }
  .tab-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

  /* Flow screens: back control + goal title, no dock */
  .flow-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .flow-title { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .flow-title h1 { font-size: ${TYPE.title.size}; }
  .flow-title p {
    font-size: ${TYPE.caption.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }

  /* Settings menu rows and picker option rows */
  .menu-list, .option-list { display: grid; gap: ${SPACE.sm}; }
  button.menu-row, button.option-row {
    background: var(--mc-panel);
    border-color: var(--mc-border);
    color: var(--mc-text);
    justify-content: flex-start;
    min-height: 56px;
    padding: ${SPACE.sm} ${SPACE.md};
    text-align: left;
  }
  button.menu-row:not(:disabled):hover, button.option-row:not(:disabled):hover {
    background: var(--mc-soft);
    border-color: var(--mc-border);
  }
  button.menu-row:not(:disabled):active, button.option-row:not(:disabled):active {
    background: var(--mc-soft-press);
    border-color: var(--mc-border);
  }
  button.option-row[aria-pressed="true"] {
    background: var(--mc-accent-soft);
    border-color: var(--mc-accent-border);
  }
  button.option-row[aria-pressed="true"]:not(:disabled):hover {
    background: var(--mc-accent-soft);
    border-color: var(--mc-accent-border);
  }
  a.menu-row {
    align-items: center;
    background: var(--mc-panel);
    border: 1px solid var(--mc-border);
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    min-height: 56px;
    padding: ${SPACE.sm} ${SPACE.md};
    text-decoration: none;
  }
  a.menu-row:hover { background: var(--mc-soft); }
  .menu-icon, .menu-chevron { color: var(--mc-muted); display: inline-flex; flex: none; }
  .avatar { display: block; height: 20px; width: 20px; }
  .brand-mark .avatar { color: var(--mc-panel); }
  .option-avatar {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.sm};
    color: var(--mc-accent);
    display: inline-flex;
    flex: none;
    height: 30px;
    justify-content: center;
    width: 30px;
  }
  input[type="file"] { padding: ${SPACE.sm} ${SPACE.md}; }
  .option-mark { color: var(--mc-accent); display: inline-flex; flex: none; }
  .menu-copy, .option-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .menu-label {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    font-weight: 600;
  }
  .menu-copy strong, .option-copy strong { font-weight: 650; }
  .option-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
`;
