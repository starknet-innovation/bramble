/**
 * Persistent wallet-dock styling. The dock is intentionally icon-only:
 * high-contrast versus muted ink communicates the selected destination, while
 * hover/focus tooltips preserve names without permanent labels.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Dock stylesheet fragment consumed after the base layout layer.
 */
export const DOCK_STYLES = `
  .wallet-dock {
    background: var(--mc-panel);
    bottom: 0;
    box-shadow: inset 0 1px 0 var(--mc-hairline), var(--mc-elev-up);
    display: grid;
    gap: ${SPACE.xs};
    grid-template-columns: repeat(3, minmax(0, 1fr));
    left: 0;
    min-height: var(--mc-dock-h);
    padding: ${SPACE.xs} ${SPACE.lg};
    position: fixed;
    right: 0;
    z-index: 5;
  }
  button.nav-item {
    align-items: center;
    align-self: center;
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    display: inline-flex;
    height: ${CONTROL.dockItem};
    justify-content: center;
    justify-self: center;
    padding: 0;
    position: relative;
    transition:
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: ${CONTROL.dockItem};
  }
  @media (hover: hover) and (pointer: fine) {
    button.nav-item:not(:disabled):hover { background: transparent; color: var(--mc-text); }
    button.nav-item[aria-selected="true"]:not(:disabled):hover { color: var(--mc-text); }
    button.nav-item:not(:disabled):hover .nav-tooltip,
    button.nav-item:not(:disabled):focus-visible .nav-tooltip {
      opacity: 1;
      transform: translate(-50%, 0);
      visibility: visible;
    }
  }
  button.nav-item:not(:disabled):active { background: transparent; transform: scale(0.96); }
  button.nav-item[aria-selected="true"] { color: var(--mc-text); }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    position: relative;
    transition: color ${MOTION.tabMs}ms ${MOTION.ease};
  }
  .tab-icon .icon { height: ${CONTROL.dockIcon}; stroke-width: 1.8; width: ${CONTROL.dockIcon}; }
  .tab-icon .badge { position: absolute; right: -9px; top: -8px; }
  .nav-tooltip {
    background: var(--mc-text);
    border-radius: ${RADIUS.sm};
    bottom: calc(100% + ${SPACE.sm});
    color: var(--mc-bg);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.semibold};
    left: 50%;
    opacity: 0;
    padding: ${SPACE.xs} ${SPACE.sm};
    pointer-events: none;
    position: absolute;
    transform: translate(-50%, 4px);
    transition:
      opacity ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
    visibility: hidden;
    text-wrap: nowrap;
  }
`;
