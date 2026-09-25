/**
 * Send review and outcome stylesheet fragment: the review summary card and
 * its fee/disclosure rows, the submission task list, and the success/failure
 * outcome stage with its reduced-motion fallbacks. Split from the compose
 * layer (./styles-send-compose.ts) by stage so each file stays readable.
 */
import { CONTROL, EASE, RADIUS, SHADOW, SIZE, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Send review/outcome stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const SEND_OUTCOME_STYLES = `
  .send-review-summary {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    padding: ${SPACE.lg};
  }
  .proposal-review-stack { display: grid; gap: ${SPACE.sm}; }
  /* The facts list leads the review now, so it carries no rule above its first
     row; the hairline between rows still separates From, To and Amount. */
  .send-review-facts { margin: 0; }
  .send-review-amount {
    align-items: center;
    display: inline-flex;
    gap: ${SPACE.sm};
  }
  .send-review-amount > svg,
  .send-review-amount .token-logo,
  .send-review-amount .token-mark { height: ${SIZE.pill}; width: ${SIZE.pill}; }
  .send-review-amount strong { font-variant-numeric: tabular-nums; }
  /* Cost and Visibility are two answers, so they are two boxes: the container
     only spaces them. */
  .send-review-fee {
    display: grid;
    gap: ${SPACE.sm};
  }
  .send-review-fee:empty { display: none; }
  .send-review-fee > .decision-layer {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .send-review-note { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; margin: 0; }

  .send-task-list { box-shadow: ${SHADOW.xs}; }
  .send-task-list li { min-height: ${CONTROL.hit}; }
  .send-liveness { color: var(--bramble-muted); margin: -${SPACE.sm} 0 0; }

  .send-outcome {
    align-content: center;
    display: grid;
    gap: ${SPACE.lg};
    justify-items: center;
    min-height: 390px;
    text-align: center;
  }
  .send-outcome-mark { display: inline-flex; height: 76px; width: 76px; }
  .send-outcome-mark svg {
    fill: none;
    height: 100%;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.2;
    width: 100%;
  }
  .send-success .send-outcome-mark { color: var(--bramble-positive); }
  .send-failure .send-outcome-mark { color: var(--bramble-danger); }
  .send-failure-ring {
    animation: send-draw 420ms ${EASE.out} forwards;
    stroke-dasharray: 158;
    stroke-dashoffset: 158;
  }
  .send-failure-mark {
    animation: send-draw 280ms ${EASE.out} 360ms forwards;
    stroke-dasharray: 46;
    stroke-dashoffset: 46;
  }
  .send-outcome-copy {
    display: grid;
    gap: ${SPACE.sm};
    justify-items: center;
    max-width: 32ch;
  }
  .send-outcome-copy h2 { font-size: ${TYPE.headline.size}; }
  .send-outcome-copy p { margin: 0; }
  .send-outcome-copy code {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    max-width: 30ch;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-outcome-hash {
    align-items: center;
    display: inline-flex;
    gap: ${SPACE.xs};
    justify-content: center;
    min-width: 0;
  }
  .send-outcome-hash a { color: inherit; text-decoration: none; }
  .send-outcome-hash a[href] code { text-decoration: underline; text-underline-offset: 2px; }
  .send-outcome-hash a[href]:hover code { color: var(--bramble-accent); }
  .send-outcome-kicker {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.semibold};
  }
  .send-outcome .send-actions { width: 100%; }

  @media (prefers-reduced-motion: reduce) {
    .send-failure-ring, .send-failure-mark { animation: none; stroke-dashoffset: 0; }
  }
`;
