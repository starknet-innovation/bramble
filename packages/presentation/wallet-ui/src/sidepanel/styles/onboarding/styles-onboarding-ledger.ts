/**
 * The Ledger onboard overlay on the full-tab onboarding surface. The overlay is
 * a panel-sized sheet: on the side panel it fills a ~380px column, but here it
 * would fill the whole tab, hide the landscape and stretch every screen edge to
 * edge. On this surface it instead shows the landscape and sets each screen in
 * the same card as the wizard, which it hides while open, with a wizard step's
 * reading order: dark icon chip and headline at the top, actions at the foot.
 * The in-wallet add-account chooser keeps its own header layout.
 */
import { RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Full-tab presentation of the Ledger onboard overlay.
 */
export const ONBOARDING_LEDGER_STYLES = `
  body.onboarding-surface:has(> .ledger-onboard-overlay:not([hidden])) .onboarding-wizard {
    visibility: hidden;
  }
  .onboarding-surface .ledger-onboard-overlay {
    --onboarding-canvas-y: clamp(${SPACE.lg}, 3vh, ${SPACE.xxxl});
    background: transparent;
    justify-items: center;
    padding: var(--onboarding-canvas-y) clamp(${SPACE.xl}, 5vw, ${SPACE.xxxl});
  }
  /* Auto block margins centre a short card and collapse for a tall one, so a
     long account list scrolls from its heading; align-self: center would push
     the card's top above the scroll origin, out of reach. */
  .onboarding-surface .ledger-onboard-overlay > * {
    align-self: start;
    background: var(--bramble-panel);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--bramble-elev-md);
    box-sizing: border-box;
    margin-block: auto;
    min-block-size: min(
      720px,
      calc(100vh - var(--onboarding-canvas-y) - var(--onboarding-canvas-y))
    );
    padding: ${SPACE.xxl} clamp(${SPACE.xl}, 7vw, ${SPACE.xxl});
    width: min(100%, 520px);
  }
  .onboarding-surface .ledger-onboard-overlay > :is(.onboard-hero:not(.add-account-hero), .onboard-picker) {
    display: flex;
    flex-direction: column;
    gap: ${SPACE.md};
  }
  .onboarding-surface .ledger-onboard-overlay .onboard-hero:not(.add-account-hero) { align-items: center; }
  .onboarding-surface .ledger-onboard-overlay [data-ledger-load-more] { align-self: flex-start; }
  .onboarding-surface .ledger-onboard-overlay .gate-brand {
    background: var(--bramble-elevated);
    color: var(--bramble-text);
    height: 54px;
    margin-top: ${SPACE.xxxl};
    width: 54px;
  }
  .onboarding-surface .ledger-onboard-overlay .gate-brand .icon { height: 24px; width: 24px; }
  .onboarding-surface .ledger-onboard-overlay .onboard-picker > .gate-head {
    justify-items: center;
    margin: ${SPACE.xxxl} auto ${SPACE.md};
    max-width: 420px;
    text-align: center;
  }
  .onboarding-surface .ledger-onboard-overlay .gate-head h1 {
    font-size: ${TYPE.headline.size};
    font-weight: ${WEIGHT.heavy};
    letter-spacing: -0.035em;
    line-height: ${TYPE.headline.line};
    text-wrap: balance;
  }
  .onboarding-surface .ledger-onboard-overlay .onboard-actions {
    margin-top: auto;
    padding-top: ${SPACE.lg};
  }
  /* The device chooser renders inside the actions block: its options stay under
     the heading, as a step's options do, and only Cancel drops to the foot. */
  .onboarding-surface .ledger-onboard-overlay .onboard-actions:has(> .add-account-chooser) {
    display: flex;
    flex: 1;
    flex-direction: column;
    margin-top: 0;
    padding-top: 0;
  }
  .onboarding-surface .ledger-onboard-overlay .onboard-actions:has(> .add-account-chooser) > .ghost {
    align-self: center;
    margin-top: auto;
  }
  @media (max-width: 520px) {
    .onboarding-surface .ledger-onboard-overlay { padding: 0; }
    .onboarding-surface .ledger-onboard-overlay > * {
      border-radius: 0;
      box-shadow: none;
      min-block-size: 100vh;
      padding-inline: ${SPACE.lg};
      width: 100%;
    }
  }
`;
