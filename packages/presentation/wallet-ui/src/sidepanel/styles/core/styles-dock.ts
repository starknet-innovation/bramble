/**
 * Persistent wallet-dock styling: a floating pill of three icon-only roots,
 * centred a little above the panel's bottom edge, the selected root on a
 * tinted disc. Each root carries its name as its accessible label and native
 * tooltip rather than a visible caption.
 */
import { CONTROL, MOTION, RADIUS, SPACE } from "@bramble/ui-kit/tokens";

/**
 * Inner padding of the dock pill around its 44px roots, equal on every side so
 * the selected disc sits concentric in the pill's rounded ends. Air between the
 * roots comes from the gap, not from extra padding at the ends.
 */
export const DOCK_PADDING = "6px";
const DOCK_GAP = SPACE.md;

/**
 * Gap between the dock pill and the bottom edge of the panel.
 */
export const DOCK_OFFSET = SPACE.lg;

/**
 * Dock stylesheet fragment consumed after the base layout layer.
 */
export const DOCK_STYLES = `
  .wallet-dock {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.full};
    bottom: ${DOCK_OFFSET};
    box-shadow: var(--bramble-elev-md);
    display: flex;
    gap: ${DOCK_GAP};
    left: 0;
    margin: 0 auto;
    padding: ${DOCK_PADDING};
    position: fixed;
    right: 0;
    width: max-content;
    z-index: 5;
  }
  button.nav-item {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--bramble-muted);
    display: inline-flex;
    height: ${CONTROL.dockItem};
    justify-content: center;
    min-height: 0;
    padding: 0;
    position: relative;
    transition:
      background ${MOTION.tabMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: ${CONTROL.dockItem};
  }
  @media (hover: hover) and (pointer: fine) {
    button.nav-item:not(:disabled):hover { background: var(--bramble-hover); color: var(--bramble-text); }
    button.nav-item[aria-selected="true"]:not(:disabled):hover { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  }
  button.nav-item:not(:disabled):active { transform: scale(0.96); }
  /* The selected root sits on the accent's soft tint with accent ink — the
     kit's accent/surface + accent/on-surface pairing; in the neutral midnight
     skin that reads as a quiet light disc. */
  button.nav-item[aria-selected="true"] { background: var(--bramble-accent-soft); color: var(--bramble-accent); }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    position: relative;
    transition: color ${MOTION.tabMs}ms ${MOTION.ease};
  }
  .tab-icon .icon { height: ${CONTROL.dockIcon}; stroke-width: 1.8; width: ${CONTROL.dockIcon}; }
  .tab-icon .badge { position: absolute; right: -9px; top: -8px; }
`;
