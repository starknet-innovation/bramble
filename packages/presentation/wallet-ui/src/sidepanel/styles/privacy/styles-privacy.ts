/**
 * Private-balance disclosure, activation, and shielding journey styles.
 */

import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Privacy styles inherit every color from the active skin.
 */
export const PRIVACY_STYLES = `
  /* Receive: keep the public-only state compact; the whole row remains the
     activation control so the recovery action is never detached from context. */
  button.privacy-pool-notice {
    align-items: center;
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
    line-height: ${TYPE.caption.line};
    padding: ${SPACE.sm} ${SPACE.md};
    text-align: left;
    width: 100%;
  }
  .privacy-pool-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
  .privacy-pool-copy strong,
  button.privacy-pool-notice > strong { color: var(--bramble-text); font-weight: ${WEIGHT.semibold}; }
  button.privacy-pool-notice > strong { flex: none; text-wrap: nowrap; }
  button.privacy-pool-notice:not(:disabled):hover { background: var(--bramble-hover); }
  /* The same notice with nothing to act on yet: same surface, no affordance. */
  .privacy-pool-notice.is-static {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin: 0;
    padding: ${SPACE.sm} ${SPACE.md};
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
    padding: ${SPACE.md} ${SPACE.sm} ${SPACE.sm} calc(${SIZE.mark} + ${SPACE.md});
  }
  .token-breakdown-row {
    align-items: center;
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.md};
    justify-content: space-between;
  }
  .token-breakdown-row.muted .token-breakdown-value { color: var(--bramble-muted); }
  .token-breakdown-label {
    align-items: center;
    color: var(--bramble-muted);
    display: inline-flex;
    gap: ${SPACE.xs};
  }
  .token-breakdown-label .icon { height: 12px; width: 12px; }
  /* The collapsed row's public · private split, under the combined amount. */
  .token-copy p.token-split { color: var(--bramble-muted); font-variant-numeric: tabular-nums; }
  .token-breakdown-value { font-variant-numeric: tabular-nums; font-weight: ${WEIGHT.medium}; }
  button.token-breakdown-register {
    background: transparent;
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    justify-content: space-between;
    min-height: ${CONTROL.hitSmall};
    padding: 0;
    text-align: left;
    width: 100%;
  }
  button.token-breakdown-register:not(:disabled):hover { background: transparent; color: var(--bramble-text); }
  /* Shield and Unshield sit side by side: one asset, two directions, neither
     more default than the other. */
  .token-privacy-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: 1fr 1fr;
  }
  button.token-breakdown-more {
    background: transparent;
    color: var(--bramble-text);
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
  .send-context-receipt.muted { color: var(--bramble-muted); }
  /* One self-labelling toggle per account: it names the balance in use rather
     than offering both. The private state inverts to the skin's foreground as a
     fill, which is the brightest surface a dark skin has and the darkest a light
     one has — no single token is the same shade in both, so the inversion is what
     travels. */
  .send-route-reason {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
  }
  .send-route-reason[hidden] { display: none; }
  .private-balance-summary.muted .token-fiat { color: var(--bramble-text); }
  .private-balance-mark,
  .private-balance-label {
    align-items: center;
    color: var(--bramble-muted);
    display: inline-flex;
  }
  .private-balance-mark { margin-left: ${SPACE.xs}; vertical-align: -2px; }
  .private-balance-mark .icon,
  .private-balance-label .icon { height: 12px; width: 12px; }
  .private-balance-summary {
    align-items: center;
    border-top: 1px solid var(--bramble-hairline);
    display: flex;
    justify-content: space-between;
    margin-top: ${SPACE.sm};
    padding-top: ${SPACE.md};
  }
  button.private-balance-summary {
    background: transparent;
    color: var(--bramble-text);
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
  .privacy-outcome > p { color: var(--bramble-muted); margin: 0 auto; max-width: 32ch; }
  /* The failure sentence with its copy control trailing it, as on the send
     receipt (.send-outcome-reason), so the diagnostic sits beside its line. */
  .privacy-outcome-reason {
    align-items: start;
    display: inline-flex;
    gap: ${SPACE.xs};
    justify-content: center;
    margin: 0 auto;
    min-width: 0;
  }
  .privacy-outcome-reason p { color: var(--bramble-muted); margin: 0; max-width: 32ch; min-width: 0; }
  .privacy-facts,
  .privacy-task-list {
    display: grid;
    gap: ${SPACE.sm};
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .privacy-facts li {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    padding-left: ${SPACE.lg};
    position: relative;
  }
  .privacy-facts li::before {
    background: var(--bramble-text);
    border-radius: ${RADIUS.full};
    content: "";
    height: 5px;
    left: 2px;
    position: absolute;
    top: 6px;
    width: 5px;
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
  .privacy-network small { color: var(--bramble-muted); }
  .privacy-review-amount { margin-bottom: ${SPACE.sm}; }
  /* The compose card reuses the swap panels; only the static token chip and the
     withdrawal address row are privacy-specific. */
  .swap-token.is-static {
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    color: var(--bramble-text);
    font-weight: ${WEIGHT.semibold};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  /* Unshield destination: the account the withdrawal makes public. The current
     choice reads as an identity (avatar + name), not an address field, so the
     link being created is recognizable before signing. */
  .privacy-working { align-content: center; justify-items: center; }
  .privacy-working .liquid-dots { color: var(--bramble-text); }
  .privacy-task-list { text-align: left; width: 100%; }
  .privacy-task-list li {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    gap: ${SPACE.md};
    min-height: ${CONTROL.hit};
  }
  .privacy-task-list li > span {
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    height: ${SPACE.md};
    width: ${SPACE.md};
  }
  .privacy-task-list li[data-state="done"] { color: var(--bramble-text); }
  .privacy-task-list li[data-state="done"] > span { background: var(--bramble-positive); }
  .privacy-task-list li[data-state="active"] { color: var(--bramble-text); font-weight: ${WEIGHT.medium}; }
  .privacy-task-list li[data-state="active"] > span {
    animation: privacy-pulse ${MOTION.waitLoopMs}ms var(--ease-in-out) infinite;
    background: var(--bramble-text);
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
  .privacy-success .privacy-outcome-mark { color: var(--bramble-positive); }
  .privacy-failure .privacy-outcome-mark { color: var(--bramble-danger); }
  /* A submission whose reply was lost is not a failure: the amber tone and a
     "!" mark, never the red cross that invites a retry (mc-wallet issue 382). */
  .privacy-failure[data-severity="warning"] .privacy-outcome-mark { color: var(--bramble-warning); }
  .privacy-unknown-mark,
  .privacy-failure[data-severity="warning"] .send-failure-mark { display: none; }
  .privacy-failure[data-severity="warning"] .privacy-unknown-mark { display: inline; }
  /* A prerequisite, not a failure: the shield mark in the muted tone, drawn at
     the registry icon's own weight rather than the receipt marks' heavier one. */
  .privacy-blocked .privacy-outcome-mark { color: var(--bramble-muted); }
  .privacy-blocked .privacy-outcome-mark svg { stroke-width: 1.5; }
  .privacy-blocked .hint { color: var(--bramble-muted); margin: 0 auto; max-width: 36ch; }
  .privacy-actions { display: grid; gap: ${SPACE.sm}; width: 100%; }
  @keyframes privacy-pulse {
    0%, 100% { opacity: 0.45; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .privacy-task-list li[data-state="active"] > span { animation: none; transition: none; }
  }
`;
