/**
 * Send review and outcome stylesheet fragment: the review summary card and
 * its fee/disclosure rows, the submission task list, and the success/failure
 * outcome stage with its reduced-motion fallbacks. Split from the compose
 * layer (./styles-send-compose.ts) by stage so each file stays readable.
 */
import {
  CONTROL,
  EASE,
  MOTION,
  RADIUS,
  SHADOW,
  SIZE,
  SPACE,
  TYPE,
  WEIGHT,
} from "@bramble/ui-kit/tokens";

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
  .send-review-hero {
    align-items: center;
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: ${SIZE.mark} minmax(0, 1fr);
    padding-bottom: ${SPACE.lg};
  }
  .send-review-token,
  .send-review-token > svg,
  .send-review-token .token-mark { height: ${SIZE.mark}; width: ${SIZE.mark}; }
  .send-review-hero > span:last-child { display: grid; gap: ${SPACE.xs}; }
  .send-review-hero strong {
    font-size: ${TYPE.display.size};
    font-variant-numeric: tabular-nums;
  }
  .send-review-hero small { color: var(--bramble-muted); }
  .send-review-facts { border-top: 1px solid var(--bramble-hairline); margin: 0; }
  .send-review-fee {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .send-review-fee:empty { display: none; }
  .send-review-disclosure {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    overflow: hidden;
  }
  .send-review-disclosure summary {
    align-items: center;
    cursor: pointer;
    display: flex;
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
    justify-content: space-between;
    list-style: none;
    min-height: ${SIZE.rowCompact};
    padding: 0 ${SPACE.lg};
  }
  .send-review-disclosure summary::-webkit-details-marker { display: none; }
  .send-review-disclosure summary .icon {
    color: var(--bramble-muted);
    transition: transform ${MOTION.tabMs}ms ${EASE.out};
  }
  .send-review-disclosure[open] summary .icon { transform: rotate(180deg); }
  .send-review-disclosure-body {
    border-top: 1px solid var(--bramble-hairline);
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.md};
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
  .send-outcome-kicker {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.semibold};
  }
  .send-outcome .send-actions { width: 100%; }

  @media (prefers-reduced-motion: reduce) {
    .send-review-disclosure summary .icon { transition: none; }
    .send-failure-ring, .send-failure-mark { animation: none; stroke-dashoffset: 0; }
  }
`;
