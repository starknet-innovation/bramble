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
  /* Row stagger is gated behind .is-opening (added only on a genuine open) so a
     shell repaint that recreates the drawer node cannot replay it. */
  .drawer-root.is-opening[data-open="true"] .drawer-list li { animation: drawer-item ${MOTION.tabMs}ms var(--ease-out) both; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(2) { animation-delay: 30ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(3) { animation-delay: 60ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(4) { animation-delay: 90ms; }
  .drawer-root.is-opening[data-open="true"] .drawer-list li:nth-child(5) { animation-delay: 120ms; }

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
  /* Active tab: no box/pill fill — a flat text tab that reads as selected via
     the emerald accent (matching the sliding .tab-indicator underline and the
     borderless dock highlight). Inactive tabs stay muted; alignment plus the
     accent carry the state without any background. */
  button.home-tab[aria-selected="true"] { color: var(--mc-accent); }
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
    transition: transform ${MOTION.liftMs}ms ${MOTION.pop};
    width: 100%;
  }
  button.collectible-card:not(:disabled):hover { background: transparent; }
  button.collectible-card:not(:disabled):hover strong { color: var(--mc-accent); }
  button.collectible-card:not(:disabled):active { background: transparent; transform: scale(0.97); }

  /* Hover lift is gated to fine pointers so a tap on touch never leaves an
     element floating (touch fires a phantom :hover). Pointer devices raise the
     art tile with a soft shadow; the press scale is universal. */
  @media (hover: hover) and (pointer: fine) {
    button.collectible-card:not(:disabled):hover .collectible-art {
      box-shadow: var(--mc-edge), var(--mc-shadow-sm);
    }
  }
  .collectible-art {
    align-items: center;
    aspect-ratio: 1 / 1;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    color: var(--mc-muted);
    display: inline-flex;
    justify-content: center;
    transition: box-shadow ${MOTION.liftMs}ms ${MOTION.ease};
    width: 100%;
  }
  .collectible-art .icon { height: 28px; width: 28px; }
  .collectible-copy { display: grid; gap: 2px; min-width: 0; padding: 0 2px; width: 100%; }
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

  /* Account groups (folders): filter chips, per-account assignment panel, the
     icon picker grid, and the manage-accounts group list. Calm, hairline,
     skin-token only — matching the drawer aesthetic. */
  .group-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 2px; }
  button.group-chip {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    display: inline-flex;
    font-size: ${TYPE.caption.size};
    font-weight: 650;
    gap: 5px;
    min-height: 28px;
    padding: 0 ${SPACE.sm};
  }
  button.group-chip .icon { height: 14px; width: 14px; }
  button.group-chip:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.group-chip[aria-pressed="true"] { background: var(--mc-accent-soft); color: var(--mc-accent); }
  .drawer-account-item { display: grid; gap: 4px; }
  .drawer-account-row, .option-row-line { align-items: center; display: flex; gap: 6px; }
  .drawer-account-row .drawer-account, .option-row-line .option-row { flex: 1; min-width: 0; }
  button.drawer-assign { flex: none; }
  /* Ungrouped rows show a muted folder as a "pick a folder" affordance; a filed
     account shows its folder's icon at full ink. */
  button.drawer-assign.is-ungrouped { color: var(--mc-muted); }
  .option-group-item { display: grid; gap: 4px; }
  .account-groups-line { display: inline-flex; gap: 4px; margin-top: 2px; }
  .account-groups-line .icon { color: var(--mc-muted); height: 13px; width: 13px; }
  .group-assign {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.sm};
  }
  .group-assign .eyebrow { margin: 0; }
  .group-toggle-list { display: grid; gap: 4px; }
  button.group-toggle {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 36px;
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  button.group-toggle:not(:disabled):hover { background: var(--mc-hover); }
  button.group-toggle[aria-pressed="true"] { background: var(--mc-accent-soft); }
  .group-toggle-icon { align-items: center; color: var(--mc-muted); display: inline-flex; }
  .group-toggle-icon .icon { height: 16px; width: 16px; }
  .group-toggle-name { flex: 1; font-size: ${TYPE.body.size}; overflow: hidden; text-align: left; text-overflow: ellipsis; text-wrap: nowrap; }
  .group-toggle-mark .icon { height: 16px; width: 16px; }
  button.group-toggle[aria-pressed="true"] .group-toggle-mark .icon { color: var(--mc-accent); }
  .new-group-form, .edit-group-form { display: grid; gap: ${SPACE.sm}; }
  .group-name-input {
    background: var(--mc-panel);
    border-radius: ${RADIUS.sm};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    min-height: 38px;
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  .group-icon-picker {
    display: grid;
    gap: 4px;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  button.group-icon-option {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.sm};
    color: var(--mc-muted);
    display: inline-flex;
    justify-content: center;
    min-height: 34px;
    padding: 0;
  }
  button.group-icon-option .icon { height: 18px; width: 18px; }
  button.group-icon-option:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.group-icon-option[aria-pressed="true"] { background: var(--mc-accent-soft); color: var(--mc-accent); }
  .group-manage-list { display: grid; gap: ${SPACE.sm}; }
  .group-manage-row { display: grid; gap: ${SPACE.sm}; }
  .group-manage-icon { align-items: center; color: var(--mc-muted); display: inline-flex; }
  .group-manage-copy { display: grid; flex: 1; gap: 1px; min-width: 0; text-align: left; }
  .group-manage-copy strong { font-size: ${TYPE.body.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  /* Two-tap delete confirm: the first tap arms the control and reveals an
     explicit "Delete?" label beside the icon; a second tap deletes. */
  button[data-remove-group].is-confirming {
    color: var(--mc-danger);
    gap: 4px;
    padding: 0 ${SPACE.sm};
    width: auto;
  }
  button[data-remove-group].is-confirming::after {
    content: "Delete?";
    font-size: ${TYPE.caption.size};
    font-weight: 650;
  }

  /* Group-centric bulk members editor: an expandable header per group, then a
     roomy checklist of every wallet account. Hairline + skin-token only. */
  button.group-expand {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 48px;
    padding: 0 ${SPACE.sm};
    width: 100%;
  }
  button.group-expand:not(:disabled):hover { background: var(--mc-hover); }
  button.group-expand[aria-expanded="true"] { background: var(--mc-accent-soft); }
  button.group-expand[aria-expanded="true"] .group-manage-icon { color: var(--mc-accent); }
  .group-expand-mark { align-items: center; color: var(--mc-muted); display: inline-flex; flex: none; }
  .group-expand-mark .icon { height: 16px; width: 16px; }
  .group-members {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.sm};
  }
  .group-members-head { align-items: center; display: flex; gap: ${SPACE.sm}; }
  .group-members-head .eyebrow { flex: 1; margin: 0; }
  .account-check-list { display: grid; gap: 4px; max-height: 320px; overflow-y: auto; }
  button.account-check {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.sm};
    box-shadow: var(--mc-edge);
    color: var(--mc-text);
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    min-height: 48px;
    padding: 0 ${SPACE.sm};
    text-align: left;
    width: 100%;
  }
  button.account-check:not(:disabled):hover { background: var(--mc-hover); }
  button.account-check[aria-pressed="true"] { background: var(--mc-accent-soft); }
  .account-check .option-avatar { flex: none; }
  .account-check-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .account-check-copy strong { font-size: ${TYPE.body.size}; font-weight: 650; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .account-check-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .account-check-net {
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    flex: none;
    font-size: ${TYPE.caption.size};
    font-weight: 650;
    max-width: 92px;
    overflow: hidden;
    padding: 2px ${SPACE.sm};
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .account-check-mark { flex: none; }
  .account-check-mark .icon { color: var(--mc-muted); height: 18px; width: 18px; }
  button.account-check[aria-pressed="true"] .account-check-mark .icon { color: var(--mc-accent); }

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
