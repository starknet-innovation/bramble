/**
 * Activity feed stylesheet fragment: the design kit's transaction-row anatomy
 * — an inline kind glyph beside the verb, the counterparty or asset pair and
 * the status/UTC time beneath it, the signed fiat delta over the asset amount
 * on the right, and the token mark trailing — grouped under one small heading
 * per day. Rows stay de-boxed like the token list (a rounded hover fill and a
 * single hairline divider), and the leading column is the only one that
 * shrinks, so a long verb or counterparty ellipsises before a figure is ever
 * cut or the panel widens. Split from the component layer so the feed's rules
 * live with the portfolio journey that renders them.
 */
import { MOTION, RADIUS, SIZE, SPACE, TRACKING, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

// The glyph and the meta figures sit one step below the verb, matching the
// kit's secondary text: mixed from the two text tokens rather than a new one.
const SECONDARY_TEXT = "color-mix(in srgb, var(--bramble-text) 72%, var(--bramble-muted))";
// Kit glyph: 16px box, 1.2px stroke — the registry's 1.8 at 24 scaled down.
const GLYPH_SIZE = "16px";

/**
 * Activity feed stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const ACTIVITY_STYLES = `
  /* Activity list: same de-boxed treatment as the token list — flush rows split
     by a single hairline divider, a rounded hover fill, no per-row box. */
  .tx-list { display: grid; }
  .tx-row {
    align-items: center; border-radius: ${RADIUS.sm}; display: flex; gap: ${SPACE.sm};
    min-width: 0; padding: ${SPACE.sm}; position: relative; transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .tx-list > .tx-row + .tx-row::before { background: var(--bramble-hairline); content: ""; height: 1px; inset: 0 0 auto; position: absolute; } /* flat pseudo-line divider; see .token-row */
  @media (hover: hover) and (pointer: fine) {
    li.tx-row:hover { background: var(--bramble-hover); }
  }
  /* Leading column: the only flexible track. It takes the slack and gives it
     back first, so every line here ellipsises rather than pushing the figures
     or the mark out of the panel. */
  .tx-copy { display: grid; flex: 1 1 0%; gap: 2px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
  .tx-title { align-items: center; display: flex; gap: ${SPACE.xs}; min-width: 0; }
  /* The kind glyph is inline beside the verb, not a chip: the row's own colour
     rules outrank the shared chip treatment, and a settled row keeps the neutral
     secondary tone while provisional and failed states keep their status hue. */
  .tx-row .tx-kind-icon {
    background: none; border-radius: 0; color: ${SECONDARY_TEXT}; height: ${GLYPH_SIZE}; width: ${GLYPH_SIZE};
  }
  .tx-row .tx-kind-icon .icon { height: ${GLYPH_SIZE}; width: ${GLYPH_SIZE}; }
  .tx-row .tx-kind-icon.accepted { color: ${SECONDARY_TEXT}; }
  .tx-summary, .tx-summary-link {
    color: var(--bramble-text);
    display: block;
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.semibold};
    letter-spacing: ${TRACKING.label};
    line-height: ${TYPE.label.line};
    min-width: 0;
    overflow: hidden;
    text-decoration: none;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-summary-link:hover { text-decoration: underline; text-underline-offset: 3px; }
  .tx-detail, .tx-meta {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-meta { font-variant-numeric: tabular-nums; letter-spacing: ${TRACKING.caption}; }
  /* Trailing figures never shrink below their content — a cut amount would
     misstate value — but they are capped so an absurd figure ellipsises inside
     its own column instead of widening the panel. */
  .tx-side {
    display: grid; flex: 0 0 auto; gap: 2px; justify-items: end; max-width: 60%; min-width: 0; text-align: right;
  }
  .tx-fiat, .tx-amount {
    font-variant-numeric: tabular-nums;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-fiat { color: var(--bramble-text); font-size: ${TYPE.body.size}; font-weight: ${WEIGHT.bold}; letter-spacing: ${TRACKING.label}; line-height: ${TYPE.label.line}; }
  .tx-amount { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; line-height: ${TYPE.caption.line}; }
  /* An unknown figure is a quiet dash, never a bold claim. */
  .tx-side .is-unknown { color: var(--bramble-muted); font-weight: ${WEIGHT.regular}; }
  /* Token mark trails the row at the kit's 36px, reusing the shared glyph
     renderers (bundled logo or tinted letter badge; the network mark when the
     entry names no token). */
  .tx-avatar { display: inline-flex; flex: none; }
  .tx-avatar .token-logo, .tx-avatar .token-mark { height: ${SIZE.avatar}; width: ${SIZE.avatar}; }
  /* One heading per UTC day, sentence case in the muted voice, indented a hair
     past the glyph; the first sits flush with the section, later days take a
     little air so the date reads as a break, not a row. */
  .tx-day { display: grid; gap: ${SPACE.xs}; }
  .tx-day + .tx-day { margin-top: ${SPACE.md}; }
  .tx-day-label {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    letter-spacing: ${TRACKING.caption};
    line-height: ${TYPE.caption.line};
    margin: 0;
    padding: 0 ${SPACE.md};
  }
`;
