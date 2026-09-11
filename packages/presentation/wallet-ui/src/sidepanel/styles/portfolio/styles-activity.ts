/**
 * Activity feed stylesheet fragment: the de-boxed transaction rows (state on
 * the glyph, summary as the explorer link, a muted meta line with the UTC time
 * and status) grouped under one small heading per day. Split from the
 * component layer so the feed's rules live with the portfolio journey that
 * renders them.
 */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Activity feed stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const ACTIVITY_STYLES = `
  /* Activity list: same de-boxed treatment as the token list — flush rows split
     by a single hairline divider, state on the glyph, summary as the explorer link. */
  .tx-list { display: grid; }
  .tx-row {
    align-items: center; border-radius: ${RADIUS.sm}; display: flex; gap: ${SPACE.sm};
    min-width: 0; padding: ${SPACE.md} ${SPACE.sm}; position: relative; transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .tx-list > .tx-row + .tx-row::before { background: var(--bramble-hairline); content: ""; height: 1px; inset: 0 0 auto; position: absolute; } /* flat pseudo-line divider; see .token-row */
  @media (hover: hover) and (pointer: fine) {
    li.tx-row:hover { background: var(--bramble-hover); }
  }
  .tx-copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .tx-copy strong, .tx-summary-link {
    color: var(--bramble-text);
    display: block;
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.bold};
    overflow: hidden;
    text-decoration: none;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .tx-summary-link:hover { text-decoration: underline; text-underline-offset: 3px; }
  .tx-meta { color: var(--bramble-muted); font-size: ${TYPE.caption.size}; font-variant-numeric: tabular-nums; }
  /* One heading per UTC day; the first sits flush with the section, later
     days take a little air so the date reads as a break, not a row. */
  .tx-day { display: grid; gap: ${SPACE.xs}; }
  .tx-day + .tx-day { margin-top: ${SPACE.md}; }
  .tx-day-label { margin: 0; padding: 0 ${SPACE.sm}; }
`;
