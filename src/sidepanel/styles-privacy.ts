/**
 * Private-balance disclosure, activation, and shielding journey styles.
 */

import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Privacy styles inherit every color from the active skin.
 */
export const PRIVACY_STYLES = `
  /* Unified balance rows: the summary is the row, the dropdown carries the
     public/private split and the asset-screen link. The private line doubles
     as the registration entry while the account is unregistered. */
  .token-row.token-unified { display: block; }
  .token-disclosure { min-width: 0; }
  .token-disclosure summary {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: ${SPACE.md};
    list-style: none;
  }
  .token-disclosure summary::-webkit-details-marker { display: none; }
  .token-breakdown {
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.sm} ${SPACE.sm} calc(40px + ${SPACE.md});
  }
  .token-breakdown-row {
    align-items: center;
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.md};
    justify-content: space-between;
  }
  .token-breakdown-row.muted .token-breakdown-value { color: var(--mc-muted); }
  .token-breakdown-label {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
    gap: ${SPACE.xs};
  }
  .token-breakdown-label .icon { height: 12px; width: 12px; }
  .token-breakdown-value { font-variant-numeric: tabular-nums; font-weight: ${WEIGHT.medium}; }
  button.token-breakdown-register {
    background: transparent;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    justify-content: space-between;
    min-height: ${CONTROL.hitSmall};
    padding: 0;
    text-align: left;
    width: 100%;
  }
  button.token-breakdown-register:not(:disabled):hover { background: transparent; color: var(--mc-text); }
  button.token-breakdown-more {
    background: transparent;
    color: var(--mc-text);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.semibold};
    justify-content: flex-start;
    min-height: ${CONTROL.hitSmall};
    padding: 0;
  }
  button.token-breakdown-more:not(:disabled):hover { background: transparent; }
  button.token-breakdown-more .icon { height: 14px; width: 14px; }
  .shield-stepper { display: inline-flex; flex: none; gap: ${SPACE.xs}; }
  button.shield-step {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.bold};
    height: 22px;
    line-height: 1;
    min-height: 0;
    padding: 0;
    width: 22px;
  }
  button.shield-step:not(:disabled):hover { background: var(--mc-hover); }
  button.shield-confirm {
    background: var(--mc-accent);
    color: var(--mc-accent-text);
    font-size: ${TYPE.caption.size};
    min-height: ${CONTROL.hitSmall};
    width: 100%;
  }
  button.shield-confirm:disabled { cursor: not-allowed; opacity: 0.55; }
  .privacy-inline-error {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
    padding: ${SPACE.sm} ${SPACE.sm} 0;
  }
  .private-balance-summary.muted .token-fiat { color: var(--mc-muted); }
  .private-balance-mark,
  .private-balance-label {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
  }
  .private-balance-mark { margin-left: ${SPACE.xs}; vertical-align: -2px; }
  .private-balance-mark .icon,
  .private-balance-label .icon { height: 12px; width: 12px; }
  .private-balance-summary {
    align-items: center;
    border-top: 1px solid var(--mc-hairline);
    display: flex;
    justify-content: space-between;
    margin-top: ${SPACE.sm};
    padding-top: ${SPACE.md};
  }
  .private-balance-label {
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    gap: ${SPACE.xs};
  }
  .privacy-flow { display: grid; min-height: calc(100dvh - 88px); }
  .privacy-review,
  .privacy-compose,
  .privacy-working,
  .privacy-outcome {
    align-content: start;
    display: grid;
    gap: ${SPACE.lg};
  }
  .privacy-review-mark {
    align-items: center;
    display: flex;
    height: ${SIZE.brand};
    justify-content: center;
    margin: ${SPACE.sm} auto 0;
    width: ${SIZE.brand};
  }
  .privacy-review-mark .token-glyph { height: 100%; width: 100%; }
  .privacy-review-title,
  .privacy-working,
  .privacy-outcome { text-align: center; }
  .privacy-review-title h2,
  .privacy-working h2,
  .privacy-outcome h2 { font-size: ${TYPE.display.size}; margin: 0; }
  .privacy-review-title p,
  .privacy-working > p,
  .privacy-outcome > p { color: var(--mc-muted); margin: 0 auto; max-width: 32ch; }
  .privacy-facts,
  .privacy-task-list {
    display: grid;
    gap: ${SPACE.sm};
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .privacy-facts li {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    padding-left: ${SPACE.lg};
    position: relative;
  }
  .privacy-facts li::before {
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    content: "";
    height: 5px;
    left: 2px;
    position: absolute;
    top: 6px;
    width: 5px;
  }
  .privacy-warning {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.sm};
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin: 0;
    padding: ${SPACE.md};
  }
  .privacy-token-context,
  .privacy-network {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
  }
  .privacy-token-context > span:last-child,
  .privacy-network > span:last-child { display: grid; gap: 2px; }
  .privacy-token-context small,
  .privacy-network small { color: var(--mc-muted); }
  .privacy-amount { display: grid; gap: ${SPACE.sm}; }
  .privacy-amount > span:first-child { color: var(--mc-muted); font-size: ${TYPE.label.size}; }
  .privacy-amount-control {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.md};
    display: flex;
    padding: 0 ${SPACE.md};
  }
  .privacy-amount-control input {
    background: transparent;
    border: 0;
    font-size: ${TYPE.headline.size};
    min-width: 0;
    padding-left: 0;
  }
  .privacy-shortcuts {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    margin-top: -${SPACE.sm};
  }
  .privacy-shortcuts span { margin-right: auto; }
  .privacy-shortcuts button {
    background: transparent;
    color: var(--mc-text);
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
  }
  .privacy-working { align-content: center; justify-items: center; }
  .privacy-working .liquid-dots { color: var(--mc-text); }
  .privacy-task-list { text-align: left; width: 100%; }
  .privacy-task-list li {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    gap: ${SPACE.md};
    min-height: ${CONTROL.hit};
  }
  .privacy-task-list li > span {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    height: ${SPACE.md};
    width: ${SPACE.md};
  }
  .privacy-task-list li[data-state="done"] { color: var(--mc-text); }
  .privacy-task-list li[data-state="done"] > span { background: var(--mc-positive); }
  .privacy-task-list li[data-state="active"] { color: var(--mc-text); font-weight: ${WEIGHT.medium}; }
  .privacy-task-list li[data-state="active"] > span {
    animation: privacy-pulse ${MOTION.waitLoopMs}ms var(--ease-in-out) infinite;
    background: var(--mc-text);
  }
  .privacy-outcome { align-content: center; justify-items: center; }
  .privacy-outcome-mark {
    display: inline-flex;
    height: 76px;
    width: 76px;
  }
  .privacy-outcome-mark svg {
    fill: none;
    height: 100%;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.2;
    width: 100%;
  }
  .privacy-success .privacy-outcome-mark { color: var(--mc-positive); }
  .privacy-failure .privacy-outcome-mark { color: var(--mc-danger); }
  .privacy-actions { display: grid; gap: ${SPACE.sm}; width: 100%; }
  @keyframes privacy-pulse {
    0%, 100% { opacity: 0.45; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .privacy-task-list li[data-state="active"] > span { animation: none; transition: none; }
  }
`;
