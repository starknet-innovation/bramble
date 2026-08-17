/**
 * Account-contract choice rows shared by software and Ledger onboarding.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Account-contract selector stylesheet fragment.
 */
export const ONBOARDING_CONTRACT_STYLES = `
  .onboarding-contract-options { display: grid; gap: ${SPACE.sm}; }
  .onboarding-contract {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: minmax(0, 1fr) 32px;
    justify-content: initial;
    min-height: 82px;
    padding: ${SPACE.md};
    text-align: left;
    width: 100%;
  }
  .onboarding-contract-copy { display: grid; gap: ${SPACE.xs}; min-width: 0; }
  .onboarding-contract-copy > span:last-child {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .onboarding-contract-title { align-items: center; display: flex; flex-wrap: wrap; gap: ${SPACE.sm}; }
  .onboarding-contract-title strong { font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.semibold}; }
  .onboarding-contract-title > span {
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.semibold};
    padding: 3px ${SPACE.sm};
  }
  .onboarding-contract-check {
    align-items: center;
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    color: var(--mc-bg);
    display: flex;
    height: 28px;
    justify-content: center;
    opacity: 1;
    transform: scale(1);
    transition:
      opacity ${MOTION.liftMs}ms var(--ease-out),
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: 28px;
  }
  .onboarding-contract-check .icon { height: 14px; width: 14px; }
  .onboarding-contract[aria-pressed="false"] .onboarding-contract-check {
    opacity: 0;
    transform: scale(0.92);
  }
  .onboarding-contract[aria-pressed="true"] {
    background: var(--mc-soft-press);
    box-shadow: var(--mc-elev-sm);
  }
`;
