/**
 * Persistent wallet-dock styling. Each root keeps a visible label so users do
 * not have to memorize icon meaning or discover navigation through hover.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Dock stylesheet fragment consumed after the base layout layer.
 */
export const DOCK_STYLES = `
  .wallet-dock {
    background: var(--bramble-panel);
    bottom: 0;
    box-shadow: inset 0 1px 0 var(--bramble-hairline), var(--bramble-elev-up);
    display: grid;
    gap: ${SPACE.xs};
    grid-template-columns: repeat(3, minmax(0, 1fr));
    left: 0;
    min-height: var(--bramble-dock-h);
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
    color: var(--bramble-muted);
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    height: ${CONTROL.nav};
    justify-content: center;
    justify-self: center;
    padding: 0;
    position: relative;
    transition:
      color ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: min(84px, 100%);
  }
  @media (hover: hover) and (pointer: fine) {
    button.nav-item:not(:disabled):hover { background: transparent; color: var(--bramble-text); }
    button.nav-item[aria-selected="true"]:not(:disabled):hover { color: var(--bramble-text); }
  }
  button.nav-item:not(:disabled):active { background: transparent; transform: scale(0.96); }
  button.nav-item[aria-selected="true"] { color: var(--bramble-text); }
  .tab-icon {
    align-items: center;
    display: inline-flex;
    justify-content: center;
    position: relative;
    transition: color ${MOTION.tabMs}ms ${MOTION.ease};
  }
  .tab-icon .icon { height: ${CONTROL.dockIcon}; stroke-width: 1.8; width: ${CONTROL.dockIcon}; }
  .tab-icon .badge { position: absolute; right: -9px; top: -8px; }
  .nav-label {
    color: inherit;
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.semibold};
    line-height: ${TYPE.micro.line};
    text-wrap: nowrap;
  }
`;
