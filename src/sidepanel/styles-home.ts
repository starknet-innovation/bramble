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
  /* On-chain class-hash verification shown on the account screen: pending stays
     muted, a confirmed match goes accent, a mismatch is an assertive danger
     block so it cannot be skimmed past. Icon and text share one baseline. */
  .verify-status {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: 6px;
    line-height: ${TYPE.caption.line};
    margin-top: 6px;
  }
  .verify-status .icon { flex: none; }
  .verify-status.verified { color: var(--mc-accent); font-weight: 600; }
  .verify-status.mismatch {
    align-items: flex-start;
    background: color-mix(in srgb, var(--mc-danger) 12%, transparent);
    border-radius: ${RADIUS.md};
    color: var(--mc-danger);
    font-weight: 600;
    padding: ${SPACE.sm};
  }
  .verify-status.mismatch code { word-break: break-all; }
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
  /* Left sheet: a solid panel under a soft depth shadow, settling with the
     iOS drawer spring. Enter and exit share one path. */
  .account-drawer {
    background: var(--mc-panel);
    border-radius: 0 ${RADIUS.xl} ${RADIUS.xl} 0;
    bottom: 0;
    box-shadow: var(--mc-elev-lg);
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
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    button.drawer-account:not(:disabled):hover { background: var(--mc-hover); }
    button.drawer-account[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-accent-soft); }
  }
  button.drawer-account:not(:disabled):active { background: var(--mc-soft-press); transform: scale(0.985); }
  button.drawer-account[aria-pressed="true"] { background: var(--mc-accent-soft); }
  .drawer-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .drawer-copy strong { font-size: ${TYPE.body.size}; font-weight: 650; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .drawer-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .drawer-foot { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.sm}; }
  /* Row stagger is gated behind .is-opening (added only on a genuine open) so a
     shell repaint that recreates the drawer node cannot replay it. */
  .drawer-root.is-opening[data-open="true"] .drawer-list li { animation: drawer-item ${MOTION.tabMs}ms var(--ease-out) both; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(2) { animation-delay: 30ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(3) { animation-delay: 60ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(4) { animation-delay: 90ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(5) { animation-delay: 120ms; }

  /* Portfolio tabs: text tabs, sliding accent indicator, trailing actions */
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
    transition: color ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    button.home-tab:not(:disabled):hover { background: transparent; color: var(--mc-text); }
    /* The selected tab keeps its accent under the pointer (see the dock). */
    button.home-tab[aria-selected="true"]:not(:disabled):hover { color: var(--mc-accent); }
  }
  button.home-tab:not(:disabled):active { background: transparent; transform: scale(0.95); }
  /* Active tab: no box/pill fill — a flat text tab that reads as selected via
     the cobalt accent (matching the sliding .tab-indicator underline and the
     borderless dock highlight). Inactive tabs stay muted; alignment plus the
     accent carry the state without any background. */
  button.home-tab[aria-selected="true"] { color: var(--mc-accent); }
  /* The underline glides between tabs on the snappy spring — critically damped
     (no overshoot), settling from the current position so rapid tab taps
     retarget smoothly instead of restarting. */
  .tab-indicator {
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    bottom: 0;
    height: 3px;
    left: 0;
    position: absolute;
    transition: transform var(--spring-snappy-ms) var(--spring-snappy), width var(--spring-snappy-ms) var(--spring-snappy);
    width: 24px;
  }
  .tab-actions { align-items: center; display: flex; flex: none; gap: 2px; margin-bottom: 6px; }
  .tab-actions .icon-button { height: 32px; width: 32px; }
  .tab-panel { display: grid; gap: ${SPACE.sm}; }
  .tab-panel.is-entering { animation: panel-enter ${MOTION.enterMs}ms var(--ease-out) both; }
  .panel-error { display: grid; gap: ${SPACE.sm}; justify-items: center; text-align: center; }
  .panel-error .empty { margin: 0; }
  .panel-error button { gap: 4px; }
  button.tab-more {
    color: var(--mc-muted);
    font-weight: 650;
    gap: 4px;
    justify-content: center;
    min-height: 40px;
    width: 100%;
  }
  button.tab-more .icon { height: 14px; width: 14px; }

  /* Collectible tiles: a minimally framed art square over a tight name/token-id
     caption. The box chrome (elevated fill + edge wrapping the whole card) is
     gone — the art tile carries the only hairline framing, and the grid rhythm
     aligns the tiles. Tapping a tile opens its detail; hover tints the name and
     lifts the art with a soft shadow (no box behind the caption). */
  .collectible-grid { display: grid; gap: ${SPACE.md}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  button.collectible-card {
    align-content: start;
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    display: grid;
    gap: ${SPACE.sm};
    /* Definite single 1fr column so the art's width:100% resolves to the full
       card width (not the caption's content width, which base button's
       justify-content:center would otherwise collapse it to). */
    grid-template-columns: minmax(0, 1fr);
    justify-items: stretch;
    min-height: 0;
    padding: 0;
    text-align: left;
    transition: transform ${MOTION.liftMs}ms var(--ease-out);
    width: 100%;
  }
  button.collectible-card:not(:disabled):hover { background: transparent; }
  button.collectible-card:not(:disabled):active { background: transparent; transform: scale(0.97); }

  /* Hover feedback is gated to fine pointers so a tap on touch never leaves an
     element floating (touch fires a phantom :hover). Pointer devices tint the
     caption and raise the art tile with a soft shadow; the press scale is
     universal. */
  @media (hover: hover) and (pointer: fine) {
    button.collectible-card:not(:disabled):hover strong { color: var(--mc-accent); }
    button.collectible-card:not(:disabled):hover .collectible-art {
      box-shadow: var(--mc-shadow-sm);
    }
  }
  .collectible-art {
    align-items: center;
    aspect-ratio: 1 / 1;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    color: var(--mc-muted);
    display: inline-flex;
    justify-content: center;
    overflow: hidden;
    position: relative;
    transition: box-shadow ${MOTION.liftMs}ms ${MOTION.ease};
    width: 100%;
  }
  .collectible-art .icon { height: 28px; width: 28px; }
  .collectible-copy { display: grid; gap: 2px; min-width: 0; padding: 0 2px; width: 100%; }
  .collectible-copy strong { font-size: ${TYPE.label.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .collectible-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }

  /* Copy confirmation: the glyph flips to a success-green check, then back */
  button.copy-confirm, .hero-chip.copy-confirm .icon { color: var(--mc-positive); }
  .copy-confirm .icon { animation: glyph-pop ${MOTION.tabMs}ms ${MOTION.pop} both; }

  /* Busy refresh controls spin their glyph until work settles */
  button[data-busy] .icon { animation: none; }
  #refresh-button[data-busy] .icon,
  #activity-refresh[data-busy] .icon,
  #swap-confirm-button[data-busy] .icon,
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

  /* Reduced motion: every animation and transition collapses to a cut, and
     hover lifts and press scales settle to static states */
  @media (prefers-reduced-motion: reduce) {
    .shell-animate .screen, .shell-animate .hero-eyebrow, .shell-animate .hero-total,
    .shell-animate .hero-change, .shell-animate .action-tile,
    .shell-animate .token-list li, .tab-panel.is-entering,
    .drawer-root[data-open="true"] .drawer-list li, .copy-confirm .icon,
    #refresh-button[data-busy] .icon, #activity-refresh[data-busy] .icon,
    #detect-tokens[data-busy] .icon,
    #swap-confirm-button[data-busy] .icon { animation: none; }
    button, input, select, textarea, .tab-indicator, .tab-icon,
    .account-drawer, .drawer-backdrop, .account-name .icon { transition: none; }
    button.collectible-card:not(:disabled):hover,
    .account-trigger[aria-expanded="true"] .account-name .icon { transform: none; }
    .swap-success-ring, .swap-success-check { animation: none; stroke-dashoffset: 0; }
    .swap-success h2, .swap-success .swap-success-summary, .swap-success .hint { animation: none; }
    button:not(:disabled):active,
    button.icon-button:not(:disabled):active,
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
