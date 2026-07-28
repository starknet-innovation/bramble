/**
 * Structured-content layer of the side panel stylesheet: the receipt
 * (key-value) list, the segmented control, the native-details disclosure
 * (accordion), and the approval-takeover chrome. These are the components the
 * information-dense screens are built from — settings, token detail, account
 * details, and dapp requests — so facts read as calm structured rows instead
 * of bordered boxes. Composed after the control layer in ./styles.ts.
 *
 * Surface rules match the rest of Clean Mono: soft solid fills, inset hairline
 * DIVIDERS for separation (never rings around content), values right-aligned
 * with tabular/mono voices where the data warrants it.
 */
import { CONTROL, MOTION, RADIUS, SIZE, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Structured-content stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const STRUCTURE_STYLES = `  /* Receipt: label-left / value-right rows on one soft surface, split by inset
     hairline dividers — contract facts, account identifiers, and request
     details read as a receipt, not a grid of boxes. Values keep the mono voice
     for identifiers and sit flush right; a trailing icon button (copy) docks
     after the value. */
  dl.receipt, .receipt { margin: 0; }
  .receipt {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    padding: 0 ${SPACE.lg};
  }
  .receipt-row {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
    min-height: 44px;
    padding: ${SPACE.xs} 0;
    position: relative;
  }
  .receipt-row + .receipt-row::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .receipt-row dt {
    color: var(--mc-muted);
    flex: none;
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.medium};
  }
  .receipt-row dd {
    align-items: center;
    color: var(--mc-text);
    display: flex;
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.medium};
    gap: 6px;
    margin: 0;
    min-width: 0;
    text-align: right;
  }
  .receipt-row dd code { color: var(--mc-text); overflow-wrap: normal; word-break: normal; }
  .receipt-row dd .icon-button { height: 28px; min-height: 0; width: 28px; }
  .receipt-row dd .icon-button .icon { height: 15px; width: 15px; }

  /* Approval request facts use the same receipt grammar, but allow long
     untrusted identifiers to wrap inside the panel instead of widening it. */
  .request-detail {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    min-width: 0;
    overflow: hidden;
    padding: 0 ${SPACE.md};
  }
  .request-detail > div {
    align-items: start;
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: minmax(88px, auto) minmax(0, 1fr);
    padding: ${SPACE.sm} 0;
    position: relative;
  }
  .request-detail > div + div::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .request-detail dt { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .request-detail dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: right;
    word-break: break-word;
  }
  .request-detail dd code {
    display: inline;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .review-calls {
    background: var(--mc-soft);
    border-radius: ${RADIUS.md};
    display: grid;
    gap: ${SPACE.sm};
    min-width: 0;
    padding: ${SPACE.md};
  }
  .review-call {
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Segmented control: one recessed track, equal flat options, the active one
     lifted on a soft panel chip. Used for small either/or preferences (theme). */
  .seg {
    background: var(--mc-sunken);
    border-radius: ${RADIUS.full};
    display: grid;
    gap: 3px;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    padding: 3px;
  }
  button.seg-option {
    background: transparent;
    border-radius: ${RADIUS.full};
    color: var(--mc-muted);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
    min-height: 34px;
    padding: 0 ${SPACE.md};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease}, color ${MOTION.pressMs}ms ${MOTION.ease};
  }
  @media (hover: hover) and (pointer: fine) {
    button.seg-option:not(:disabled):hover { background: transparent; color: var(--mc-text); }
    button.seg-option[aria-pressed="true"]:not(:disabled):hover { background: var(--mc-panel); color: var(--mc-text); }
  }
  button.seg-option:not(:disabled):active { background: transparent; transform: scale(0.97); }
  button.seg-option[aria-pressed="true"] {
    background: var(--mc-panel);
    box-shadow: var(--mc-elev-xs);
    color: var(--mc-text);
  }

  /* Disclosure: a native details/summary accordion styled as a grouped row.
     Advanced or secondary content (custom endpoints, group editors) collapses
     behind a scannable header so the primary path stays light; the chevron
     rotates on open and the body sits on a recessed fill. */
  details.disclosure {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    overflow: hidden;
  }
  details.disclosure > summary {
    align-items: center;
    color: var(--mc-text);
    cursor: pointer;
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-start;
    list-style: none;
    min-height: 52px;
    padding: 0 ${SPACE.lg};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
    user-select: none;
  }
  details.disclosure > summary::-webkit-details-marker { display: none; }
  @media (hover: hover) and (pointer: fine) {
    details.disclosure > summary:hover { background: var(--mc-hover); }
  }
  details.disclosure > summary .menu-copy strong { font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.medium}; }
  .disclosure-mark { color: var(--mc-muted); display: inline-flex; flex: none; transition: transform ${MOTION.tabMs}ms var(--ease-out); }
  .disclosure-mark .icon { height: 16px; width: 16px; }
  details.disclosure[open] > .disclosure-mark, details.disclosure[open] > summary .disclosure-mark { transform: rotate(90deg); }
  .disclosure-body {
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.md} ${SPACE.lg} ${SPACE.lg};
    position: relative;
  }
  .disclosure-body::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .disclosure-stack { display: grid; gap: ${SPACE.sm}; }

  /* Approval takeover: a dapp request takes the whole panel the moment it
     arrives — origin identity up top, the full request as the screen body, the
     decision as the primary action. "Not now" is the quiet escape hatch that
     parks the request in Activity instead of trapping the wallet. */
  .approval-header { align-items: flex-start; }
  .approval-header .flow-title { gap: 2px; }
  .approval-header .flow-title h1 { font-size: ${TYPE.display.size}; letter-spacing: -0.02em; }
  .takeover-network {
    align-items: center;
    color: var(--mc-muted);
    display: inline-flex;
    flex: none;
    font-size: ${TYPE.caption.size};
    gap: 6px;
    min-height: 28px;
    text-wrap: nowrap;
  }
  .approval-takeover { grid-template-rows: minmax(0, 1fr) auto auto; min-height: 0; }
  .approval-takeover .request-list { min-height: 0; }
  .approval-takeover .request-card {
    background: transparent;
    border-radius: 0;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 0;
  }
  .approval-takeover .request-site {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    box-shadow: var(--mc-elev-sm);
    padding: ${SPACE.lg};
  }
  .approval-takeover .request-site-mark {
    background: var(--mc-accent-soft);
    color: var(--mc-accent);
  }
  .approval-takeover .request-site-copy strong {
    font-size: ${TYPE.title.size};
    letter-spacing: -0.01em;
  }
  .approval-takeover .review-panel {
    background: transparent;
    border-radius: 0;
    box-shadow: inset 0 1px 0 var(--mc-hairline);
    padding: ${SPACE.md} 0 0;
  }
  .approval-takeover .review-flag {
    align-items: flex-start;
    color: var(--mc-muted);
    display: flex;
    gap: ${SPACE.sm};
    line-height: ${TYPE.caption.line};
  }
  .approval-takeover .review-flag .icon { color: var(--mc-danger); flex: none; margin-top: 1px; }
  .approval-takeover .button-row {
    grid-template-columns: minmax(0, 1fr) minmax(104px, auto);
    margin-top: auto;
    padding-top: ${SPACE.xl};
  }
  .takeover-queue { color: var(--mc-muted); font-size: ${TYPE.caption.size}; text-align: center; }
  .takeover-foot { display: grid; gap: ${SPACE.sm}; }
  .takeover-foot button.ghost { justify-self: center; min-height: ${SPACE.xl}; }

  /* Ledger sign takeover: a keyless-Ledger request parks in the background and
     must be fulfilled from the panel that owns the device, so while one is
     pending it takes the whole panel over the dashboard — the user confirms on
     the device wherever they were. Owned outside the shell repaint so streaming
     data never resets an in-flight device prompt. */
  .ledger-sign-overlay {
    background: var(--mc-bg);
    display: grid;
    grid-template-rows: auto 1fr;
    inset: 0;
    overflow-y: auto;
    padding: ${SPACE.lg};
    position: fixed;
    z-index: 40;
  }
  .ledger-sign-overlay[hidden] { display: none; }

  /* Ledger onboarding overlay: the same repaint-surviving full-panel takeover as
     the sign overlay, but its states carry no header, so it lays out its single
     child itself. The short states (chooser / connect / reading / error) render
     an .onboard-hero that fills the viewport and centres its content block; the
     account picker renders a top-aligned .onboard-picker that scrolls when its
     list outgrows the panel. All rhythm comes from the scale tokens. */
  .ledger-onboard-overlay {
    background: var(--mc-bg);
    display: grid;
    inset: 0;
    overflow-y: auto;
    padding: ${SPACE.lg};
    position: fixed;
    z-index: 40;
  }
  .ledger-onboard-overlay[hidden] { display: none; }
  .onboard-hero {
    align-content: center;
    display: grid;
    gap: ${SPACE.lg};
    justify-items: center;
    min-block-size: 100%;
    text-align: center;
  }
  .onboard-hero .gate-head { display: grid; gap: 6px; max-width: 34ch; }
  .onboard-hero .gate-head h1 {
    font-size: ${TYPE.title.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
  }
  .add-account-hero {
    align-content: stretch;
    grid-template-rows: auto 1fr auto;
    justify-items: stretch;
    text-align: left;
  }
  .add-account-header {
    align-items: center;
    display: flex;
    justify-content: center;
    min-height: ${CONTROL.hit};
    position: relative;
  }
  .add-account-header h1 {
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
  }
  .add-account-header .icon-button {
    position: absolute;
    right: 0;
  }
  .onboard-hero .add-account-chooser {
    align-content: start;
    display: grid;
    gap: ${SPACE.sm};
    padding-block: ${SPACE.xl};
    text-align: left;
    width: 100%;
  }
  .add-account-option {
    align-items: center;
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr) auto;
    min-height: ${SIZE.tile};
    padding: ${SPACE.md} ${SPACE.lg};
    text-align: left;
    width: 100%;
  }
  .add-account-option-icon {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    display: inline-flex;
    height: ${SIZE.mark};
    justify-content: center;
    width: ${SIZE.mark};
  }
  .add-account-option-icon .icon {
    height: ${CONTROL.majorIcon};
    width: ${CONTROL.majorIcon};
  }
  .add-account-option-copy { display: grid; gap: ${SPACE.xs}; min-width: 0; }
  .add-account-option-copy strong { font-size: ${TYPE.title.size}; }
  .add-account-option-copy span {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .add-account-option-check {
    align-items: center;
    background: var(--mc-text);
    border-radius: ${RADIUS.full};
    color: var(--mc-bg);
    display: inline-flex;
    height: ${SIZE.pill};
    justify-content: center;
    opacity: 0;
    transform: scale(0.84);
    transition:
      opacity ${MOTION.liftMs}ms var(--ease-out),
      transform ${MOTION.liftMs}ms var(--ease-out);
    width: ${SIZE.pill};
  }
  .add-account-option-check .icon { height: ${CONTROL.icon}; width: ${CONTROL.icon}; }
  .add-account-option[aria-pressed="true"] {
    background: var(--mc-elevated);
    box-shadow: inset 0 0 0 2px var(--mc-text);
  }
  .add-account-option[aria-pressed="true"] .add-account-option-check {
    opacity: 1;
    transform: scale(1);
  }
  @media (hover: hover) and (pointer: fine) {
    button.add-account-option:not(:disabled):hover {
      background: var(--mc-hover);
      color: var(--mc-text);
    }
    button.add-account-option[aria-pressed="true"]:not(:disabled):hover {
      background: var(--mc-elevated);
      color: var(--mc-text);
    }
  }
  .onboard-actions { display: grid; gap: ${SPACE.sm}; justify-items: stretch; width: 100%; }
  .onboard-actions button { width: 100%; }
  .onboard-actions .ghost { justify-self: center; width: auto; }
  .onboard-picker { align-content: start; display: grid; gap: ${SPACE.md}; }
  .onboard-picker .gate-head { display: grid; gap: 6px; }
  .onboard-picker .gate-head h1 {
    font-size: ${TYPE.title.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
  }
  .onboard-picker [data-ledger-load-more] { justify-self: start; }
  /* Selection row: the checkbox and the account copy sit on one tappable label
     across the full row width. */
  .select-row {
    align-items: center;
    cursor: pointer;
    display: flex;
    flex: 1;
    gap: ${SPACE.md};
    min-width: 0;
  }
  .select-check { accent-color: var(--mc-accent); flex: none; height: ${SPACE.lg}; width: ${SPACE.lg}; }
  .allowance-row.is-duplicate { opacity: 0.68; }
  @media (prefers-reduced-motion: reduce) {
    .add-account-option-check { transition: none; }
  }
`;
