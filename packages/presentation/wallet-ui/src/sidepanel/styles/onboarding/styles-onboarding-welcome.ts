/**
 * Welcome-screen motion separated from the onboarding form system. The pulse
 * and orbital choreography are restrained, framework-free adaptations of Amicro
 * motion ideas; see THIRD_PARTY_NOTICES.md.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

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
    min-height: 400px;
    position: relative;
    width: min(100%, 400px);
  }
  .orbit-field {
    --orbit-core-size: 150px;
    --orbit-inner-size: 200px;
    --orbit-middle-size: 250px;
    --orbit-outer-size: 350px;
    --orbit-wide-size: 300px;
    height: 400px;
    position: relative;
    width: 400px;
  }
  .orbit-ring {
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline-strong);
    left: 50%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .orbit-ring-outer {
    height: var(--orbit-outer-size);
    width: var(--orbit-outer-size);
  }
  .orbit-ring-wide {
    height: var(--orbit-wide-size);
    width: var(--orbit-wide-size);
  }
  .orbit-ring-middle {
    height: var(--orbit-middle-size);
    width: var(--orbit-middle-size);
  }
  .orbit-ring-inner {
    height: var(--orbit-inner-size);
    width: var(--orbit-inner-size);
  }
  .orbit-ring-core {
    height: var(--orbit-core-size);
    width: var(--orbit-core-size);
  }
  .orbit-track {
    --orbit-delay: 0ms;
    --orbit-duration: 600s;
    animation: onboarding-track-orbit var(--orbit-duration) linear var(--orbit-delay) infinite;
    border-radius: ${RADIUS.full};
    height: var(--orbit-outer-size);
    left: 50%;
    pointer-events: none;
    position: absolute;
    top: 50%;
    width: var(--orbit-outer-size);
  }
  .orbit-track-wide {
    height: var(--orbit-wide-size);
    width: var(--orbit-wide-size);
  }
  .orbit-track-middle {
    height: var(--orbit-middle-size);
    width: var(--orbit-middle-size);
  }
  .orbit-track-inner {
    height: var(--orbit-inner-size);
    width: var(--orbit-inner-size);
  }
  .orbit-track-core {
    height: var(--orbit-core-size);
    width: var(--orbit-core-size);
  }
  .orbit-track-reverse {
    animation-name: onboarding-track-orbit-reverse;
  }
  .orbit-track-outer-b { --orbit-delay: -300s; }
  .orbit-track-wide-a { --orbit-delay: -450s; }
  .orbit-track-middle-a { --orbit-delay: -33.33s; }
  .orbit-track-middle-b { --orbit-delay: -333.33s; }
  .orbit-track-inner-a { --orbit-delay: -116.67s; }
  .orbit-track-core-a { --orbit-delay: -183.33s; }
  .orbit-node {
    left: 100%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .orbit-node-surface {
    align-items: center;
    animation: onboarding-counter-orbit var(--orbit-duration) linear var(--orbit-delay) infinite;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.full};
    box-shadow: var(--bramble-elev-xs);
    display: flex;
    height: 42px;
    justify-content: center;
    width: 42px;
  }
  .orbit-track-reverse .orbit-node-surface {
    animation-name: onboarding-counter-orbit-reverse;
  }
  .orbit-track-core .orbit-node-surface {
    height: 32px;
    width: 32px;
  }
  .orbit-node .icon { height: 17px; width: 17px; }
  .orbit-track-core .icon { height: 14px; width: 14px; }
  .orbit-pulse {
    animation: onboarding-concentric-pulse ${MOTION.onboardingPulseMs}ms var(--ease-out) infinite;
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline-strong);
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
    background: var(--bramble-text);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--bramble-elev-md);
    color: var(--bramble-bg);
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
    color: var(--bramble-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    justify-content: center;
    min-height: 34px;
    text-decoration: none;
  }
  .onboarding-local-note {
    align-items: center;
    color: var(--bramble-muted);
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
  @keyframes onboarding-track-orbit-reverse {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to { transform: translate(-50%, -50%) rotate(-360deg); }
  }
  @keyframes onboarding-counter-orbit {
    from { transform: rotate(0deg); }
    to { transform: rotate(-360deg); }
  }
  @keyframes onboarding-counter-orbit-reverse {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes onboarding-concentric-pulse {
    0% { opacity: 0.42; transform: translate(-50%, -50%) scale(1); }
    74%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.7); }
  }
  @media (hover: hover) and (pointer: fine) {
    .onboarding-launch:hover { color: var(--bramble-text); }
  }
  @media (max-width: 400px) {
    .orbit-field {
      --orbit-core-size: min(150px, calc(100vw - 224px));
      --orbit-inner-size: min(200px, calc(100vw - 180px));
      --orbit-middle-size: min(250px, calc(100vw - 136px));
      --orbit-outer-size: min(350px, calc(100vw - 48px));
      --orbit-wide-size: min(300px, calc(100vw - 92px));
      height: 100vw;
      width: 100vw;
    }
  }
  @media (max-height: 760px) {
    .onboarding-orbit { min-height: 260px; transform: scale(0.88); }
  }
  @media (prefers-reduced-motion: reduce) {
    .orbit-track, .orbit-node-surface, .orbit-pulse { animation: none; }
    .orbit-pulse { display: none; }
    .orbit-track-outer-a { transform: translate(-50%, -50%) rotate(18deg); }
    .orbit-track-outer-b { transform: translate(-50%, -50%) rotate(198deg); }
    .orbit-track-wide-a { transform: translate(-50%, -50%) rotate(322deg); }
    .orbit-track-middle-a { transform: translate(-50%, -50%) rotate(92deg); }
    .orbit-track-middle-b { transform: translate(-50%, -50%) rotate(272deg); }
    .orbit-track-inner-a { transform: translate(-50%, -50%) rotate(148deg); }
    .orbit-track-core-a { transform: translate(-50%, -50%) rotate(0deg); }
  }
`;
