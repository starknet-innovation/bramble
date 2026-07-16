/**
 * Swap-screen layer of the side panel stylesheet: the Sell/Buy panel pair
 * around the flip control, the display-grade amount field, token chips, the
 * rate/fee meta line, the inline token picker, and the confirm/receipt
 * stages. Follows the de-bordered language — grouped panel fills, no rings —
 * and every colour rides the skin tokens. Composed after the structure layer
 * in ./styles.ts.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

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
  input.swap-amount:focus-visible { background: transparent; outline: none; }
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
  button.swap-flip:not(:disabled):active { transform: translate(-50%, -50%) scale(0.92); }
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
  .swap-actions { display: grid; gap: ${SPACE.sm}; }
  /* Submitted receipt: success is stated once, in the semantic green. */
  .swap-done { justify-items: center; padding-top: ${SPACE.xl}; text-align: center; }
  .swap-done .receipt, .swap-done .swap-actions { justify-items: stretch; text-align: left; width: 100%; }
  .swap-done-mark {
    align-items: center;
    background: var(--mc-positive-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-positive);
    display: inline-flex;
    height: 56px;
    justify-content: center;
    width: 56px;
  }
  .swap-done-mark .icon { height: 26px; width: 26px; }
`;
