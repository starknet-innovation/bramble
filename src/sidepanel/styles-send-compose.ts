/**
 * Recipient-first Send composition, review disclosure, and terminal outcome
 * styles. This layer follows the Clean Mono skin and reserves semantic colour
 * for confirmed success and explicit failure.
 */
import { CONTROL, EASE, MOTION, RADIUS, SHADOW, SIZE, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Send composition stylesheet fragment consumed after the shared Send layer.
 */
export const SEND_COMPOSE_STYLES = `
  .sr-only {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    text-wrap: nowrap;
    width: 1px;
  }
  .send-flow-header .flow-title { text-align: center; }
  .send-flow-header .flow-title h1 {
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
  }
  .send-flow .section { min-width: 0; }
  .send-flow form { gap: ${SPACE.md}; }
  .send-stage { align-content: start; }
  .send-stage-kicker {
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
    margin: 0;
  }

  .send-network-context {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: flex;
    gap: ${SPACE.md};
    min-height: ${SIZE.tile};
    padding: ${SPACE.md};
  }
  .send-network-mark {
    align-items: center;
    color: var(--mc-text);
    display: inline-flex;
    flex: none;
    height: ${SIZE.mark};
    justify-content: center;
    width: ${SIZE.mark};
  }
  .send-network-mark .token-logo {
    height: ${SIZE.mark};
    width: ${SIZE.mark};
  }
  .send-network-context > span:last-child { display: grid; gap: 2px; }
  .send-network-context small,
  .send-asset-copy span,
  .send-recipient-copy code,
  .send-asset-value span {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .send-network-context strong { font-size: ${TYPE.body.size}; }
  .network-inline-value {
    align-items: center;
    display: inline-flex;
    gap: ${SPACE.sm};
  }
  .network-inline-mark {
    display: inline-flex;
    flex: none;
    height: ${SPACE.xl};
    width: ${SPACE.xl};
  }
  .network-inline-mark .token-logo {
    height: 100%;
    width: 100%;
  }

  .send-search { gap: ${SPACE.sm}; }
  .send-search > span:first-child:not(.sr-only) {
    color: var(--mc-text);
    font-size: ${TYPE.title.size};
  }
  .send-search-control {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    display: flex;
    gap: ${SPACE.sm};
    min-height: ${SIZE.control};
    padding-left: ${SPACE.md};
  }
  .send-search-control > .icon { color: var(--mc-muted); flex: none; }
  .send-search-control input {
    background: transparent;
    border-radius: 0 ${RADIUS.lg} ${RADIUS.lg} 0;
    padding-left: 0;
  }
  .send-search-control input:focus-visible { outline: 0; }
  .send-search-control:has(input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--mc-focus-ring);
  }
  .send-recipient-tabs {
    border-bottom: 1px solid var(--mc-hairline);
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .send-recipient-tabs button {
    background: transparent;
    border-radius: 0;
    color: var(--mc-muted);
    min-height: ${CONTROL.hit};
    padding: 0 ${SPACE.sm};
    position: relative;
  }
  .send-recipient-tabs button[aria-selected="true"] { color: var(--mc-text); }
  .send-recipient-tabs button[aria-selected="true"]::after {
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    bottom: -1px;
    content: "";
    height: 2px;
    inset-inline: ${SPACE.sm};
    position: absolute;
  }
  @media (hover: hover) and (pointer: fine) {
    .send-recipient-tabs button:not(:disabled):hover {
      background: transparent;
      color: var(--mc-text);
    }
  }
  .send-recipient-tabs button:not(:disabled):active {
    background: transparent;
    color: var(--mc-text);
  }
  .send-recipient-list, .send-asset-list { display: grid; gap: ${SPACE.sm}; }
  .send-list-heading {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
  }
  .send-list-heading > .icon { height: ${CONTROL.icon}; width: ${CONTROL.icon}; }
  .send-list-heading > strong:first-of-type { color: var(--mc-text); margin-right: auto; }
  .send-recipient-row, .send-asset-row {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    min-height: ${SIZE.tile};
    padding: ${SPACE.md};
    text-align: left;
  }
  @media (hover: hover) and (pointer: fine) {
    .send-recipient-row:not(:disabled):hover,
    .send-asset-row:not(:disabled):hover {
      background: var(--mc-hover);
      color: var(--mc-text);
    }
  }
  .send-recipient-row:not(:disabled):active,
  .send-asset-row:not(:disabled):active {
    background: var(--mc-soft-press);
    color: var(--mc-text);
  }
  .send-recipient-row:focus-visible,
  .send-asset-row:focus-visible {
    outline-offset: -2px;
  }
  .send-recipient-row {
    align-items: center;
    grid-template-columns: ${SIZE.mark} minmax(0, 1fr) auto;
  }
  .send-recipient-row > .icon { color: var(--mc-muted); height: 16px; width: 16px; }
  .send-recipient-avatar {
    border-radius: ${RADIUS.full};
    height: ${SIZE.mark};
    overflow: hidden;
    width: ${SIZE.mark};
  }
  .send-recipient-avatar .avatar { height: 100%; width: 100%; }
  .send-recipient-copy { display: grid; gap: 2px; min-width: 0; padding: 0 ${SPACE.md}; }
  .send-recipient-copy strong,
  .send-recipient-copy code {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  #send-recipient-continue { width: 100%; }

  .send-amount-card {
    background: var(--mc-panel);
    border-radius: ${RADIUS.xl};
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.lg};
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      box-shadow ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .send-amount-card:has(.send-amount-field input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--mc-focus-ring);
  }
  .send-token-trigger {
    background: var(--mc-elevated);
    color: var(--mc-text);
    justify-self: start;
    min-height: ${CONTROL.hit};
    padding: 0 ${SPACE.md};
  }
  @media (hover: hover) and (pointer: fine) {
    .send-token-trigger:not(:disabled):hover {
      background: var(--mc-hover);
      color: var(--mc-text);
    }
  }
  .send-token-trigger:not(:disabled):active {
    background: var(--mc-soft-press);
    color: var(--mc-text);
  }
  .send-token-trigger > span:first-child,
  .send-token-trigger > span:first-child > svg,
  .send-token-trigger .token-mark {
    height: 26px;
    width: 26px;
  }
  .send-token-trigger .icon { height: 15px; width: 15px; }
  .send-amount-field {
    align-items: center;
    display: flex;
    justify-content: flex-end;
  }
  .send-amount-field input {
    background: transparent;
    border-radius: 0;
    font-size: ${TYPE.amount.size};
    font-variant-numeric: tabular-nums;
    font-weight: ${WEIGHT.semibold};
    min-height: 52px;
    padding: 0;
    text-align: right;
  }
  .send-amount-field input:focus-visible {
    background: transparent;
    outline: 0;
  }
  .send-amount-prefix {
    color: var(--mc-muted);
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.semibold};
  }
  .send-amount-meta {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
  }
  .send-amount-shortcuts { align-items: center; display: flex; gap: ${SPACE.xs}; }
  .send-amount-shortcuts button {
    background: transparent;
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
  }
  .send-amount-shortcuts #send-unit-toggle {
    background: var(--mc-elevated);
    color: var(--mc-text);
  }
  @media (hover: hover) and (pointer: fine) {
    .send-amount-shortcuts button:not(:disabled):hover {
      background: var(--mc-hover);
      color: var(--mc-text);
    }
  }
  .send-amount-shortcuts button:not(:disabled):active {
    background: var(--mc-soft-press);
    color: var(--mc-text);
  }
  .send-amount-shortcuts .icon { height: 14px; width: 14px; }
  .send-fiat-estimate {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    margin: -${SPACE.sm} 0 0;
    text-align: right;
  }
  .send-context-receipt {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    margin: 0;
    padding: 0 ${SPACE.lg};
  }
  .send-context-receipt > div,
  .send-review-facts > div {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
    min-height: ${SIZE.rowCompact};
    position: relative;
  }
  .send-context-receipt > div + div::before,
  .send-review-facts > div + div::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .send-context-receipt dt,
  .send-review-facts dt { color: var(--mc-muted); font-size: ${TYPE.label.size}; }
  .send-context-receipt dd,
  .send-review-facts dd {
    display: grid;
    gap: 2px;
    justify-items: end;
    margin: 0;
    max-width: 70%;
    min-width: 0;
  }
  .send-context-receipt code,
  .send-review-facts code { color: var(--mc-muted); font-size: ${TYPE.micro.size}; }
  #send-review-button { margin-top: auto; width: 100%; }

  .send-asset-stage { gap: ${SPACE.lg}; }
  .send-asset-search .send-search-control { background: var(--mc-panel); }
  .send-asset-row {
    align-items: center;
    grid-template-columns: ${SIZE.mark} minmax(0, 1fr) auto;
  }
  .send-asset-glyph,
  .send-asset-glyph > svg,
  .send-asset-glyph .token-mark {
    height: ${SIZE.mark};
    width: ${SIZE.mark};
  }
  .send-asset-copy { display: grid; gap: 2px; min-width: 0; padding: 0 ${SPACE.md}; }
  .send-asset-copy strong,
  .send-asset-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-asset-spam {
    color: var(--mc-danger);
    font-style: normal;
    font-weight: ${WEIGHT.semibold};
  }
  .send-asset-value { display: grid; gap: 2px; justify-items: end; }
  .send-asset-value strong { font-variant-numeric: tabular-nums; }
  .send-asset-change[data-direction="down"] { color: var(--mc-danger); }
  .send-asset-change[data-direction="up"] { color: var(--mc-positive); }

  .send-review-summary {
    background: var(--mc-panel);
    border-radius: ${RADIUS.xl};
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
  .send-review-hero small { color: var(--mc-muted); }
  .send-review-facts { border-top: 1px solid var(--mc-hairline); margin: 0; }
  .send-review-disclosure {
    background: var(--mc-panel);
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
    color: var(--mc-muted);
    transition: transform ${MOTION.tabMs}ms ${EASE.out};
  }
  .send-review-disclosure[open] summary .icon { transform: rotate(180deg); }
  .send-review-disclosure-body {
    border-top: 1px solid var(--mc-hairline);
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.md};
  }
  .send-review-note { color: var(--mc-muted); font-size: ${TYPE.caption.size}; margin: 0; }

  .send-task-list { box-shadow: ${SHADOW.xs}; }
  .send-task-list li { min-height: ${CONTROL.hit}; }
  .send-liveness { color: var(--mc-muted); margin: -${SPACE.sm} 0 0; }

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
  .send-success .send-outcome-mark { color: var(--mc-positive); }
  .send-failure .send-outcome-mark { color: var(--mc-danger); }
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
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
    max-width: 30ch;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-outcome-kicker {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.semibold};
  }
  .send-outcome .send-actions { width: 100%; }

  @media (prefers-reduced-motion: reduce) {
    .send-review-disclosure summary .icon { transition: none; }
    .send-failure-ring, .send-failure-mark { animation: none; stroke-dashoffset: 0; }
  }
`;
