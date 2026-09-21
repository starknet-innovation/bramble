/**
 * Standalone Ledger-grant stylesheet composed entirely from the extension's
 * shared skin and scale tokens. Native Chrome USB/HID pickers remain browser
 * chrome; this styles the trusted Bramble handoff and its safe diagnostic
 * states so the one-time permission step feels continuous with the side panel.
 */
import {
  EASE,
  FONT,
  MOTION,
  RADIUS,
  SHADOW,
  SPACE,
  TRACKING,
  TYPE,
  WEIGHT,
} from "@bramble/ui-kit/tokens";

/**
 * Token-driven stylesheet for `ledger-grant.html`.
 */
export const LEDGER_GRANT_STYLES = `
  :root {
    color-scheme: dark;
    --bramble-accent-soft: color-mix(in srgb, var(--bramble-accent) 13%, var(--bramble-panel));
    --bramble-positive-soft: color-mix(in srgb, var(--bramble-positive) 13%, var(--bramble-panel));
    --bramble-danger-soft: color-mix(in srgb, var(--bramble-danger) 12%, var(--bramble-panel));
    --bramble-hover: color-mix(in srgb, var(--bramble-text) 7%, var(--bramble-elevated));
    --bramble-press: color-mix(in srgb, var(--bramble-text) 14%, var(--bramble-accent));
    --bramble-hairline: color-mix(in srgb, var(--bramble-text) 12%, transparent);
    --bramble-font-ui: ${FONT.ui};
    --bramble-font-mono: ${FONT.mono};
  }

  * { box-sizing: border-box; }
  html, body, #app { min-height: 100%; }
  body {
    background: var(--bramble-bg);
    color: var(--bramble-text);
    font-family: var(--bramble-font-ui);
    font-size: ${TYPE.body.size};
    line-height: ${TYPE.body.line};
    margin: 0;
    -webkit-font-smoothing: antialiased;
  }
  button { font: inherit; }
  h1, p, ol { margin: 0; }

  .grant-shell {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.lg};
    margin: 0 auto;
    max-width: 560px;
    min-height: 100dvh;
    padding: ${SPACE.lg} ${SPACE.xl} ${SPACE.xl};
  }

  .grant-header {
    align-items: center;
    display: flex;
    justify-content: space-between;
    min-height: 36px;
  }
  .grant-brand {
    align-items: center;
    display: inline-flex;
    gap: 10px;
  }
  .grant-brand-mark {
    align-items: center;
    background: var(--bramble-accent);
    border-radius: ${RADIUS.sm};
    color: var(--bramble-accent-text);
    display: inline-flex;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
  .grant-brand-mark .brand-glyph { height: 20px; width: 20px; }
  .grant-brand strong {
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: ${TRACKING.label};
  }
  .grant-once {
    align-items: center;
    color: var(--bramble-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    gap: 7px;
  }
  .grant-once-dot {
    background: var(--bramble-positive);
    border-radius: ${RADIUS.full};
    height: 7px;
    width: 7px;
  }

  .grant-hero {
    align-items: center;
    display: grid;
    gap: ${SPACE.lg};
    grid-template-columns: 104px minmax(0, 1fr);
    padding: ${SPACE.sm} 0;
  }
  .ledger-visual {
    align-items: center;
    display: flex;
    height: 112px;
    justify-content: center;
    position: relative;
  }
  .ledger-cable {
    background: var(--bramble-hairline);
    border-radius: ${RADIUS.full};
    height: 6px;
    left: 0;
    position: absolute;
    width: 27px;
  }
  .ledger-cable::before {
    background: var(--bramble-elevated);
    border-radius: 3px;
    content: "";
    height: 14px;
    left: 20px;
    position: absolute;
    top: -4px;
    width: 13px;
  }
  .ledger-body {
    background: var(--bramble-elevated);
    border: 1px solid var(--bramble-hairline);
    border-radius: ${RADIUS.md};
    box-shadow: ${SHADOW.sm};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md};
    position: relative;
    width: 82px;
  }
  .ledger-screen {
    align-content: center;
    background: var(--bramble-sunken);
    border-radius: 7px;
    color: var(--bramble-positive);
    display: grid;
    font-family: var(--bramble-font-mono);
    font-size: 8px;
    height: 42px;
    justify-items: center;
    letter-spacing: 0.04em;
    line-height: 1.3;
    text-transform: uppercase;
  }
  .ledger-screen strong {
    color: var(--bramble-text);
    font-size: 9px;
    font-weight: ${WEIGHT.bold};
  }
  .ledger-controls {
    display: flex;
    gap: ${SPACE.sm};
    justify-content: center;
  }
  .ledger-controls span {
    background: var(--bramble-muted);
    border-radius: ${RADIUS.full};
    height: 7px;
    opacity: 0.65;
    width: 7px;
  }

  .grant-copy {
    display: grid;
    gap: ${SPACE.sm};
    min-width: 0;
  }
  .grant-copy h1 {
    font-size: ${TYPE.headline.size};
    font-weight: ${WEIGHT.heavy};
    letter-spacing: ${TRACKING.display};
    line-height: ${TYPE.headline.line};
    text-wrap: balance;
  }
  .grant-copy p {
    color: var(--bramble-muted);
    max-width: 42ch;
  }

  .grant-methods {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: ${SHADOW.xs};
    display: grid;
    overflow: hidden;
  }
  .grant-method-options {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 0 ${SPACE.lg} ${SPACE.md};
  }
  .grant-method {
    appearance: none;
    -webkit-appearance: none;
    background: var(--bramble-sunken);
    border: 1px solid transparent;
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    cursor: pointer;
    display: grid;
    gap: 3px;
    min-height: 62px;
    padding: 10px ${SPACE.md};
    text-align: left;
  }
  .grant-method strong {
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.bold};
  }
  .grant-method span {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    line-height: 1.35;
  }
  .grant-method[data-active="true"] {
    background: var(--bramble-accent-soft);
    border-color: var(--bramble-accent);
  }
  .grant-method[data-active="true"] strong { color: var(--bramble-accent); }
  .grant-method:focus-visible {
    outline: 2px solid var(--bramble-accent);
    outline-offset: 2px;
  }
  @media (hover: hover) and (pointer: fine) {
    .grant-method:not([data-active="true"]):hover { background: var(--bramble-hover); }
  }

  .grant-readiness {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: ${SHADOW.xs};
    display: grid;
    overflow: hidden;
  }
  .grant-readiness-head {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.semibold};
    letter-spacing: ${TRACKING.caption};
    padding: ${SPACE.md} ${SPACE.lg} ${SPACE.sm};
  }
  .grant-steps {
    list-style: none;
    padding: 0 ${SPACE.lg} ${SPACE.md};
  }
  .grant-step {
    align-items: center;
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: 28px minmax(0, 1fr);
    min-height: 42px;
    position: relative;
  }
  .grant-step + .grant-step::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto 40px;
    position: absolute;
  }
  .grant-step-index {
    align-items: center;
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    display: inline-flex;
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.bold};
    height: 24px;
    justify-content: center;
    width: 24px;
  }
  .grant-step strong {
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
  }

  .grant-status {
    background: var(--bramble-accent-soft);
    border-radius: ${RADIUS.md};
    color: var(--bramble-text);
    display: grid;
    font-size: ${TYPE.caption.size};
    gap: 3px;
    min-height: 54px;
    padding: 10px ${SPACE.md};
  }
  .grant-status[hidden] { display: none; }
  .grant-status strong {
    color: var(--bramble-accent);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.bold};
  }
  .grant-status p { color: var(--bramble-muted); }
  .grant-diagnostic {
    color: var(--bramble-muted);
    font-family: var(--bramble-font-mono);
    font-size: ${TYPE.micro.size};
    letter-spacing: ${TRACKING.caption};
    margin-top: 3px;
  }
  .grant-diagnostic[hidden] { display: none; }
  .grant-status[data-tone="danger"] { background: var(--bramble-danger-soft); }
  .grant-status[data-tone="danger"] strong { color: var(--bramble-danger); }
  .grant-status[data-tone="success"] { background: var(--bramble-positive-soft); }
  .grant-status[data-tone="success"] strong { color: var(--bramble-positive); }

  .grant-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .grant-button {
    align-items: center;
    appearance: none;
    -webkit-appearance: none;
    background: var(--bramble-accent);
    border: 0;
    border-radius: ${RADIUS.full};
    color: var(--bramble-accent-text);
    cursor: pointer;
    display: inline-flex;
    font-weight: ${WEIGHT.semibold};
    gap: ${SPACE.sm};
    justify-content: center;
    min-height: 46px;
    padding: 0 ${SPACE.xl};
    transition:
      background ${MOTION.pressMs}ms ${EASE.standard},
      transform ${MOTION.liftMs}ms ${EASE.out};
  }
  .grant-button:not(:disabled):active {
    background: var(--bramble-press);
    transform: scale(0.98);
  }
  .grant-button:disabled {
    cursor: wait;
    opacity: 0.7;
  }
  .grant-cancel {
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    border: 0;
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    cursor: pointer;
    min-height: 46px;
    padding: 0 ${SPACE.lg};
  }
  .grant-cancel:active { background: var(--bramble-hover); color: var(--bramble-text); }
  @media (hover: hover) and (pointer: fine) {
    .grant-button:not(:disabled):hover {
      background: color-mix(in srgb, var(--bramble-text) 10%, var(--bramble-accent));
    }
    .grant-cancel:hover { background: var(--bramble-hover); color: var(--bramble-text); }
  }
  .grant-button:focus-visible, .grant-cancel:focus-visible {
    outline: 2px solid var(--bramble-accent);
    outline-offset: 2px;
  }
  .grant-spinner {
    animation: grant-spin 700ms linear infinite;
    border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
    border-radius: ${RADIUS.full};
    border-top-color: currentColor;
    display: none;
    height: 16px;
    width: 16px;
  }
  .grant-button[data-busy="true"] .grant-spinner { display: inline-block; }

  .grant-footnote {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin-top: auto;
    text-align: center;
  }
  /* Once Chrome returns a result, the recovery/success notice becomes the
     useful footer. Remove the redundant privacy line so the complete state and
     both actions stay visible in a reduced browser viewport. */
  .grant-shell:has(.grant-status:not([hidden])) .grant-footnote { display: none; }

  @keyframes grant-spin { to { transform: rotate(360deg); } }

  @media (max-width: 430px) {
    .grant-shell { padding: ${SPACE.lg}; }
    .grant-hero { grid-template-columns: 82px minmax(0, 1fr); }
    .grant-method-options { grid-template-columns: 1fr; }
    .ledger-visual { transform: scale(0.86); }
    .grant-once { display: none; }
  }
  @media (max-height: 520px) {
    .grant-shell { gap: ${SPACE.md}; padding-block: ${SPACE.md}; }
    .grant-hero { padding: 0; }
    .ledger-visual { height: 88px; transform: scale(0.82); }
    .grant-step { min-height: 36px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .grant-button { transition: none; }
    .grant-spinner { animation: none; }
  }
`;
