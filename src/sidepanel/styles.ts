/**
 * Side panel stylesheet composed from the shared design-system tokens.
 *
 * ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after render.
 *
 *   0ms   shell mounts; controls are laid out once and never move again
 *  90ms   hover and press feedback settles — color-only, zero translation
 * 200ms   a newly opened screen fades in and rises 4px into place
 * 220ms   toasts slide into the fixed stack above the shell
 *
 * Press stability contract: interactive controls are borderless and change
 * only paint properties (background, text color) on hover and press. Nothing
 * scales, translates, or reflows on hover, press, or selection.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE } from "../ui/tokens";
import { BASE_STYLES } from "./styles-base";

/**
 * Skin-token-only stylesheet injected by the side panel entrypoint.
 */
export const SIDEPANEL_STYLES = `${BASE_STYLES}  /* Buttons: pill CTAs and circular icon buttons; feedback is color-only.
     appearance:none removes the native button bevel (a light top edge + dark
     bottom edge) so controls are genuinely borderless. */
  button {
    align-items: center;
    appearance: none;
    -webkit-appearance: none;
    background: var(--mc-accent);
    border: 0;
    border-radius: ${RADIUS.full};
    box-shadow: none;
    color: var(--mc-accent-text);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: 700;
    gap: ${SPACE.sm};
    justify-content: center;
    letter-spacing: -0.01em;
    min-height: 46px;
    min-width: 0;
    padding: 0 ${SPACE.lg};
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      border-color ${MOTION.pressMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease};
  }
  button:not(:disabled):hover { background: var(--mc-accent-hover); }
  button:not(:disabled):active { background: var(--mc-accent-press); }
  button.secondary {
    background: var(--mc-elevated);
    color: var(--mc-text);
  }
  button.icon-button {
    background: var(--mc-elevated);
    color: var(--mc-text);
  }
  button.secondary:not(:disabled):hover, button.icon-button:not(:disabled):hover {
    background: var(--mc-hover);
  }
  button.secondary:not(:disabled):active, button.icon-button:not(:disabled):active {
    background: var(--mc-soft-press);
  }
  button.ghost {
    background: transparent;
    color: var(--mc-muted);
  }
  button.ghost:not(:disabled):hover { background: var(--mc-hover); color: var(--mc-text); }
  button.danger { background: var(--mc-elevated); color: var(--mc-danger); }
  button.danger:not(:disabled):hover { background: var(--mc-danger-soft); }
  button.danger:not(:disabled):active { background: var(--mc-danger-soft); }
  button.icon-button { flex: none; height: ${CONTROL.hit}; padding: 0; width: ${CONTROL.hit}; }
  button.small { font-size: ${TYPE.label.size}; min-height: ${CONTROL.hitSmall}; padding: 0 ${SPACE.md}; }
  button:disabled, input:disabled, select:disabled, textarea:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  button[data-busy] { opacity: 0.7; }

  /* Forms */
  form { display: grid; gap: ${SPACE.md}; }
  label { display: grid; gap: 6px; }
  label > span:first-child, .eyebrow, .context-label {
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    font-weight: 650;
  }
  .eyebrow { letter-spacing: 0.02em; text-transform: uppercase; font-size: ${TYPE.caption.size}; }
  input, select, textarea {
    appearance: none;
    -webkit-appearance: none;
    background: var(--mc-elevated);
    border: 0;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    font: inherit;
    min-height: 46px;
    min-width: 0;
    padding: 0 ${SPACE.md};
    transition: border-color ${MOTION.pressMs}ms ${MOTION.ease};
    width: 100%;
  }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  input::placeholder, textarea::placeholder { color: var(--mc-muted); opacity: 0.7; }
  select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b95a5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-position: right ${SPACE.md} center;
    background-repeat: no-repeat;
    padding-right: 36px;
  }
  textarea {
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: 1.6;
    min-height: 96px;
    padding: ${SPACE.sm} ${SPACE.md};
    resize: vertical;
  }
  input.mono { font-family: var(--mc-font-mono); font-size: ${TYPE.mono.size}; }
  .hint { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .lede { color: var(--mc-muted); }
  [role="status"] { color: var(--mc-muted); font-size: ${TYPE.caption.size}; min-height: 16px; overflow-wrap: anywhere; }

  /* Content groups are flush — spacing only, no nested card borders. Genuine
     cards (callout, review panel, request/nft cards) carry their own single
     border below. */
  .section { display: grid; gap: ${SPACE.md}; }
  .callout {
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.lg};
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .callout-icon { color: var(--mc-accent); display: inline-flex; flex: none; }
  .deploy-notice { display: grid; gap: 2px; justify-items: start; }
  button.deploy-chip { color: var(--mc-danger); }
  button.deploy-chip:not(:disabled):hover, button.deploy-chip:not(:disabled):active {
    background: var(--mc-danger-soft);
  }
  .callout-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .callout-copy strong { font-size: ${TYPE.body.size}; }
  .callout-copy p { font-size: ${TYPE.caption.size}; }

  /* Data display */
  code {
    color: var(--mc-text);
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: ${TYPE.mono.line};
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .value { color: var(--mc-text); font-weight: 650; overflow-wrap: anywhere; }
  .context-line code { overflow-wrap: normal; word-break: normal; }
  .address-line {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    padding: ${SPACE.sm} ${SPACE.sm} ${SPACE.sm} ${SPACE.md};
  }
  .address-line code { flex: 1; }
  .token-list, .request-list, .address-book { display: grid; gap: 6px; }
  .token-row {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    gap: ${SPACE.md};
    padding: ${SPACE.md};
  }
  .token-mark {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    display: inline-flex;
    flex: none;
    font-size: 11px;
    font-weight: 800;
    height: 40px;
    justify-content: center;
    letter-spacing: 0.02em;
    width: 40px;
  }
  .token-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
  .token-copy strong { font-size: ${TYPE.body.size}; font-weight: 650; }
  .token-copy p {
    font-size: ${TYPE.caption.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .token-amount {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .token-side { align-items: flex-end; display: grid; flex: none; gap: 2px; text-align: right; }
  .token-fiat { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-variant-numeric: tabular-nums; }
  .token-change { font-size: ${TYPE.caption.size}; font-variant-numeric: tabular-nums; font-weight: 650; }
  .token-change.up { color: var(--mc-positive); }
  .token-change.down { color: var(--mc-danger); }
  .token-row .token-open {
    background: transparent;
    border-radius: ${RADIUS.md};
    color: var(--mc-text);
    flex: 1;
    justify-content: flex-start;
    min-height: 0;
    min-width: 0;
    padding: 0;
    text-align: left;
  }
  .token-row .token-open:not(:disabled):hover,
  .token-row .token-open:not(:disabled):active {
    background: transparent;
  }
  .token-row .token-open:not(:disabled):hover strong { color: var(--mc-accent); }
  .token-row.token-hidden { opacity: 0.6; }
  .token-flag {
    background: var(--mc-danger-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-danger);
    flex: none;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 3px 8px;
    text-transform: uppercase;
  }
  .token-detail-price { font-size: ${TYPE.amount.size}; font-weight: 800; letter-spacing: -0.02em; }
  .sparkline { display: block; height: 48px; width: 100%; }
  .sparkline polyline {
    fill: none;
    stroke: var(--mc-muted);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .sparkline-up polyline { stroke: var(--mc-accent); }
  .sparkline-down polyline { stroke: var(--mc-danger); }
  .request-list { gap: ${SPACE.md}; }
  .tx-list { display: grid; gap: ${SPACE.sm}; }
  .tx-row {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: flex;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .tx-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .tx-copy strong {
    font-size: ${TYPE.label.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-status {
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    flex: none;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 3px 8px;
    text-transform: uppercase;
  }
  .tx-status.accepted { color: var(--mc-accent); }
  .tx-status.reverted, .tx-status.rejected { color: var(--mc-danger); }
  .review-panel {
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md};
  }
  .review-panel p { color: var(--mc-text); font-size: ${TYPE.label.size}; }
  .review-flag { color: var(--mc-danger); font-size: ${TYPE.caption.size}; }
  .review-fee { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .tx-hint { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .allowance-list, .nft-grid { display: grid; gap: ${SPACE.sm}; }
  .allowance-row {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: flex;
    gap: ${SPACE.sm};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .allowance-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
  .allowance-copy code { overflow-wrap: anywhere; }
  .nft-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nft-card {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: ${SPACE.sm};
  }
  button.nft-open {
    align-items: start;
    background: var(--mc-elevated);
    justify-content: flex-start;
    min-height: 0;
    padding: ${SPACE.sm};
    text-align: left;
  }
  button.nft-open:not(:disabled):hover { background: var(--mc-hover); }
  button.nft-open:not(:disabled):active { background: var(--mc-soft-press); }
  .nft-mark { align-items: center; color: var(--mc-muted); display: inline-flex; flex: none; }
  .nft-copy { display: grid; gap: 2px; min-width: 0; }
  .nft-copy strong { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .nft-actions { display: flex; gap: ${SPACE.sm}; }
  .nft-actions button { flex: 1; }
  .request-card {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.md};
  }
  .request-copy { display: grid; gap: 2px; min-width: 0; }
  .request-origin { color: var(--mc-text); font-family: var(--mc-font-mono); font-weight: 650; overflow-wrap: anywhere; }
  .detail-grid { display: grid; gap: ${SPACE.sm}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .detail p { font-size: ${TYPE.caption.size}; }
  .detail .value { font-family: var(--mc-font-mono); font-size: ${TYPE.title.size}; }
  .pill {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    display: inline-flex;
    flex: none;
    font-size: ${TYPE.caption.size};
    font-weight: 600;
    gap: 6px;
    min-height: 28px;
    padding: 3px ${SPACE.md};
    text-wrap: nowrap;
  }
  .dot { background: var(--mc-positive); border-radius: ${RADIUS.full}; height: 7px; width: 7px; }
  .badge {
    background: var(--mc-danger);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    min-width: 16px;
    padding: 3px 5px;
    text-align: center;
  }
  .empty {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.md};
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    padding: ${SPACE.lg} ${SPACE.md};
    text-align: center;
  }

  /* Reveal secrets: blurred until tapped; wiped whenever the shell re-renders */
  [hidden] { display: none !important; }
  .reveal-warning { }
  .reveal-danger { color: var(--mc-danger); font-weight: 650; }
  .reveal-output { display: grid; gap: ${SPACE.sm}; }
  .reveal-value {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    font-family: var(--mc-font-mono);
    font-size: ${TYPE.mono.size};
    line-height: ${TYPE.mono.line};
    overflow-wrap: anywhere;
    padding: ${SPACE.sm} ${SPACE.md};
    word-break: break-all;
  }
  .reveal-value.is-masked { filter: blur(7px); user-select: none; }
  .verify-grid { display: grid; gap: ${SPACE.sm}; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .icon {
    fill: none;
    height: ${CONTROL.icon};
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    width: ${CONTROL.icon};
  }

  /* QR: fixed light card so codes scan identically in both themes */
  .qr-card {
    background: hsl(0 0% 100%);
    border-radius: ${RADIUS.md};
    color: hsl(0 0% 8%);
    justify-self: center;
    padding: ${SPACE.sm};
    width: min(232px, 100%);
  }
  .qr { display: block; height: auto; width: 100%; }

  /* Toasts: pinned above the dock at the bottom of the panel */
  .toast-stack {
    bottom: 84px;
    display: grid;
    gap: ${SPACE.sm};
    left: ${SPACE.md};
    pointer-events: none;
    position: fixed;
    right: ${SPACE.md};
    z-index: 10;
  }
  .toast {
    align-items: center;
    animation: toast-enter ${MOTION.toastMs}ms ${MOTION.ease} both;
    background: var(--mc-panel);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-shadow);
    color: var(--mc-text);
    display: flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.sm};
    padding: ${SPACE.sm} ${SPACE.md};
    pointer-events: auto;
  }
  .toast.error { box-shadow: var(--mc-shadow); }
  .toast-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  button.toast-copy { height: 30px; min-height: 30px; width: 30px; }

  /* Motion: screens animate only when the scene changes, never on re-render */
  .shell-animate .screen { animation: screen-enter ${MOTION.enterMs}ms ${MOTION.ease} both; }
  @keyframes screen-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes toast-enter {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .shell-animate .screen, .toast { animation: none; }
    button, input, select, textarea { transition: none; }
  }
`;
