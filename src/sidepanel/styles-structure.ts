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
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

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
  .takeover-origin {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    padding: ${SPACE.sm} 0;
  }
  .takeover-origin .callout-icon { height: 40px; width: 40px; }
  .takeover-copy { display: grid; gap: 2px; min-width: 0; }
  .takeover-copy strong { font-size: ${TYPE.title.size}; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .takeover-copy p { font-size: ${TYPE.caption.size}; }
  .takeover-queue { color: var(--mc-muted); font-size: ${TYPE.caption.size}; text-align: center; }
  .takeover-foot { display: grid; gap: ${SPACE.sm}; margin-top: auto; padding-top: ${SPACE.md}; }
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
`;
