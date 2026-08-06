/**
 * Private-balance disclosure, activation, and shielding journey styles.
 */

import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Privacy styles inherit every color from the active skin.
 */
export const PRIVACY_STYLES = `
  .privacy-toggle-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
    min-height: ${CONTROL.hit};
    padding: ${SPACE.sm} 0 ${SPACE.md};
  }
  .privacy-toggle-row > label {
    color: var(--mc-text);
    cursor: pointer;
    flex: none;
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.medium};
    margin: 0;
    text-wrap: nowrap;
  }
  .privacy-toggle-row input[type="checkbox"] { cursor: pointer; }
  .privacy-callout {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    margin: ${SPACE.sm} 0 ${SPACE.md};
    padding: ${SPACE.md};
  }
  .privacy-callout p { color: var(--mc-muted); margin: 0; }
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
