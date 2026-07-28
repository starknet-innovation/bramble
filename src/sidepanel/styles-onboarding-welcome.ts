/**
 * Welcome-screen motion separated from the onboarding form system. The pulse
 * and orbiting sparks are restrained, framework-free adaptations of Amicro
 * motion ideas; see THIRD_PARTY_NOTICES.md.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Full-screen onboarding welcome composition and motion.
 */
export const ONBOARDING_WELCOME_STYLES = `
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
  .orbit-field {
    --orbit-inner-size: 206px;
    --orbit-outer-size: 286px;
    height: 330px;
    position: relative;
    width: 330px;
  }
  .orbit-ring {
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--mc-hairline-strong);
    left: 50%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .orbit-ring-outer {
    height: var(--orbit-outer-size);
    width: var(--orbit-outer-size);
  }
  .orbit-ring-inner {
    height: var(--orbit-inner-size);
    width: var(--orbit-inner-size);
  }
  .orbit-track {
    --orbit-delay: 0ms;
    --orbit-duration: 24s;
    animation: onboarding-track-orbit var(--orbit-duration) linear var(--orbit-delay) infinite;
    border-radius: ${RADIUS.full};
    height: var(--orbit-outer-size);
    left: 50%;
    pointer-events: none;
    position: absolute;
    top: 50%;
    width: var(--orbit-outer-size);
  }
  .orbit-track-inner {
    --orbit-duration: 18s;
    height: var(--orbit-inner-size);
    width: var(--orbit-inner-size);
  }
  .orbit-track-b { --orbit-delay: -12s; }
  .orbit-track-c { --orbit-delay: -4.5s; }
  .orbit-track-d { --orbit-delay: -13.5s; }
  .orbit-track-spark-a { --orbit-delay: -6s; --orbit-duration: 16s; }
  .orbit-track-spark-b { --orbit-delay: -13s; --orbit-duration: 20s; }
  .orbit-node, .orbit-spark {
    left: 100%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .orbit-node-surface {
    align-items: center;
    animation: onboarding-counter-orbit var(--orbit-duration) linear var(--orbit-delay) infinite;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    box-shadow: var(--mc-elev-xs);
    display: flex;
    height: 42px;
    justify-content: center;
    width: 42px;
  }
  .orbit-node .icon { height: 17px; width: 17px; }
  .orbit-spark {
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    height: 6px;
    width: 6px;
  }
  .orbit-pulse {
    animation: onboarding-concentric-pulse ${MOTION.waitLoopMs}ms var(--ease-out) infinite;
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--mc-hairline-strong);
    height: 104px;
    left: 50%;
    opacity: 0;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) scale(1);
    width: 104px;
  }
  .orbit-pulse-b { animation-delay: ${MOTION.pulseStaggerMs}ms; }
  .orbit-pulse-c { animation-delay: ${MOTION.pulseStaggerMs * 2}ms; }
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
    left: 50%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%) rotate(-3deg);
    width: 104px;
  }
  .orbit-core strong { font-size: 29px; letter-spacing: -0.08em; line-height: 1; }
  .orbit-core span { font-size: ${TYPE.micro.size}; font-weight: ${WEIGHT.semibold}; margin-top: 5px; }
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
  @keyframes onboarding-track-orbit {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to { transform: translate(-50%, -50%) rotate(360deg); }
  }
  @keyframes onboarding-counter-orbit {
    from { transform: rotate(0deg); }
    to { transform: rotate(-360deg); }
  }
  @keyframes onboarding-concentric-pulse {
    0% { opacity: 0.42; transform: translate(-50%, -50%) scale(1); }
    74%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.7); }
  }
  @media (hover: hover) and (pointer: fine) {
    .onboarding-launch:hover { color: var(--mc-text); }
  }
  @media (max-height: 760px) {
    .onboarding-orbit { min-height: 260px; transform: scale(0.88); }
  }
  @media (prefers-reduced-motion: reduce) {
    .orbit-track, .orbit-node-surface, .orbit-pulse { animation: none; }
    .orbit-pulse { display: none; }
    .orbit-track { transform: translate(-50%, -50%) rotate(0deg); }
    .orbit-track-b { transform: translate(-50%, -50%) rotate(180deg); }
    .orbit-track-c { transform: translate(-50%, -50%) rotate(90deg); }
    .orbit-track-d { transform: translate(-50%, -50%) rotate(270deg); }
    .orbit-track-spark-a { transform: translate(-50%, -50%) rotate(45deg); }
    .orbit-track-spark-b { transform: translate(-50%, -50%) rotate(225deg); }
  }
`;
