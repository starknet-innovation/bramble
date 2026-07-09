/**
 * Component layer of the side panel stylesheet: buttons, forms, gate screens,
 * callouts, data display, token/transaction rows, review panels, NFT and
 * request cards, pills, badges, reveal, QR, and toasts. Composed between the
 * base layer (./styles-base.ts) and the home/motion layer (./styles-home.ts)
 * in ./styles.ts.
 *
 * Surface rules: controls are borderless (structure from elevation and space),
 * fills are solid, and feedback transforms stay inside the press/lift envelope
 * enforced by tests/sidepanel-styles.test.ts.
 */
import { CONTROL, MOTION, RADIUS, SPACE, TYPE } from "../ui/tokens";
import { SIGN_REQUEST_STYLES } from "./sign-request";

/**
 * Component stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const COMPONENT_STYLES = `  /* Buttons: pill CTAs and circular icon buttons; feedback is color-only.
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
    background: transparent;
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
  button.icon-button { flex: none; height: ${CONTROL.hit}; min-height: 0; padding: 0; width: ${CONTROL.hit}; }
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

  /* Gate screens: centered brand, big heading, primary action at the bottom */
  .gate { align-items: center; display: flex; flex: 1; flex-direction: column; gap: ${SPACE.lg}; padding-top: ${SPACE.xl}; text-align: center; }
  .gate-brand {
    align-items: center;
    background: var(--mc-accent);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent-text);
    display: inline-flex;
    height: 64px;
    justify-content: center;
    margin-top: ${SPACE.xl};
    width: 64px;
  }
  .gate-brand .icon { height: 30px; width: 30px; }
  .gate-head { display: grid; gap: 6px; max-width: 34ch; }
  .gate-head h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; text-wrap: balance; }
  .gate-form { display: flex; flex: 1; flex-direction: column; gap: ${SPACE.md}; text-align: left; width: 100%; }
  .gate-cta { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.lg}; }
  .gate-cta button { width: 100%; }

  /* Content groups are flush — spacing only, no nested card borders. Genuine
     cards (callout, review panel, request/nft cards) carry their own single
     border below. */
  .section { display: grid; gap: ${SPACE.md}; }
  /* Callout: a neutral panel card; the accent lives only in the leading icon
     chip, so a waiting request draws the eye without turning the surface green. */
  .callout {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-edge);
    padding: ${SPACE.md} ${SPACE.lg};
  }
  .callout-icon {
    align-items: center;
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.sm};
    color: var(--mc-accent);
    display: inline-flex;
    flex: none;
    height: 34px;
    justify-content: center;
    width: 34px;
  }
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
    box-shadow: var(--mc-edge);
    padding: ${SPACE.sm} ${SPACE.sm} ${SPACE.sm} ${SPACE.md};
  }
  .address-line code { flex: 1; }
  .request-list, .address-book { display: grid; gap: ${SPACE.sm}; }
  /* Token list: de-boxed, flush rows carried by alignment and a single hairline
     divider — no per-row fill/edge/radius box. The right-hand fiat/change column
     is right-aligned with tabular figures; a hover fill still highlights a row. */
  .token-list { display: grid; }
  .token-row {
    align-items: center;
    border-radius: ${RADIUS.sm};
    display: flex;
    gap: ${SPACE.md};
    padding: ${SPACE.md} ${SPACE.sm};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms ${MOTION.pop};
  }
  .token-list > .token-row + .token-row { border-top: 1px solid var(--mc-hairline); }
  li.token-row:hover { background: var(--mc-hover); }
  li.token-row:has(button.token-open:active) { background: var(--mc-soft-press); transform: scale(0.985); }
  /* Token glyph: a neutral chip — the accent is reserved for signal, not logos. */
  .token-mark {
    align-items: center;
    background: var(--mc-sunken);
    border-radius: ${RADIUS.full};
    box-shadow: var(--mc-edge);
    color: var(--mc-muted);
    display: inline-flex;
    flex: none;
    font-size: 11px;
    font-weight: 800;
    height: 40px;
    justify-content: center;
    letter-spacing: 0.02em;
    width: 40px;
  }
  .token-logo {
    border-radius: ${RADIUS.full};
    flex: none;
    height: 40px;
    object-fit: cover;
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
  .token-detail-price { color: var(--mc-text); font-size: ${TYPE.amount.size}; font-weight: 800; letter-spacing: -0.02em; }
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
  /* Activity list: same de-boxed treatment as the token list — flush rows split
     by a single hairline divider, description left, semantic status + copy right. */
  .tx-list { display: grid; }
  .tx-row {
    align-items: center; border-radius: ${RADIUS.sm}; display: flex; gap: ${SPACE.sm};
    min-width: 0; padding: ${SPACE.md} ${SPACE.sm}; transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .tx-list > .tx-row + .tx-row { border-top: 1px solid var(--mc-hairline); }
  li.tx-row:hover { background: var(--mc-hover); }
  .tx-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .tx-copy strong {
    font-size: ${TYPE.label.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  /* Status reads as a plain semantic micro-label, not a boxed pill: pending
     stays muted, accepted goes emerald, reverted/rejected go danger. */
  .tx-status {
    color: var(--mc-muted);
    flex: none;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-align: right;
    text-transform: uppercase;
  }
  .tx-status.accepted { color: var(--mc-accent); }
  .tx-status.reverted, .tx-status.rejected { color: var(--mc-danger); }
  .review-panel {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md};
  }
  .review-panel p { color: var(--mc-text); font-size: ${TYPE.label.size}; }
${SIGN_REQUEST_STYLES}
  .review-flag { color: var(--mc-danger); font-size: ${TYPE.caption.size}; }
  .review-fee { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .tx-hint { color: var(--mc-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  .allowance-list { display: grid; gap: ${SPACE.sm}; }
  .allowance-row {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge);
    display: flex;
    gap: ${SPACE.sm};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .allowance-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
  .allowance-copy code { overflow-wrap: anywhere; }
  /* Collectibles gallery: clean image tiles, not boxed cards. Each item is a
     minimally framed art square (a hairline on the art tile only) over a tight
     caption, with compact ghost actions — no fill/edge box wraps the whole item. */
  .nft-grid { display: grid; gap: ${SPACE.md}; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nft-card { display: grid; gap: ${SPACE.sm}; min-width: 0; }
  button.nft-open {
    align-content: start; background: transparent; color: var(--mc-text); display: grid; gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr); min-height: 0; padding: 0; text-align: left;
  }
  button.nft-open:not(:disabled):hover, button.nft-open:not(:disabled):active { background: transparent; }
  button.nft-open:not(:disabled):hover strong { color: var(--mc-accent); }
  .nft-art {
    align-items: center; aspect-ratio: 1 / 1; background: var(--mc-soft); border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge); color: var(--mc-muted); display: inline-flex; justify-content: center;
    transition: box-shadow ${MOTION.liftMs}ms ${MOTION.ease}; width: 100%;
  }
  .nft-art .icon { height: 28px; width: 28px; }
  button.nft-open:not(:disabled):active .nft-art { box-shadow: var(--mc-edge), var(--mc-shadow-sm); }
  .nft-copy { display: grid; gap: 2px; min-width: 0; padding: 0 2px; }
  .nft-copy strong { overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  .nft-copy code { color: var(--mc-muted); font-size: ${TYPE.caption.size}; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  /* Compact two-up ghost actions; the danger Remove stays borderless like Hide
     (red ink carries the signal, not a box), with danger-soft hover feedback. */
  .nft-actions { display: grid; gap: 6px; grid-template-columns: 1fr 1fr; }
  .nft-actions button { min-width: 0; padding: 0 ${SPACE.sm}; }
  .nft-actions button.danger { background: transparent; }
  .nft-actions button.danger:not(:disabled):hover { background: var(--mc-danger-soft); }
  /* dApp approval/sign prompts are a solid panel card — a hairline edge plus a
     gentle low shadow lift a consequential request above the request list. */
  .request-card {
    background: var(--mc-panel);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge), var(--mc-elev-sm);
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
    box-shadow: var(--mc-edge);
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
    box-shadow: var(--mc-edge);
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
    box-shadow: var(--mc-edge);
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

  /* QR: fixed light card so codes scan identically in both themes. */
  .qr-card {
    background: hsl(0 0% 100%);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge), var(--mc-elev-md);
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
  /* Toasts are a solid panel pill dragged/dismissed with an interruptible WAAPI
     spring from ./dom.ts, so their entrance is not a CSS keyframe (keyframes
     restart from zero and cannot be grabbed mid-flight). */
  .toast {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.md};
    box-shadow: var(--mc-edge), var(--mc-elev-md);
    color: var(--mc-text);
    display: flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.sm};
    padding: ${SPACE.sm} ${SPACE.md};
    pointer-events: auto;
    touch-action: pan-y;
  }
  .toast-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  button.toast-copy { height: 30px; min-height: 30px; width: 30px; }
`;
