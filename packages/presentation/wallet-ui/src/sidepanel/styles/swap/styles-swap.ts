/**
 * Swap-screen layer of the side panel stylesheet: the Sell/Buy panel pair
 * around the flip control, the display-grade amount field, token chips, the
 * rate/fee meta line, the inline token picker, and the confirm/receipt
 * stages. Follows the de-bordered language — grouped panel fills, no rings —
 * and every colour rides the skin tokens. Composed after the structure layer
 * in ./styles.ts.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@mc-wallet/ui-kit/tokens";

/**
 * Swap stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const SWAP_STYLES = `  .swap-stage { display: grid; gap: ${SPACE.md}; }
  /* The pair reads as one instrument: two soft panels with a hairline of page
     ground between them and the flip control riding the seam. */
  .swap-card { display: grid; gap: 3px; position: relative; }
  .swap-panel {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: ${SPACE.sm};
    padding: ${SPACE.md} ${SPACE.lg};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .swap-panel:focus-within { background: color-mix(in srgb, var(--mc-text) 3%, var(--mc-panel)); }
  .swap-label { color: var(--mc-muted); font-size: ${TYPE.caption.size}; font-weight: ${WEIGHT.medium}; }
  .swap-main { align-items: center; display: flex; gap: ${SPACE.md}; }
  /* Display-grade amount: the number is the interface. The panel's focus tint
     carries focus, so the field's own ring is suppressed deliberately. */
  .swap-amount {
    background: transparent;
    border: 0;
    border-radius: 0;
    color: var(--mc-text);
    flex: 1;
    font-size: ${TYPE.headline.size};
    font-variant-numeric: tabular-nums;
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
    line-height: ${TYPE.headline.line};
    min-height: 40px;
    min-width: 0;
    padding: 0;
    width: 100%;
  }
  input.swap-amount:focus-visible {
    background: transparent;
    box-shadow: inset 0 -2px 0 var(--mc-focus-ring);
    outline: none;
  }
  @media (hover: hover) and (pointer: fine) {
    input.swap-amount:not(:disabled):hover { background: transparent; }
  }
  .swap-amount.is-output { align-self: center; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  button.swap-token {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    flex: none;
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
    gap: 6px;
    min-height: 36px;
    padding: 0 10px 0 6px;
  }
  button.swap-token .token-mark, button.swap-token .token-logo { height: 24px; width: 24px; }
  button.swap-token .token-mark { font-size: 9px; }
  button.swap-token .icon { color: var(--mc-muted); height: 14px; width: 14px; }
  .swap-sub {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    font-variant-numeric: tabular-nums;
    justify-content: space-between;
    min-height: 20px;
  }
  .swap-balance { align-items: center; display: inline-flex; gap: 6px; }
  button.swap-max {
    background: var(--mc-accent-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-accent);
    font-size: ${TYPE.micro.size};
    font-weight: ${WEIGHT.semibold};
    min-height: 22px;
    padding: 0 ${SPACE.sm};
  }
  /* Flip control: a circular button riding the seam between the panels, cut
     out of the page ground so the panels read as parted around it. */
  button.swap-flip {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    box-shadow: 0 0 0 3px var(--mc-bg);
    color: var(--mc-text);
    height: 36px;
    left: 50%;
    min-height: 0;
    padding: 0;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    transition: background ${MOTION.pressMs}ms ${MOTION.ease}, transform ${MOTION.liftMs}ms var(--ease-out);
    width: 36px;
    z-index: 1;
  }
  button.swap-flip .icon { height: 16px; width: 16px; }
  @media (hover: hover) and (pointer: fine) {
    button.swap-flip:not(:disabled):hover { background: var(--mc-hover); }
  }
  button.swap-flip:not(:disabled):active { transform: translate(-50%, -50%) scale(0.96); }
  .swap-meta {
    align-items: center;
    color: var(--mc-muted);
    display: flex;
    font-size: ${TYPE.caption.size};
    font-variant-numeric: tabular-nums;
    justify-content: space-between;
    min-height: 18px;
    padding: 0 ${SPACE.sm};
  }
  /* Inline token picker: the grouped-list treatment, entering softly. */
  .swap-picker {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    max-height: 320px;
    overflow-y: auto;
  }
  .swap-picker:not([hidden]) { animation: panel-enter ${MOTION.enterMs}ms var(--ease-out) both; }
  .swap-picker > * + * { position: relative; }
  .swap-picker > * + *::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    left: ${SPACE.lg};
    position: absolute;
    right: 0;
    top: 0;
  }
  .swap-picker .token-mark, .swap-picker .token-logo { height: 28px; width: 28px; }
  .swap-picker .token-mark { font-size: 9px; }
  #swap-confirm { min-width: 0; padding-bottom: ${SPACE.lg}; }
  #swap-confirm .receipt { min-width: 0; }
  .swap-review-pair {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    padding: ${SPACE.md} 0;
  }
  .swap-review-asset { align-items: center; display: flex; gap: ${SPACE.sm}; min-width: 0; }
  .swap-review-asset:last-child { justify-content: flex-end; text-align: right; }
  .swap-review-asset > span:last-child { display: grid; min-width: 0; }
  .swap-review-asset small { color: var(--mc-muted); font-size: ${TYPE.micro.size}; }
  .swap-review-asset strong { font-size: ${TYPE.label.size}; overflow-wrap: anywhere; }
  .swap-review-asset .token-logo, .swap-review-asset .token-mark { flex: none; height: 30px; width: 30px; }
  .swap-review-asset .token-mark { font-size: 9px; }
  .swap-review-arrow { color: var(--mc-muted); display: inline-flex; transform: rotate(-90deg); }
  .swap-review-arrow .icon { height: 15px; width: 15px; }
  .swap-actions { display: grid; gap: ${SPACE.sm}; }
  /* Quote sanity heuristics: the value delta rides the buy USD line and turns
     danger when the route loses real value; past the warn threshold an
     explicit explanation appears, and past high-risk the submit action itself
     restyles as a danger control labelled "Swap anyway". */
  .swap-delta-bad, dd.swap-delta-bad { color: var(--mc-danger); }
  .swap-warning {
    background: var(--mc-danger-soft);
    border-radius: ${RADIUS.md};
    color: var(--mc-danger);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    line-height: ${TYPE.caption.line};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  button#swap-review.swap-risk { background: var(--mc-danger); color: var(--mc-bg); }
  /* Token picker sheet: a full-screen chooser over the swap screen — search,
     quick chips for the majors, then the verified catalog as a grouped list.
     Solid page ground so the sheet reads as its own place, not a popover. */
  .swap-sheet {
    background: var(--mc-bg);
    display: flex;
    flex-direction: column;
    gap: ${SPACE.md};
    inset: 0;
    overflow-y: auto;
    padding: ${SPACE.md} ${SPACE.lg} ${SPACE.lg};
    position: fixed;
    z-index: 15;
  }
  .swap-sheet[data-closing="true"] { pointer-events: none; }
  .swap-sheet-head { align-items: center; display: flex; justify-content: space-between; }
  .swap-sheet-head h2 { flex: 1; text-align: center; }
  /* Symmetry spacer: the close button sits right, so the title centre-line
     needs matching space on the left. */
  .swap-sheet-head::before { content: ""; flex: none; width: 40px; }
  input.swap-search { flex: none; }
  .swap-chips { display: flex; flex-wrap: wrap; gap: ${SPACE.sm}; }
  button.swap-chip {
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
    gap: 6px;
    min-height: 36px;
    padding: 0 ${SPACE.md} 0 ${SPACE.sm};
  }
  button.swap-chip .token-mark, button.swap-chip .token-logo { height: 20px; width: 20px; }
  button.swap-chip .token-mark { font-size: 8px; }
  .swap-sheet-list { display: grid; gap: ${SPACE.sm}; }
  .swap-sheet-label { padding: ${SPACE.xs} ${SPACE.sm} 0; }
  .swap-sheet-group {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
  }
  .swap-sheet-group > * + * { position: relative; }
  .swap-sheet-group > * + *::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    left: ${SPACE.lg};
    position: absolute;
    right: 0;
    top: 0;
  }
  .swap-sheet-group .option-row { min-height: 60px; }
  .swap-sheet-group .token-mark, .swap-sheet-group .token-logo { height: 32px; width: 32px; }
  .swap-sheet-group .token-mark { font-size: 10px; }
  .swap-sheet-group .option-sub code { color: var(--mc-muted); font-size: ${TYPE.micro.size}; }
  /* Verified mark: catalog entries are AVNU-verified; the check reads in the
     success voice beside the name. */
  .swap-verified { color: var(--mc-positive); display: inline-flex; vertical-align: middle; }
  .swap-verified .icon { height: 13px; width: 13px; }
  /* Success moment: the ring draws itself, the check follows, the copy rises
     beneath — a felt confirmation, held briefly before the flow returns home
     on its own. Stroke-draw keyframes settle to their end state (forwards) and
     collapse to static marks under reduced motion via the home layer. */
  .swap-success { gap: ${SPACE.sm}; justify-items: center; padding-top: 56px; text-align: center; }
  .swap-success-mark { color: var(--mc-positive); display: inline-flex; height: 72px; width: 72px; }
  .swap-success-mark svg {
    fill: none;
    height: 100%;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.2;
    width: 100%;
  }
  .swap-success-ring {
    animation: swap-draw 480ms var(--ease-out) 60ms forwards;
    stroke-dasharray: 158;
    stroke-dashoffset: 158;
  }
  .swap-success-check {
    animation: swap-draw 300ms var(--ease-out) 460ms forwards;
    stroke-dasharray: 32;
    stroke-dashoffset: 32;
  }
  @keyframes swap-draw { to { stroke-dashoffset: 0; } }
  .swap-success h2, .swap-success .swap-success-summary, .swap-success .hint {
    animation: rise-in 260ms var(--ease-out) both;
  }
  .swap-success .swap-success-summary { animation-delay: 60ms; font-variant-numeric: tabular-nums; font-weight: ${WEIGHT.semibold}; }
  .swap-success .hint { animation-delay: 120ms; }
`;
