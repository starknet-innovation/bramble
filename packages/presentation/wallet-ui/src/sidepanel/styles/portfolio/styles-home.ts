/**
 * Home-experience and motion layer of the side panel stylesheet: the account
 * drawer, the tabbed portfolio section, collectible cards, and every keyframe
 * the panel uses (screen entrances, staggered rows, refresh spin, copy
 * confirmation). Composed last in ./styles.ts so its reduced-motion block wins
 * over every earlier animation and transition.
 */
import { MOTION, RADIUS, SPACE, TYPE } from "@mc-wallet/ui-kit/tokens";

/**
 * Home and motion stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const HOME_STYLES = `
  .tx-kind-icon {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    display: flex;
    flex: none;
    height: 36px;
    justify-content: center;
    width: 36px;
  }
  .tx-kind-icon .icon { height: 18px; width: 18px; }
  .tx-kind-icon.accepted { color: var(--mc-positive); }
  .tx-kind-icon.pending { color: var(--mc-warning); }
  .tx-kind-icon.preconfirmed { color: var(--mc-positive); opacity: 0.68; }
  .tx-kind-icon.rejected, .tx-kind-icon.reverted { color: var(--mc-danger); }
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
  .verify-status.verified { color: var(--mc-positive); font-weight: 600; }
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
  /* The name line is a flex row so the account name absorbs the truncation and
     the hardware badge beside it never does. As inline content the badge sat
     after the name in the same ellipsised line, so any name wide enough to fill
     a 300px drawer row clipped the badge away entirely — the one row where
     knowing the account is a device matters most. The badge's own margin spaces
     the row; no gap here, or it would be spaced twice. */
  .drawer-name { align-items: center; display: flex; min-width: 0; }
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

  /* Portfolio navigation: two large text destinations and one overflow menu.
     Active state is carried by high-contrast type alone — no underline, pill,
     or duplicated Activity destination. */
  .home-tabs { display: grid; gap: ${SPACE.sm}; }
  .tab-bar { align-items: center; display: flex; gap: ${SPACE.md}; min-height: 44px; }
  .tab-set {
    display: flex;
    flex: 1;
    gap: ${SPACE.xl};
    min-width: 0;
  }
  button.home-tab {
    background: transparent;
    color: var(--mc-muted);
    font-size: ${TYPE.title.size};
    font-weight: 700;
    min-height: 40px;
    padding: 0;
    transition: color ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    button.home-tab:not(:disabled):hover { background: transparent; color: var(--mc-text); }
    button.home-tab[aria-selected="true"]:not(:disabled):hover { color: var(--mc-text); }
  }
  button.home-tab:not(:disabled):active { background: transparent; transform: scale(0.98); }
  button.home-tab[aria-selected="true"] { color: var(--mc-text); }
  .portfolio-actions { flex: none; position: relative; }
  button.portfolio-menu-trigger { color: var(--mc-muted); height: 40px; width: 40px; }
  button.portfolio-menu-trigger .icon { height: 21px; width: 21px; }
  button.portfolio-menu-trigger[aria-expanded="true"] { background: var(--mc-hover); color: var(--mc-text); }
  .portfolio-menu {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-elev-lg);
    display: grid;
    opacity: 1;
    padding: 6px;
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    transform: translateY(0) scale(1);
    transform-origin: top right;
    transition:
      opacity ${MOTION.liftMs}ms var(--ease-out),
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: min(264px, calc(100vw - 32px));
    z-index: 12;
  }
  @starting-style {
    .portfolio-menu:not([hidden]) {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
  .portfolio-menu[hidden] { display: none; }
  button.portfolio-menu-item {
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    font-size: ${TYPE.body.size};
    font-weight: 500;
    justify-content: flex-start;
    min-height: 46px;
    padding: 0 ${SPACE.md};
    width: 100%;
  }
  button.portfolio-menu-item .icon { color: var(--mc-muted); height: 20px; width: 20px; }
  @media (hover: hover) and (pointer: fine) {
    button.portfolio-menu-item:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
    button.portfolio-menu-item:not(:disabled):hover .icon { color: var(--mc-text); }
  }
  .tab-panel { display: grid; gap: ${SPACE.sm}; }
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
  /* Positioned so the shared .nft-play-tile / .nft-animation--tile overlay covers
     the art square; the play affordance is revealed on hover/focus. */
  .collectible-tile { position: relative; }
  .collectible-tile:hover .nft-play-tile,
  .collectible-tile:focus-within .nft-play-tile { opacity: 1; pointer-events: auto; }
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
  button.copy-confirm { color: var(--mc-positive); }
  .copy-confirm .icon { animation: glyph-pop ${MOTION.liftMs}ms var(--ease-out) both; }

  /* Busy refresh controls spin their glyph until work settles */
  button[data-busy] .icon { animation: none; }
  #refresh-button[data-busy] .icon,
  #activity-refresh[data-busy] .icon,
  #swap-confirm-button[data-busy] .icon,
  #detect-tokens[data-busy] .icon { animation: spin 800ms linear infinite; }

  /* Motion: the scene owns one small fallback entrance when the View
     Transitions API is unavailable. Child balances, actions, and rows do not
     replay their own cascade on ordinary navigation; frequent wallet use must
     feel immediate rather than staged. */
  .shell-animate .screen { animation: screen-enter ${MOTION.enterMs}ms var(--ease-out) both; }
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
    from { opacity: 0; transform: scale(0.92); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Reduced motion removes travel, scale, spin, and drawer movement while
     retaining a brief opacity/colour response. Feedback still lands; nothing
     crosses the viewport or changes apparent size. */
  @media (prefers-reduced-motion: reduce) {
    .shell-animate .screen,
    .drawer-root[data-open="true"] .drawer-list li, .copy-confirm .icon,
    #refresh-button[data-busy] .icon, #activity-refresh[data-busy] .icon,
    #detect-tokens[data-busy] .icon,
    #swap-confirm-button[data-busy] .icon,
    .account-net.degraded .dot { animation: none; }
    button, input, select, textarea {
      transition:
        background ${MOTION.pressMs}ms ${MOTION.ease},
        color ${MOTION.pressMs}ms ${MOTION.ease},
        opacity ${MOTION.pressMs}ms ${MOTION.ease};
    }
    .account-drawer, .drawer-backdrop, .account-name .icon { transition: none; }
    .portfolio-menu {
      transform: none;
      transition: opacity ${MOTION.pressMs}ms ${MOTION.ease};
    }
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
