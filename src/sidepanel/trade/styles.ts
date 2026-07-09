/**
 * Trade terminal stylesheet fragment, skin-token driven. Registered into the
 * side panel sheet by src/sidepanel/styles.ts (composed after the base/component
 * layers, before the home/reduced-motion layer so that layer's motion opt-out
 * still wins). No hardcoded colors — every surface uses the skin CSS vars and
 * the derived tokens declared in styles-base.ts (--mc-positive-soft etc.).
 */
import { MOTION, RADIUS, SPACE, TYPE } from "../../ui/tokens";

/**
 * Trade terminal styles consumed by SIDEPANEL_STYLES.
 */
export const TRADE_STYLES = `
  /* Terminal shell: full-height surface with its own tab nav, no wallet dock */
  .trade-terminal { align-content: start; display: grid; flex: 1; gap: ${SPACE.md}; }
  .trade-header {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: 2px 0 ${SPACE.xs};
  }
  .trade-header h1 { flex: 1; font-size: ${TYPE.title.size}; min-width: 0; }

  /* Segmented tab bar: the Discover/Tokens/Perps/Portfolio nav and sub-filters */
  .trade-seg-bar {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    display: grid;
    gap: 2px;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding: 4px;
  }
  button.trade-seg {
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    font-weight: 650;
    min-height: 34px;
    padding: 0 ${SPACE.sm};
    transition: background ${MOTION.tabMs}ms ${MOTION.ease}, color ${MOTION.pressMs}ms ${MOTION.ease};
  }
  button.trade-seg:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.trade-seg[aria-selected="true"] {
    background: var(--mc-accent-soft);
    color: var(--mc-accent);
  }

  /* Only the active tab's panel host is shown */
  .trade-panel-host[hidden] { display: none; }
  .trade-panel { display: grid; gap: ${SPACE.md}; }

  /* Stub placeholder for coming-soon screens */
  .trade-placeholder {
    align-content: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    color: var(--mc-muted);
    display: grid;
    gap: ${SPACE.xs};
    justify-items: center;
    min-height: 200px;
    padding: ${SPACE.xl};
    text-align: center;
  }
  .trade-placeholder strong { color: var(--mc-text); font-size: ${TYPE.title.size}; }
  .trade-placeholder p { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }

  /* Section heading inside a panel */
  .trade-section-head {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
    padding: 0 2px;
  }
  .trade-section-head h2 { font-size: ${TYPE.body.size}; font-weight: 700; }
  .trade-section-head span { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }

  /* List + rows */
  .trade-list { display: grid; gap: 6px; }
  .trade-row { display: block; }
  .trade-row-open {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 58px;
    padding: ${SPACE.sm} ${SPACE.md};
    text-align: left;
    width: 100%;
  }
  button.trade-row-open {
    transition: background ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  button.trade-row-open:not(:disabled):hover { background: var(--mc-hover); }
  button.trade-row-open:not(:disabled):active { background: var(--mc-soft-press); transform: scale(0.99); }
  .trade-row-lead {
    align-items: center;
    display: inline-flex;
    flex: none;
    height: 36px;
    justify-content: center;
    width: 36px;
  }
  .trade-row-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .trade-row-copy strong {
    font-size: ${TYPE.body.size};
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .trade-row-sub { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .trade-row-trail { align-items: center; display: inline-flex; flex: none; }
  .trade-row-side { align-items: flex-end; display: grid; flex: none; gap: 2px; text-align: right; }
  .trade-row-value { font-size: ${TYPE.body.size}; font-weight: 650; }
  .trade-row-valuesub { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }

  /* Token mark used as a row glyph */
  .trade-glyph {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 700;
    height: 36px;
    justify-content: center;
    width: 36px;
  }

  /* Colored percentage-change pill */
  .trade-pill {
    align-items: center;
    border-radius: ${RADIUS.full};
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 700;
    gap: 3px;
    padding: 2px 8px;
  }
  .trade-pill.up { background: var(--mc-positive-soft); color: var(--mc-positive); }
  .trade-pill.down { background: var(--mc-danger-soft); color: var(--mc-danger); }

  /* Stat/label pairs and stat grids */
  .trade-stat-grid {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  }
  .trade-stat {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: 2px;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .trade-stat-label {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .trade-stat-value { color: var(--mc-text); font-size: ${TYPE.body.size}; font-weight: 700; }

  /* Portfolio hero */
  .trade-hero { display: grid; gap: ${SPACE.xs}; padding: ${SPACE.md} 2px; }
  .trade-hero-total {
    color: var(--mc-text);
    font-size: ${TYPE.amount.size};
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: ${TYPE.amount.line};
  }

  /* Inline mini charts */
  .trade-spark { display: block; height: 24px; width: 72px; }
  .trade-spark polyline { stroke-width: 2px; }
  .trade-spark.up polyline { stroke: var(--mc-positive); }
  .trade-spark.down polyline { stroke: var(--mc-danger); }
  .trade-spark.flat polyline { stroke: var(--mc-muted); }
  .trade-bars { display: block; height: 24px; width: 72px; }
  .trade-bars rect { fill: var(--mc-accent); }
`;
