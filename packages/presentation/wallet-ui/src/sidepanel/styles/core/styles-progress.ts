/**
 * Shared indeterminate progress motion. This is a framework-free CSS/SVG
 * adaptation of Amicro's Liquid Dots treatment; see THIRD_PARTY_NOTICES.md.
 */
import { CONTROL, MOTION, RADIUS, SIZE, SPACE } from "@mc-wallet/ui-kit/tokens";

/**
 * Liquid Dots styles shared by Send, approvals, and Ledger signing.
 */
export const PROGRESS_STYLES = `
  .liquid-dots-defs {
    height: 0;
    position: absolute;
    width: 0;
  }
  .liquid-dots {
    --liquid-dot-size: ${SPACE.xl};
    --liquid-dot-travel: ${SPACE.lg};
    align-items: center;
    color: currentColor;
    display: inline-flex;
    height: ${CONTROL.hitSmall};
    justify-content: center;
    position: relative;
    width: ${SIZE.brand};
  }
  .liquid-dots[data-liquid-dots="approval"] { filter: url("#mc-liquid-dots-approval"); }
  .liquid-dots[data-liquid-dots="ledger"] { filter: url("#mc-liquid-dots-ledger"); }
  .liquid-dots[data-liquid-dots="mobile-pq"] { filter: url("#mc-liquid-dots-mobile-pq"); }
  .liquid-dots[data-liquid-dots="privacy"] { filter: url("#mc-liquid-dots-privacy"); }
  .liquid-dots[data-liquid-dots="send"] { filter: url("#mc-liquid-dots-send"); }
  .liquid-dots-compact {
    --liquid-dot-size: ${SPACE.sm};
    --liquid-dot-travel: ${SPACE.sm};
    height: ${SPACE.lg};
    width: ${SPACE.xl};
  }
  .liquid-dot {
    animation: liquid-dot-left ${MOTION.waitLoopMs}ms var(--ease-in-out) infinite;
    background: currentColor;
    border-radius: ${RADIUS.full};
    height: var(--liquid-dot-size);
    position: absolute;
    transform: translateX(calc(-1 * var(--liquid-dot-travel)));
    width: var(--liquid-dot-size);
  }
  .liquid-dot + .liquid-dot {
    animation-name: liquid-dot-right;
    transform: translateX(var(--liquid-dot-travel));
  }
  @keyframes liquid-dot-left {
    0%, 100% { transform: translateX(calc(-1 * var(--liquid-dot-travel))); }
    50% { transform: translateX(var(--liquid-dot-travel)); }
  }
  @keyframes liquid-dot-right {
    0%, 100% { transform: translateX(var(--liquid-dot-travel)); }
    50% { transform: translateX(calc(-1 * var(--liquid-dot-travel))); }
  }
  @media (prefers-reduced-motion: reduce) {
    .liquid-dot { animation: none; }
  }
`;
