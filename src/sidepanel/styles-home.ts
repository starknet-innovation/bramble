/**
 * Home-experience and motion layer of the side panel stylesheet: the account
 * drawer, the tabbed portfolio section, collectible cards, and every keyframe
 * the panel uses (screen entrances, staggered rows, refresh spin, copy
 * confirmation). Composed last in ./styles.ts so its reduced-motion block wins
 * over every earlier animation and transition.
 */
import { MOTION, RADIUS, SPACE, TYPE } from "../ui/tokens";

/**
 * Home and motion stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const HOME_STYLES = `
  /* Account drawer: left sheet over a dimmed backdrop, elevation only */
  .drawer-root { inset: 0; pointer-events: none; position: fixed; z-index: 20; }
  .drawer-root[data-open="true"] { pointer-events: auto; }
  .drawer-backdrop {
    background: color-mix(in srgb, var(--mc-bg) 58%, transparent);
    inset: 0;
    opacity: 0;
    position: absolute;
    transition: opacity var(--spring-drawer-ms) var(--ease-drawer);
  }
  .drawer-root[data-open="true"] .drawer-backdrop { opacity: 1; }
  /* Left sheet: a solid panel with a hairline edge and a soft depth shadow,
     settling with the iOS drawer spring. Enter and exit share one path. */
  .account-drawer {
    background: var(--mc-panel);
    border-radius: 0 ${RADIUS.xl} ${RADIUS.xl} 0;
    bottom: 0;
    box-shadow: var(--mc-edge), var(--mc-elev-lg);
    display: flex;
    flex-direction: column;
    gap: ${SPACE.md};
    left: 0;
    padding: ${SPACE.lg} ${SPACE.md} ${SPACE.md};
    position: absolute;
    top: 0;
    touch-action: pan-y;
    transform: translateX(-104%);
    transition:
      transform var(--spring-drawer-ms) var(--spring-drawer),
      visibility 0s linear var(--spring-drawer-ms);
    visibility: hidden;
    width: min(300px, 88%);
    will-change: transform;
  }
  .drawer-root[data-open="true"] .account-drawer {
    transform: translateX(0);
    transition: transform var(--spring-drawer-ms) var(--spring-drawer);
    visibility: visible;
  }
  .drawer-head { align-items: center; display: flex; gap: ${SPACE.sm}; justify-content: space-between; }
  .drawer-title { display: grid; gap: 1px; min-width: 0; }
  .drawer-title p { font-size: ${TYPE.caption.size}; }
  .drawer-list { align-content: start; display: grid; flex: 1; gap: 6px; overflow-y: auto; }
  button.drawer-account {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    display: flex;
    gap: 10px;
    justify-content: flex-start;
    min-height: 56px;
    padding: 0 ${SPACE.sm};
    text-align: left;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms ${MOTION.pop};
    width: 100%;
  }
  button.drawer-account:not(:disabled):hover { background: var(--mc-hover); }
  button.drawer-account:not(:disabled):active { background: var(--mc-soft-press); transform: scale(0.985); }
  button.drawer-account[aria-pressed="true"] { background: var(--mc-accent-soft); }
  button.drawer-account[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-accent-soft); }
  .drawer-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .drawer-copy strong { font-size: ${TYPE.body.size}; font-weight: 650; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .drawer-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .drawer-foot { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.sm}; }
  .drawer-root[data-open="true"] .drawer-list li { animation: drawer-item ${MOTION.tabMs}ms var(--ease-out) both; }
  .drawer-root[data-open="true"] .drawer-list li:nth-child(2) { animation-delay: 30ms; }
  .drawer-root[data-open="true"] .drawer-list li:nth-child(3) { animation-delay: 60ms; }
  .drawer-root[data-open="true"] .drawer-list li:nth-child(4) { animation-delay: 90ms; }
  .drawer-root[data-open="true"] .drawer-list li:nth-child(5) { animation-delay: 120ms; }

  /* Portfolio tabs: text tabs, sliding emerald indicator, trailing actions */
  .home-tabs { display: grid; gap: ${SPACE.sm}; }
  .tab-bar { align-items: center; display: flex; gap: ${SPACE.sm}; min-height: 36px; }
  .tab-set {
    display: flex;
    flex: 1;
    gap: 2px;
    min-width: 0;
    padding-bottom: 6px;
    position: relative;
  }
  button.home-tab {
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--mc-muted);
    font-size: ${TYPE.body.size};
    font-weight: 700;
    min-height: 30px;
    padding: 0 10px;
    transition: color ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  button.home-tab:not(:disabled):hover { background: transparent; color: var(--mc-text); }
  button.home-tab:not(:disabled):active { background: transparent; transform: scale(0.95); }
  button.home-tab[aria-selected="true"] { color: var(--mc-text); }
  .tab-indicator {
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    bottom: 0;
    height: 3px;
    left: 0;
    position: absolute;
    transition: transform ${MOTION.tabMs}ms var(--ease-in-out), width ${MOTION.tabMs}ms var(--ease-in-out);
    width: 24px;
  }
  .tab-actions { align-items: center; display: flex; flex: none; gap: 2px; margin-bottom: 6px; }
  .tab-actions .icon-button { height: 32px; width: 32px; }
  .tab-panel { display: grid; gap: ${SPACE.sm}; }
  .tab-panel.is-entering { animation: panel-enter ${MOTION.enterMs}ms var(--ease-out) both; }
  button.tab-more {
    color: var(--mc-muted);
    font-weight: 650;
    gap: 4px;
    justify-content: center;
    min-height: 40px;
    width: 100%;
  }
  button.tab-more .icon { height: 14px; width: 14px; }

  /* Collectible cards: elevated art placeholder over name and token id */
  .collectible-grid { display: grid; gap: ${SPACE.sm}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  button.collectible-card {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    display: grid;
    gap: ${SPACE.sm};
    justify-items: start;
    min-height: 0;
    padding: ${SPACE.sm};
    text-align: left;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      box-shadow ${MOTION.liftMs}ms ${MOTION.ease},
      transform ${MOTION.liftMs}ms ${MOTION.pop};
    width: 100%;
  }
  button.collectible-card:not(:disabled):hover { background: var(--mc-hover); }
  button.collectible-card:not(:disabled):active { background: var(--mc-soft-press); box-shadow: var(--mc-edge); transform: scale(0.97); }

  /* Hover lift is gated to fine pointers so a tap on touch never leaves an
     element floating (touch fires a phantom :hover). Pointer devices get the
     2px rise + soft shadow; press feedback (scale) is universal. */
  @media (hover: hover) and (pointer: fine) {
    button.action-tile:not(:disabled):hover,
    button.collectible-card:not(:disabled):hover {
      box-shadow: var(--mc-edge), var(--mc-shadow-sm);
      transform: translateY(-2px);
    }
  }
  .collectible-art {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.sm};
    color: var(--mc-muted);
    display: inline-flex;
    height: 56px;
    justify-content: center;
    width: 100%;
  }
  .collectible-copy { display: grid; gap: 2px; min-width: 0; width: 100%; }
  .collectible-copy strong { font-size: ${TYPE.label.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .collectible-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }

  /* Copy confirmation: the glyph flips to an emerald check, then back */
  button.copy-confirm, .hero-chip.copy-confirm .icon { color: var(--mc-positive); }
  .copy-confirm .icon { animation: glyph-pop ${MOTION.tabMs}ms ${MOTION.pop} both; }

  /* Busy refresh controls spin their glyph until work settles */
  button[data-busy] .icon { animation: none; }
  #refresh-button[data-busy] .icon,
  #activity-refresh[data-busy] .icon,
  #detect-tokens[data-busy] .icon { animation: spin 800ms linear infinite; }

  /* Motion: scene entrances stagger the hero, tiles, and first rows with the
     strong ease-out curve; screens enter under the direction-aware view
     transition, this cascade brings their content in behind it. */
  .shell-animate .screen { animation: screen-enter ${MOTION.enterMs}ms var(--ease-out) both; }
  .shell-animate .hero-eyebrow,
  .shell-animate .hero-total,
  .shell-animate .hero-change { animation: rise-in ${MOTION.enterMs}ms var(--ease-out) both; }
  .shell-animate .action-tile { animation: rise-in 240ms var(--ease-out) both; }
  .shell-animate .action-tile:nth-child(2) { animation-delay: 40ms; }
  .shell-animate .action-tile:nth-child(3) { animation-delay: 80ms; }
  .shell-animate .token-list li { animation: rise-in 260ms var(--ease-out) both; }
  .shell-animate .token-list li:nth-child(1) { animation-delay: 40ms; }
  .shell-animate .token-list li:nth-child(2) { animation-delay: 70ms; }
  .shell-animate .token-list li:nth-child(3) { animation-delay: 100ms; }
  .shell-animate .token-list li:nth-child(4) { animation-delay: 130ms; }
  .shell-animate .token-list li:nth-child(5) { animation-delay: 160ms; }
  .shell-animate .token-list li:nth-child(6) { animation-delay: 190ms; }
  /* Entrances are small, GPU-only (opacity + a few px of translate) and settle
     under 300ms. screen-enter and panel-enter drop their transform in the end
     frame so containers leave nothing lingering; rise-in stays on leaf
     surfaces, where a settled transform is harmless. */
  @keyframes screen-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; }
  }
  @keyframes rise-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes panel-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; }
  }
  @keyframes drawer-item {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes glyph-pop {
    from { opacity: 0; transform: scale(0.4); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }

  /* Reduced motion: every animation and transition collapses to a cut, and
     hover lifts and press scales settle to static states */
  @media (prefers-reduced-motion: reduce) {
    .shell-animate .screen, .shell-animate .hero-eyebrow, .shell-animate .hero-total,
    .shell-animate .hero-change, .shell-animate .action-tile,
    .shell-animate .token-list li, .tab-panel.is-entering,
    .drawer-root[data-open="true"] .drawer-list li, .copy-confirm .icon,
    #refresh-button[data-busy] .icon, #activity-refresh[data-busy] .icon,
    #detect-tokens[data-busy] .icon { animation: none; }
    button, input, select, textarea, .tab-indicator, .tab-icon,
    .account-drawer, .drawer-backdrop, .account-name .icon { transition: none; }
    button.action-tile:not(:disabled):hover,
    button.collectible-card:not(:disabled):hover,
    .account-trigger[aria-expanded="true"] .account-name .icon { transform: none; }
    button.action-tile:not(:disabled):active,
    button.collectible-card:not(:disabled):active,
    button.nav-item:not(:disabled):active,
    button.home-tab:not(:disabled):active,
    button.drawer-account:not(:disabled):active,
    button.menu-row:not(:disabled):active,
    button.option-row:not(:disabled):active,
    li.token-row:has(button.token-open:active) { transform: none; }
    li.token-row { transition: none; }
  }
`;
