/**
 * Private-balance disclosure, activation, and shielding journey styles.
 */

import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Privacy styles inherit every color from the active skin.
 */
export const PRIVACY_STYLES = `
  /* Receive: an unregistered account can only be paid publicly, so the whole
     notice is the activation control rather than a message beside a link. */
  button.privacy-pool-notice {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
    justify-items: start;
    line-height: ${TYPE.caption.line};
    padding: ${SPACE.md};
    text-align: left;
    width: 100%;
  }
  button.privacy-pool-notice strong { color: var(--mc-text); font-weight: ${WEIGHT.semibold}; }
  button.privacy-pool-notice:not(:disabled):hover { background: var(--mc-hover); }
  /* The same notice with nothing to act on yet: same surface, no affordance. */
  .privacy-pool-notice.is-static {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
    line-height: ${TYPE.caption.line};
    margin: 0;
    padding: ${SPACE.md};
  }

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
  /* Shield and Unshield sit side by side: one asset, two directions, neither
     more default than the other. */
  .token-privacy-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: 1fr 1fr;
  }
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
  /* Which balance each end of a send uses, chosen on the account it belongs to
     in the Accounts receipt. A blocked route greys the receipt and spells the
     reason out beneath it — a dead control whose only explanation was a title
     tooltip read as broken rather than gated. */
  .send-context-receipt.muted { color: var(--mc-muted); }
  /* One self-labelling toggle per account: it names the balance in use rather
     than offering both. The private state inverts to the skin's foreground as a
     fill, which is the brightest surface a dark skin has and the darkest a light
     one has — no single token is the same shade in both, so the inversion is what
     travels. */
  button.send-route-toggle {
    background: var(--mc-sunken);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    min-height: ${CONTROL.hitSmall};
    min-width: 72px;
    padding: 0 ${SPACE.md};
  }
  button.send-route-toggle[data-bucket="private"] {
    background: var(--mc-text);
    color: var(--mc-bg);
  }
  button.send-route-toggle:not(:disabled):hover { background: var(--mc-hover); }
  button.send-route-toggle[data-bucket="private"]:not(:disabled):hover {
    background: var(--mc-text);
    opacity: 0.9;
  }
  .send-route-reason {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .send-route-reason[hidden] { display: none; }
  .private-balance-summary.muted .token-fiat { color: var(--mc-text); }
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
  button.private-balance-summary {
    background: transparent;
    color: var(--mc-text);
    min-height: ${CONTROL.hitSmall};
    padding: ${SPACE.md} 0 0;
    text-align: left;
    width: 100%;
  }
  button.private-balance-summary:not(:disabled):hover { background: transparent; }
  .private-balance-label {
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    gap: ${SPACE.xs};
  }
  .privacy-flow { display: grid; min-height: calc(100dvh - 88px); }
  .privacy-review,
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
  .privacy-review-amount { margin-bottom: ${SPACE.sm}; }
  /* The compose card reuses the swap panels; only the static token chip and the
     withdrawal address row are privacy-specific. */
  .swap-token.is-static {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    font-weight: ${WEIGHT.semibold};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  /* Unshield destination: the account the withdrawal makes public. The current
     choice reads as an identity (avatar + name), not an address field, so the
     link being created is recognizable before signing. */
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
