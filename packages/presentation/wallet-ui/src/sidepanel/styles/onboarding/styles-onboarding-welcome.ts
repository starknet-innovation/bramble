/**
 * Welcome-screen composition, separated from the onboarding form system: the
 * wordmark lockup held at the centre of the card, the two full-width actions
 * at its foot, and the local-encryption note beneath them — the same reading
 * order as the design kit's onboarding card, with no decorative motion.
 */
import { SPACE, TYPE } from "@bramble/ui-kit/tokens";

/**
 * Full-screen onboarding welcome composition.
 */
export const ONBOARDING_WELCOME_STYLES = `
  .onboarding-welcome {
    align-items: center;
    justify-content: flex-end;
    padding-top: 26px;
    text-align: center;
  }
  /* The lockup takes the free height above the actions and centres in it,
     sized to the card rather than the viewport so it never crowds the foot. */
  .onboarding-lockup {
    align-items: center;
    color: var(--bramble-text);
    display: flex;
    flex: 1;
    justify-content: center;
    min-height: 220px;
    width: 100%;
  }
  .onboarding-lockup .brand-wordmark {
    display: block;
    height: auto;
    width: min(60%, 220px);
  }
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
  @media (hover: hover) and (pointer: fine) {
    .onboarding-welcome-actions .onboarding-launch:hover { color: var(--bramble-text); }
  }
  @media (max-height: 760px) {
    .onboarding-lockup { min-height: 160px; }
  }
`;
