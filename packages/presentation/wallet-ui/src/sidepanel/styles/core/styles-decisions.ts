/** Shared decision hierarchy and interrupted-task continuity styles. */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Review anatomy and dApp-takeover continuity fragment consumed by SIDEPANEL_STYLES.
 */
export const DECISION_STYLES = `
  .receipt-group { display: grid; padding: ${SPACE.sm} 0; }
  .receipt-group + .receipt-group { box-shadow: inset 0 1px 0 var(--bramble-hairline); }
  .receipt-group .decision-label { padding: ${SPACE.xs} 0; }
  .decision-head { align-items: center; display: flex; gap: ${SPACE.md}; }
  .decision-head > span:nth-child(2) { display: grid; gap: 2px; min-width: 0; }
  .decision-seal {
    align-items: center;
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline);
    color: var(--bramble-text);
    display: inline-flex;
    flex: none;
    height: 42px;
    justify-content: center;
    position: relative;
    width: 42px;
  }
  .decision-seal::after {
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline);
    content: "";
    inset: 4px;
    position: absolute;
  }
  .decision-seal .icon { height: 17px; width: 17px; }
  .decision-boundary { box-shadow: inset 0 1px 0 var(--bramble-hairline); padding-top: ${SPACE.md}; }
  .decision-technical .disclosure-body { display: grid; gap: ${SPACE.md}; }
  .decision-layer { display: grid; gap: ${SPACE.sm}; min-width: 0; }
  .review-call { align-items: center; display: flex; gap: ${SPACE.sm}; }
  .review-call > span:last-child { min-width: 0; }
  .review-call-assets { display: inline-flex; flex: none; }
  .review-call-assets > * + * { margin-left: -6px; }
  .review-call-assets .token-logo, .review-call-assets .token-mark { height: 24px; width: 24px; }
  .review-call-assets .token-mark { font-size: 8px; }
  .review-flag { align-items: center; display: flex; gap: ${SPACE.sm}; }
  .review-flag .icon { flex: none; }
  .decision-label {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: 0.06em;
    line-height: ${TYPE.micro.line};
    text-transform: uppercase;
  }
  .takeover-continuity {
    align-items: center;
    animation: continuity-arrive ${MOTION.enterMs}ms var(--ease-out) both;
    background: var(--bramble-sunken);
    border-radius: ${RADIUS.lg};
    display: flex;
    gap: ${SPACE.sm};
    padding: ${SPACE.xs} ${SPACE.md};
  }
  .takeover-continuity > span:last-child { display: grid; gap: 1px; min-width: 0; }
  .takeover-continuity strong { color: var(--bramble-text); font-size: ${TYPE.label.size}; }
  .takeover-continuity small { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .takeover-continuity-mark {
    align-items: center;
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline);
    color: var(--bramble-muted);
    display: inline-flex;
    flex: none;
    height: 28px;
    justify-content: center;
    position: relative;
    width: 28px;
  }
  .takeover-continuity-mark::after {
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 1px var(--bramble-hairline);
    content: "";
    inset: -4px;
    position: absolute;
  }
  .takeover-continuity-mark .icon { height: 15px; width: 15px; }
  @keyframes continuity-arrive {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .takeover-continuity { animation: none; }
  }
`;
