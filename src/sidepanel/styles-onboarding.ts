/**
 * Dedicated expanded-tab onboarding layout. It reuses the production gate
 * template and bindings while giving first-run setup room to breathe.
 */
import { RADIUS, SPACE } from "../ui/tokens";

/**
 * Full-page and side-panel onboarding surface styles.
 */
export const ONBOARDING_STYLES = `
  .onboarding-launch {
    align-items: center;
    background: var(--mc-accent);
    border-radius: ${RADIUS.md};
    color: var(--mc-accent-text);
    display: inline-flex;
    font-weight: 700;
    justify-content: center;
    min-height: 44px;
    padding: 0 ${SPACE.lg};
    text-decoration: none;
    width: 100%;
  }
  .onboarding-launch:active {
    background: var(--mc-accent-press);
    transform: scale(0.98);
  }
  .onboarding-surface .onboarding-launch { display: none; }
  body.onboarding-surface { min-width: 320px; }
  .onboarding-surface #app { min-height: 100vh; }
  .onboarding-surface .shell {
    margin: 0 auto;
    max-width: 1120px;
    min-height: 100vh;
    padding: clamp(28px, 5vw, 72px);
    width: 100%;
  }
  .onboarding-surface .screen.gate:not(.onboarding-complete) {
    align-content: center;
    align-items: stretch;
    display: grid;
    gap: clamp(24px, 4vw, 52px);
    grid-template-areas:
      "brand form"
      "intro form"
      "ledger form";
    grid-template-columns: minmax(260px, 0.78fr) minmax(440px, 1.22fr);
    grid-template-rows: auto auto 1fr;
    padding: 0;
    text-align: left;
  }
  .onboarding-surface .screen.gate:not(.onboarding-complete) > .gate-brand {
    align-self: end;
    grid-area: brand;
    margin: 0;
  }
  .onboarding-surface .screen.gate:not(.onboarding-complete) > .gate-head {
    align-self: start;
    grid-area: intro;
    max-width: 30rem;
  }
  .onboarding-surface .screen.gate:not(.onboarding-complete) > #create-form {
    align-self: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--mc-shadow-sm);
    flex: none;
    grid-area: form;
    padding: clamp(22px, 3vw, 34px);
  }
  .onboarding-surface .screen.gate:not(.onboarding-complete) > .gate-alt {
    align-self: start;
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-shadow-sm);
    grid-area: ledger;
    padding: ${SPACE.lg};
  }
  .onboarding-complete {
    align-content: center;
    justify-items: center;
    margin: auto;
    max-width: 560px;
    padding: clamp(32px, 8vw, 96px) 0;
    text-align: center;
  }
  .onboarding-complete .gate-brand { margin: 0; }
  .onboarding-complete-actions {
    display: grid;
    gap: ${SPACE.sm};
    max-width: 320px;
    width: 100%;
  }
  .onboarding-complete-actions button { width: 100%; }
  @media (hover: hover) and (pointer: fine) {
    .onboarding-launch:hover { background: var(--mc-accent-hover); }
  }
  @media (max-width: 840px) {
    .onboarding-surface .shell {
      max-width: 680px;
      padding: clamp(22px, 6vw, 48px);
    }
    .onboarding-surface .screen.gate:not(.onboarding-complete) {
      grid-template-areas:
        "brand"
        "intro"
        "form"
        "ledger";
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
    }
  }
`;
