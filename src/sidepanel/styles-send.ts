/**
 * Send and Ledger-signing progress layer. The four-step rail gives the journey
 * a persistent map; live task rows expose exactly what the wallet is doing.
 * Motion is reserved for active work and the final submitted receipt, with a
 * complete reduced-motion cut.
 */
import { CONTROL, EASE, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Send-flow stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const SEND_STYLES = `
  .send-flow, .send-flow form, .send-stage { display: grid; gap: ${SPACE.lg}; }
  .send-flow form { min-width: 0; }
  .send-stage-frame {
    display: grid;
    gap: ${SPACE.sm};
    min-width: 0;
    view-transition-name: send-stage;
  }
  .send-progress {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .send-progress li {
    align-items: center;
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.medium};
    gap: 6px;
    justify-items: center;
    min-width: 0;
    position: relative;
    text-align: center;
  }
  .send-progress li + li::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    position: absolute;
    right: 50%;
    top: 13px;
    width: 100%;
    z-index: 0;
  }
  .send-progress li[data-state="done"] + li::before,
  .send-progress li[data-state="done"]::before { background: var(--mc-positive); }
  .send-step-mark {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    display: inline-flex;
    font-size: ${TYPE.micro.size};
    height: 26px;
    justify-content: center;
    position: relative;
    transition: background ${MOTION.tabMs}ms var(--ease-out), color ${MOTION.tabMs}ms var(--ease-out), transform ${MOTION.tabMs}ms var(--spring-snappy);
    width: 26px;
    z-index: 1;
  }
  .send-progress li[data-state="active"] { color: var(--mc-text); font-weight: ${WEIGHT.semibold}; }
  .send-progress li[data-state="active"] .send-step-mark {
    background: var(--mc-accent);
    color: var(--mc-bg);
    transform: scale(1.06);
  }
  .send-progress li[data-state="done"] .send-step-mark {
    background: var(--mc-positive-soft);
    color: var(--mc-positive);
  }
  html[data-send-transition]::view-transition-old(root),
  html[data-send-transition]::view-transition-new(root) { animation: none; }
  ::view-transition-group(send-stage) {
    animation-duration: 260ms;
    animation-timing-function: ${EASE.out};
  }
  ::view-transition-image-pair(send-stage) { isolation: auto; }
  ::view-transition-old(send-stage), ::view-transition-new(send-stage) {
    mix-blend-mode: normal;
  }
  html[data-send-transition="forward"]::view-transition-old(send-stage) {
    animation: send-stage-out-left 150ms ${EASE.out} both;
  }
  html[data-send-transition="forward"]::view-transition-new(send-stage) {
    animation: send-stage-in-right 260ms ${EASE.out} both;
  }
  html[data-send-transition="back"]::view-transition-old(send-stage) {
    animation: send-stage-out-right 150ms ${EASE.out} both;
  }
  html[data-send-transition="back"]::view-transition-new(send-stage) {
    animation: send-stage-in-left 260ms ${EASE.out} both;
  }
  @keyframes send-stage-in-right {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes send-stage-out-left {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(-8px); }
  }
  @keyframes send-stage-in-left {
    from { opacity: 0; transform: translateX(-12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes send-stage-out-right {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(8px); }
  }
  .send-review-head {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
  }
  .send-review-head > div { display: grid; gap: 2px; }
  .send-review-head h2 { font-size: ${TYPE.title.size}; }
  .send-stage .receipt-row dd {
    justify-content: flex-end;
    max-width: 72%;
    min-width: 0;
  }
  .send-stage .receipt-row dd code {
    overflow-wrap: anywhere;
    text-wrap: wrap;
    word-break: break-all;
  }
  .send-actions { display: grid; gap: ${SPACE.sm}; }
  .send-actions > button:first-child { width: 100%; }
  .send-result {
    color: var(--mc-danger);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    margin: 0;
    min-height: ${TYPE.caption.line};
    text-align: center;
  }
  .send-result:empty { display: none; }

  .send-working {
    align-content: center;
    display: grid;
    gap: ${SPACE.lg};
    justify-items: center;
    min-height: 340px;
    text-align: center;
  }
  .send-working-mark {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    height: 64px;
    justify-content: center;
    width: 64px;
  }
  .send-working-mark .icon {
    animation: send-spin 900ms linear infinite;
    height: ${SPACE.xl};
    width: ${SPACE.xl};
  }
  @keyframes send-spin { to { transform: rotate(360deg); } }
  .send-working-copy { display: grid; gap: ${SPACE.sm}; max-width: 30ch; }
  .send-working-copy h2 { font-size: ${TYPE.title.size}; }
  .send-working-copy p {
    color: var(--mc-muted);
    font-size: ${TYPE.body.size};
    line-height: ${TYPE.body.line};
    margin: 0;
  }
  .send-task-list, .ledger-task-list {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    list-style: none;
    margin: 0;
    padding: ${SPACE.sm} ${SPACE.lg};
    text-align: left;
    width: 100%;
  }
  .send-task-list li {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.md};
    min-height: ${CONTROL.hit};
    position: relative;
  }
  .send-task-list li + li::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto 24px;
    position: absolute;
  }
  .send-task-list li > span:first-child {
    background: var(--mc-hairline-strong);
    border-radius: ${RADIUS.full};
    flex: none;
    height: ${SPACE.sm};
    width: ${SPACE.sm};
  }
  .send-task-list li[data-state="done"] { color: var(--mc-text); }
  .send-task-list li[data-state="done"] > span:first-child { background: var(--mc-positive); }
  .send-task-list li[data-state="active"] {
    color: var(--mc-text);
    font-weight: ${WEIGHT.semibold};
  }
  .send-task-list li[data-state="active"] > span:first-child {
    animation: send-pulse 1100ms var(--ease-in-out) infinite;
    background: var(--mc-accent);
  }
  @keyframes send-pulse {
    50% { box-shadow: 0 0 0 5px var(--mc-accent-soft); transform: scale(0.82); }
  }

  .send-success {
    align-content: center;
    display: grid;
    gap: ${SPACE.lg};
    justify-items: center;
    min-height: 360px;
    text-align: center;
  }
  .send-success-mark { color: var(--mc-positive); display: inline-flex; height: 72px; width: 72px; }
  .send-success-mark svg {
    fill: none;
    height: 100%;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.2;
    width: 100%;
  }
  .send-success-ring {
    animation: send-draw 480ms var(--ease-out) 40ms forwards;
    stroke-dasharray: 158;
    stroke-dashoffset: 158;
  }
  .send-success-check {
    animation: send-draw 280ms var(--ease-out) 430ms forwards;
    stroke-dasharray: 32;
    stroke-dashoffset: 32;
  }
  @keyframes send-draw { to { stroke-dashoffset: 0; } }
  .send-success-copy { display: grid; gap: ${SPACE.sm}; justify-items: center; }
  .send-success-copy h2 { font-size: ${TYPE.display.size}; }
  .send-success-copy p { margin: 0; }
  .send-success-copy code {
    color: var(--mc-muted);
    display: block;
    font-size: ${TYPE.micro.size};
    max-width: 30ch;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-success .send-actions { width: 100%; }

  .ledger-sign-screen { align-content: center; min-height: 0; }
  .ledger-progress-card {
    align-content: center;
    display: grid;
    gap: ${SPACE.xl};
    min-height: 100%;
    padding: ${SPACE.md} 0;
  }
  .ledger-progress-hero {
    display: grid;
    gap: ${SPACE.sm};
    justify-items: center;
    text-align: center;
  }
  .ledger-device-mark {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    height: 64px;
    justify-content: center;
    margin-bottom: ${SPACE.xs};
    width: 64px;
  }
  .ledger-device-mark .icon { height: ${SPACE.xl}; width: ${SPACE.xl}; }
  .ledger-progress-card:not([data-phase="connect"]):not([data-phase="devices"]):not([data-phase="error"]) .ledger-device-mark .icon {
    animation: send-pulse-icon 1400ms var(--ease-in-out) infinite;
  }
  @keyframes send-pulse-icon { 50% { opacity: 0.55; transform: scale(0.9); } }
  .ledger-progress-hero h2 { font-size: ${TYPE.title.size}; }
  .ledger-signer-line {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: ${TYPE.caption.size};
    gap: 5px;
    justify-content: center;
  }
  .ledger-signer-line code { color: var(--mc-text); }
  .ledger-signer-line span:last-child::before { content: "·"; margin-right: 5px; }
  .ledger-task-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: ${SPACE.md};
    text-align: center;
  }
  .ledger-task-list li {
    align-items: center;
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.micro.size};
    gap: 6px;
    justify-items: center;
    min-width: 0;
  }
  .ledger-task-mark {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    display: inline-flex;
    height: 24px;
    justify-content: center;
    width: 24px;
  }
  .ledger-task-mark .icon { height: 13px; width: 13px; }
  .ledger-task-list li[data-state="active"] { color: var(--mc-text); font-weight: ${WEIGHT.semibold}; }
  .ledger-task-list li[data-state="active"] .ledger-task-mark { background: var(--mc-accent); color: var(--mc-bg); }
  .ledger-task-list li[data-state="done"] { color: var(--mc-text); }
  .ledger-task-list li[data-state="done"] .ledger-task-mark { background: var(--mc-positive-soft); color: var(--mc-positive); }
  .ledger-phase-body {
    display: grid;
    font-size: ${TYPE.body.size};
    gap: ${SPACE.lg};
    line-height: ${TYPE.body.line};
    text-align: center;
  }
  .ledger-phase-body > p { color: var(--mc-muted); margin: 0 auto; max-width: 34ch; }
  .ledger-phase-body > .review-flag { color: var(--mc-danger); }
  .ledger-phase-actions { display: grid; gap: ${SPACE.sm}; }
  .ledger-phase-actions button { width: 100%; }
  .ledger-phase-actions .ghost, .ledger-phase-body > .ghost { justify-self: center; width: auto; }

  @media (prefers-reduced-motion: reduce) {
    html[data-send-transition]::view-transition-group(send-stage),
    html[data-send-transition]::view-transition-old(send-stage),
    html[data-send-transition]::view-transition-new(send-stage),
    .send-working-mark .icon,
    .send-task-list li[data-state="active"] > span:first-child,
    .send-success-ring,
    .send-success-check,
    .ledger-device-mark .icon { animation: none; }
    .send-success-ring, .send-success-check { stroke-dashoffset: 0; }
    .send-progress li[data-state="active"] .send-step-mark { transform: none; }
  }
`;
