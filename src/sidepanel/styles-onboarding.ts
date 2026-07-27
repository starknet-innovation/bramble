/**
 * Focused first-run layout. Each decision occupies the same stable wallet
 * stage, while one restrained orbital motif gives setup a distinct motion
 * language without introducing new colour semantics.
 */
import { EASE, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

const ONBOARDING_TRANSITION = {
  enterMs: 300,
  enterTravel: "28px",
  exitMs: 210,
  exitTravel: "18px",
} as const;

/**
 * Full-page onboarding and compact toolbar-handoff styles.
 */
export const ONBOARDING_STYLES = `
  body.onboarding-surface { min-width: 320px; }
  .onboarding-surface #app { min-height: 100vh; }
  .onboarding-surface .shell {
    --onboarding-canvas-y: clamp(16px, 3vh, 48px);
    align-items: center;
    justify-content: center;
    margin: 0 auto;
    max-width: none;
    min-height: 100vh;
    padding: var(--onboarding-canvas-y) clamp(24px, 5vw, 64px);
    width: 100%;
  }
  .onboarding-wizard {
    align-items: stretch;
    background: var(--mc-panel);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--mc-elev-md);
    display: block;
    flex: none;
    gap: 0;
    min-height: min(
      720px,
      calc(100vh - var(--onboarding-canvas-y) - var(--onboarding-canvas-y))
    );
    overflow: hidden;
    padding: 0;
    position: relative;
    text-align: left;
    width: min(100%, 520px);
  }
  .onboarding-flow { display: block; height: 100%; min-height: inherit; }
  .onboarding-step {
    align-items: stretch;
    display: flex;
    flex-direction: column;
    gap: ${SPACE.lg};
    min-height: inherit;
    outline: none;
    overflow-y: auto;
    padding: 38px clamp(24px, 7vw, 42px) 30px;
    position: relative;
  }
  .onboarding-wizard > .onboarding-step {
    inset: 0;
    min-height: 100%;
    position: absolute;
    width: 100%;
  }
  .onboarding-step:not([hidden]) { view-transition-name: onboarding-stage; }
  .onboarding-step.is-entering {
    animation: onboarding-step-forward-enter ${ONBOARDING_TRANSITION.enterMs}ms ${EASE.out} both;
  }
  .onboarding-step.is-entering[data-onboarding-enter="back"] {
    animation-name: onboarding-step-back-enter;
  }
  .onboarding-back {
    left: 22px;
    position: absolute;
    top: 22px;
    z-index: 1;
  }
  .onboarding-step-head {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    justify-items: center;
    margin: 46px auto ${SPACE.md};
    max-width: 420px;
    text-align: center;
  }
  .onboarding-step-head h1 {
    font-size: ${TYPE.headline.size};
    font-weight: ${WEIGHT.heavy};
    letter-spacing: -0.035em;
    line-height: ${TYPE.headline.line};
    text-wrap: balance;
  }
  .onboarding-step-head .lede { line-height: 1.55; max-width: 42ch; text-wrap: balance; }
  .onboarding-step-icon {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    display: inline-flex;
    height: 54px;
    justify-content: center;
    margin-bottom: ${SPACE.sm};
    width: 54px;
  }
  .onboarding-step-icon .icon { height: 24px; width: 24px; }
  .onboarding-fields, .onboarding-options {
    display: grid;
    gap: ${SPACE.md};
    width: 100%;
  }
  .onboarding-step-cta {
    display: grid;
    gap: ${SPACE.sm};
    margin-top: auto;
    padding-top: ${SPACE.lg};
    width: 100%;
  }
  .onboarding-step-cta button, .onboarding-welcome-actions button { width: 100%; }

  .onboarding-welcome {
    align-items: center;
    justify-content: flex-end;
    padding-top: 26px;
    text-align: center;
  }
  .onboarding-orbit {
    align-items: center;
    display: flex;
    flex: 1;
    justify-content: center;
    min-height: 330px;
    position: relative;
    width: min(100%, 330px);
  }
  .orbit-ring {
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--mc-hairline-strong);
    position: absolute;
  }
  .orbit-ring::before, .orbit-ring::after {
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    content: "";
    height: 5px;
    position: absolute;
    width: 5px;
  }
  .orbit-ring::before { left: 22%; top: -3px; }
  .orbit-ring::after { bottom: -3px; right: 22%; }
  .orbit-ring-outer {
    animation: onboarding-orbit 24s linear infinite;
    height: 286px;
    width: 286px;
  }
  .orbit-ring-inner {
    animation: onboarding-orbit 18s linear infinite reverse;
    height: 206px;
    width: 206px;
  }
  .orbit-core {
    align-items: center;
    background: var(--mc-text);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--mc-elev-md);
    color: var(--mc-bg);
    display: flex;
    flex-direction: column;
    height: 104px;
    justify-content: center;
    transform: rotate(-3deg);
    width: 104px;
  }
  .orbit-core strong { font-size: 29px; letter-spacing: -0.08em; line-height: 1; }
  .orbit-core span { font-size: ${TYPE.micro.size}; font-weight: ${WEIGHT.semibold}; margin-top: 5px; }
  .orbit-node {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    box-shadow: var(--mc-elev-xs);
    display: flex;
    height: 42px;
    justify-content: center;
    position: absolute;
    width: 42px;
  }
  .orbit-node .icon { height: 17px; width: 17px; }
  .orbit-node-a { left: 8px; top: 86px; }
  .orbit-node-b { right: 11px; top: 68px; }
  .orbit-node-c { bottom: 52px; left: 44px; }
  .orbit-node-d { bottom: 38px; right: 48px; }
  .orbit-node-a, .orbit-node-d { animation: onboarding-float 4.8s var(--ease-in-out) infinite alternate; }
  .orbit-node-b, .orbit-node-c { animation: onboarding-float 5.4s var(--ease-in-out) -1.8s infinite alternate-reverse; }
  .onboarding-welcome-actions { display: grid; gap: ${SPACE.sm}; width: 100%; }
  .onboarding-launch {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    justify-content: center;
    min-height: 34px;
    text-decoration: none;
  }
  .onboarding-local-note {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    gap: 6px;
    justify-content: center;
    margin-top: ${SPACE.sm};
  }
  .onboarding-local-note .icon { height: 13px; width: 13px; }

  .onboarding-gate {
    justify-content: center;
    min-height: 100vh;
    padding: ${SPACE.xl};
  }
  .onboarding-gate .gate-head { max-width: 34ch; }
  .onboarding-gate-actions {
    display: grid;
    gap: ${SPACE.md};
    margin-top: auto;
    width: 100%;
  }
  .onboarding-gate .onboarding-launch {
    align-items: center;
    background: var(--mc-text);
    border-radius: ${RADIUS.md};
    color: var(--mc-bg);
    display: inline-flex;
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
    justify-content: center;
    min-height: 46px;
    padding: 0 ${SPACE.lg};
    text-decoration: none;
  }

  .onboarding-option, .onboarding-account {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    gap: ${SPACE.md};
    justify-content: initial;
    min-height: 82px;
    padding: ${SPACE.md};
    text-align: left;
    width: 100%;
  }
  .onboarding-option {
    grid-template-columns: 44px minmax(0, 1fr) 20px;
  }
  .onboarding-option-icon, .onboarding-account-avatar, .onboarding-account-check {
    align-items: center;
    align-self: center;
    border-radius: ${RADIUS.full};
    display: flex;
    height: 40px;
    justify-content: center;
    width: 40px;
  }
  .onboarding-option-icon, .onboarding-account-avatar {
    background: var(--mc-panel);
    color: var(--mc-text);
  }
  .onboarding-option-icon .icon { height: 18px; width: 18px; }
  .onboarding-option > .icon {
    align-self: center;
    color: var(--mc-muted);
    height: 18px;
    transition: transform ${MOTION.liftMs}ms var(--ease-out);
    width: 18px;
  }
  .onboarding-option-copy, .onboarding-account-copy {
    align-self: center;
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .onboarding-option-copy strong, .onboarding-account-copy strong {
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
  }
  .onboarding-option-copy span, .onboarding-account-copy span {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .onboarding-account {
    grid-template-columns: 44px minmax(0, 1fr) 40px;
    min-height: 76px;
  }
  .onboarding-account-avatar {
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.bold};
  }
  .onboarding-account-check {
    background: var(--mc-text);
    color: var(--mc-bg);
    transform: scale(0.78);
    transition:
      opacity ${MOTION.liftMs}ms var(--ease-out),
      transform ${MOTION.liftMs}ms var(--ease-out);
  }
  .onboarding-account-check .icon { height: 17px; width: 17px; }
  .onboarding-account[aria-pressed="false"] .onboarding-account-check {
    opacity: 0;
    transform: scale(0.55);
  }
  .onboarding-account[aria-pressed="true"] {
    background: var(--mc-soft-press);
    box-shadow: var(--mc-elev-sm);
  }

  .recovery-grid {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .recovery-word {
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.caption.size};
    padding: 0 ${SPACE.sm};
    text-align: center;
  }
  .recovery-grid.is-masked .recovery-word {
    filter: blur(6px);
    pointer-events: none;
    user-select: none;
  }
  .onboarding-inline-action {
    background: transparent;
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    justify-self: center;
    min-height: 36px;
    padding: 0 ${SPACE.md};
  }
  .password-requirement {
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.caption.size};
    gap: 7px;
  }
  .password-requirement-bar {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    height: 4px;
    overflow: hidden;
  }
  .password-requirement-bar > span {
    background: var(--mc-muted);
    display: block;
    height: 100%;
    transform: scaleX(0.32);
    transform-origin: left;
    transition:
      background ${MOTION.enterMs}ms var(--ease-out),
      transform ${MOTION.enterMs}ms var(--ease-out);
  }
  .password-requirement.is-ready { color: var(--mc-positive); }
  .password-requirement.is-ready .password-requirement-bar > span {
    background: var(--mc-positive);
    transform: scaleX(1);
  }

  .onboarding-complete {
    align-content: center;
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--mc-elev-md);
    display: flex;
    flex: none;
    justify-content: center;
    margin: auto;
    min-height: min(660px, calc(100vh - 48px));
    padding: clamp(32px, 8vw, 68px);
    text-align: center;
    width: min(100%, 520px);
  }
  .onboarding-complete .gate-brand { margin: 0; }
  .onboarding-complete .gate-head { max-width: 38ch; }
  .onboarding-complete-mark {
    background: var(--mc-positive);
    color: var(--mc-accent-text);
  }
  .onboarding-complete-details {
    display: grid;
    gap: ${SPACE.sm};
    width: min(100%, 360px);
  }
  .onboarding-complete-detail {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    min-height: 44px;
    padding: 0 ${SPACE.md};
    text-align: left;
  }
  .onboarding-complete-detail .icon { color: var(--mc-text); height: 16px; width: 16px; }
  .onboarding-complete-actions {
    display: grid;
    gap: ${SPACE.sm};
    max-width: 320px;
    width: 100%;
  }
  .onboarding-complete-actions button { width: 100%; }

  html[data-onboarding-direction]::view-transition-old(root),
  html[data-onboarding-direction]::view-transition-new(root) { animation: none; }
  ::view-transition-group(onboarding-stage) {
    animation-duration: ${ONBOARDING_TRANSITION.enterMs}ms;
    animation-timing-function: ${EASE.out};
  }
  ::view-transition-image-pair(onboarding-stage) { isolation: auto; }
  ::view-transition-old(onboarding-stage) {
    animation-duration: ${ONBOARDING_TRANSITION.exitMs}ms;
    animation-timing-function: ${EASE.out};
  }
  html[data-onboarding-direction="forward"]::view-transition-old(onboarding-stage) {
    animation-name: onboarding-step-forward-exit;
  }
  html[data-onboarding-direction="forward"]::view-transition-new(onboarding-stage) {
    animation-name: onboarding-step-forward-enter;
  }
  html[data-onboarding-direction="back"]::view-transition-old(onboarding-stage) {
    animation-name: onboarding-step-back-exit;
  }
  html[data-onboarding-direction="back"]::view-transition-new(onboarding-stage) {
    animation-name: onboarding-step-back-enter;
  }
  @keyframes onboarding-step-forward-enter {
    from { opacity: 0; transform: translateX(${ONBOARDING_TRANSITION.enterTravel}) scale(0.992); }
    to { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes onboarding-step-forward-exit {
    from { opacity: 1; transform: translateX(0) scale(1); }
    to { opacity: 0; transform: translateX(-${ONBOARDING_TRANSITION.exitTravel}) scale(0.996); }
  }
  @keyframes onboarding-step-back-enter {
    from { opacity: 0; transform: translateX(-${ONBOARDING_TRANSITION.enterTravel}) scale(0.992); }
    to { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes onboarding-step-back-exit {
    from { opacity: 1; transform: translateX(0) scale(1); }
    to { opacity: 0; transform: translateX(${ONBOARDING_TRANSITION.exitTravel}) scale(0.996); }
  }
  @keyframes onboarding-orbit { to { transform: rotate(360deg); } }
  @keyframes onboarding-float {
    from { transform: translateY(-3px) rotate(-2deg); }
    to { transform: translateY(5px) rotate(3deg); }
  }
  @media (hover: hover) and (pointer: fine) {
    .onboarding-launch:hover { color: var(--mc-text); }
    button.onboarding-option:not(:disabled):hover,
    button.onboarding-account:not(:disabled):hover {
      background: var(--mc-hover);
      color: var(--mc-text);
    }
    button.onboarding-option:not(:disabled):hover .onboarding-option-copy span,
    button.onboarding-option:not(:disabled):hover > .icon {
      color: var(--mc-muted);
    }
    button.onboarding-option:not(:disabled):hover > .icon { transform: translateX(3px); }
    .onboarding-inline-action:hover { background: var(--mc-hover); color: var(--mc-text); }
  }
  @media (max-height: 760px) {
    .onboarding-step { min-height: inherit; padding-bottom: 22px; padding-top: 30px; }
    .onboarding-step-head { margin-bottom: ${SPACE.sm}; margin-top: 40px; }
    .onboarding-orbit { min-height: 260px; transform: scale(0.88); }
  }
  @media (max-width: 520px) {
    .onboarding-surface .shell { padding: 0; }
    .onboarding-wizard, .onboarding-complete {
      border-radius: 0;
      box-shadow: none;
      min-height: 100vh;
      width: 100%;
    }
    .onboarding-step { padding-left: ${SPACE.lg}; padding-right: ${SPACE.lg}; }
  }
  @media (prefers-reduced-motion: reduce) {
    .onboarding-step.is-entering, .orbit-ring, .orbit-node { animation: none; }
    .onboarding-account-check, .password-requirement-bar > span { transition: none; }
    html[data-onboarding-direction]::view-transition-group(onboarding-stage),
    html[data-onboarding-direction]::view-transition-old(onboarding-stage),
    html[data-onboarding-direction]::view-transition-new(onboarding-stage) { animation: none; }
  }
`;
