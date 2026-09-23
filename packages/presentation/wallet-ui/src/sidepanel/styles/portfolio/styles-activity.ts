/**
 * Activity feed stylesheet fragment: the design kit's transaction-row anatomy
 * — a 16px kind glyph beside the verb, the counterparty or asset pair beneath
 * it, the signed fiat delta over the asset amount on the right, and the token
 * mark trailing — grouped under one small
 * heading per day. Rows are airy rather than ruled: a 4px gap and a rounded
 * hover fill, no divider, no per-row box. Only the leading column shrinks, so
 * a long verb or counterparty ellipsises before a figure is ever cut or the
 * panel widens. A settled row is two lines; a provisional or failed one adds
 * its status word in the status hue. Split from the component layer so the
 * feed's rules live with the portfolio journey that renders them.
 */
import { MOTION, RADIUS, SIZE, SPACE, TRACKING, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

// The kit's secondary text (the glyph's tone): mixed from the two text tokens
// rather than a new one, so both skins derive it from their own ink.
const SECONDARY_TEXT = "color-mix(in srgb, var(--bramble-text) 27%, var(--bramble-muted))";
// Kit glyph: 16px box, 1.2px stroke — the registry's 1.8 at 24 scaled down.
const GLYPH_SIZE = "16px";

/**
 * Activity feed stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const ACTIVITY_STYLES = `
  /* Activity list: rows breathe on a 4px gap with no rule between them; the
     rounded hover fill is the only affordance, since the verb is a link. Row
     content sits on the page's text column — glyphs line up with the screen
     title and the day headings — and the fill bleeds one step past it, the
     same geometry as the token list on Home. */
  .tx-list { display: grid; gap: ${SPACE.xs}; }
  .tx-row {
    align-items: center; border-radius: ${RADIUS.md}; display: flex; gap: ${SPACE.sm};
    justify-content: space-between; margin: 0 -${SPACE.sm}; min-width: 0; padding: ${SPACE.sm};
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  @media (hover: hover) and (pointer: fine) {
    li.tx-row:hover { background: var(--bramble-hover); }
  }
  /* Leading column: the only flexible track. It takes the slack and gives it
     back first, so every line here ellipsises rather than pushing the figures
     or the mark out of the panel. The detail sits flush with the glyph. */
  .tx-copy { display: grid; flex: 1 1 0%; gap: ${SPACE.xs}; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  .tx-title { align-items: center; display: flex; gap: ${SPACE.xs}; min-width: 0; }
  /* The kind glyph is inline beside the verb, not a chip. Status hues are
     meaning, not decoration, and ride the semantic tokens; a settled row keeps
     the neutral secondary tone (the row rule below outranks the shared one). */
  .tx-kind-icon {
    align-items: center; color: ${SECONDARY_TEXT}; display: inline-flex; flex: none;
    height: ${GLYPH_SIZE}; justify-content: center; width: ${GLYPH_SIZE};
  }
  .tx-kind-icon .icon { height: ${GLYPH_SIZE}; width: ${GLYPH_SIZE}; }
  .tx-kind-icon.accepted { color: var(--bramble-positive); }
  .tx-kind-icon.pending { color: var(--bramble-warning); }
  .tx-kind-icon.preconfirmed { color: var(--bramble-positive); opacity: 0.68; }
  .tx-kind-icon.rejected, .tx-kind-icon.reverted { color: var(--bramble-danger); }
  .tx-row .tx-kind-icon.accepted { color: ${SECONDARY_TEXT}; }
  .tx-summary, .tx-summary-link {
    color: var(--bramble-text);
    display: block;
    font-size: ${TYPE.row.size};
    font-weight: ${WEIGHT.medium};
    line-height: ${TYPE.row.line};
    min-width: 0;
    overflow: hidden;
    text-decoration: none;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-summary-link:hover { text-decoration: underline; text-underline-offset: 3px; }
  .tx-detail {
    color: var(--bramble-muted);
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.regular};
    line-height: ${TYPE.body.line};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  /* A recorded counterparty carries its copy control on the same line; the
     truncated address is the part that clips, the control stays. */
  .tx-counterparty { align-items: center; display: flex; gap: 2px; }
  .tx-counterparty > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  /* Only a row Starknet has not settled says so, in the same hue as its glyph. */
  .tx-meta {
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    letter-spacing: ${TRACKING.caption};
    line-height: ${TYPE.caption.line};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-meta.pending { color: var(--bramble-warning); }
  .tx-meta.preconfirmed { color: var(--bramble-positive); }
  .tx-meta.rejected, .tx-meta.reverted { color: var(--bramble-danger); }
  /* Trailing figures never shrink below their content — a cut amount would
     misstate value — but they are capped so an absurd figure ellipsises inside
     its own column instead of widening the panel. */
  .tx-side {
    display: grid; flex: 0 0 auto; gap: ${SPACE.xs}; justify-items: end; max-width: 60%; min-width: 0; text-align: right;
  }
  .tx-fiat, .tx-amount {
    font-variant-numeric: tabular-nums;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-fiat { color: var(--bramble-text); font-size: ${TYPE.row.size}; font-weight: ${WEIGHT.medium}; line-height: ${TYPE.row.line}; }
  .tx-amount { color: var(--bramble-muted); font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.regular}; line-height: ${TYPE.body.line}; }
  /* An unknown figure is a quiet dash, never a bold claim. */
  .tx-side .is-unknown { color: var(--bramble-muted); font-weight: ${WEIGHT.regular}; }
  /* Token mark trails the row at the kit's 36px, reusing the shared glyph
     renderers (bundled logo or tinted letter badge; the network mark when the
     entry names no token). No network badge: every row here is on Starknet. */
  .tx-avatar { display: inline-flex; flex: none; }
  .tx-avatar > .token-logo, .tx-avatar > .token-mark { height: ${SIZE.avatar}; width: ${SIZE.avatar}; }
  /* One heading per UTC day in the kit's small medium voice, on the same text
     column as the rows' content; the list hangs 12px below it and days sit
     32px apart. */
  .tx-day { display: grid; gap: ${SPACE.md}; }
  .tx-day + .tx-day { margin-top: calc(${SPACE.lg} * 2); }
  .tx-day-label {
    color: var(--bramble-muted);
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.medium};
    line-height: ${TYPE.body.line};
    margin: 0;
  }
`;
