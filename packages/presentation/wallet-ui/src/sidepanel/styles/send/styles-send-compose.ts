/**
 * Recipient-first Send composition, review disclosure, and terminal outcome
 * styles. This layer follows the Clean Mono skin and reserves semantic colour
 * for confirmed success and explicit failure.
 */
import {
  CONTROL,
  MOTION,
  RADIUS,
  SIZE,
  SPACE,
  TRACKING,
  TYPE,
  WEIGHT,
} from "@bramble/ui-kit/tokens";

/**
 * Send composition stylesheet fragment consumed after the shared Send layer.
 */
export const SEND_COMPOSE_STYLES = `
  .sr-only {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    text-wrap: nowrap;
    width: 1px;
  }
  .send-flow-header .flow-title { text-align: center; }
  .send-flow-header .flow-title h1 {
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.bold};
    letter-spacing: -0.02em;
  }
  .send-flow .section { min-width: 0; }
  .send-flow form { gap: ${SPACE.md}; }
  .send-stage { align-content: start; }
  .send-stage-kicker {
    color: var(--bramble-muted);
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
    margin: 0;
  }

  .send-origin-context { display: grid; gap: ${SPACE.sm}; }
  .send-origin-account {
    align-items: center;
    background: var(--bramble-elevated);
    border-radius: ${RADIUS.md};
    display: flex;
    min-height: ${SIZE.control};
    padding-left: ${SPACE.md};
  }
  .send-asset-copy span,
  .send-recipient-copy code,
  .send-asset-value span {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
  }
  .send-origin-context strong { font-size: ${TYPE.body.size}; }
  .network-inline-value {
    align-items: center;
    display: inline-flex;
    gap: ${SPACE.sm};
  }
  .network-inline-mark {
    display: inline-flex;
    flex: none;
    height: ${SPACE.xl};
    width: ${SPACE.xl};
  }
  .network-inline-mark .token-logo {
    height: 100%;
    width: 100%;
  }

  .send-search { gap: ${SPACE.sm}; }
  /* Both stage headings share one explicit weight: the paragraph would
     otherwise inherit body weight while the label's span inherits the
     semibold label rule, and the pair read as two different headings. */
  .send-section-title,
  .send-search > span:first-child:not(.sr-only) {
    color: var(--bramble-text);
    font-size: ${TYPE.title.size};
    font-weight: ${WEIGHT.semibold};
    letter-spacing: ${TRACKING.title};
    line-height: ${TYPE.title.line};
    margin: 0;
  }
  /* The search box is one field made of an icon and an input, so the box, not
     the input, carries the field's radius and its bottom edge. Left on the
     input, the edge stopped short of the icon and curled up at the input's
     own corner, reading as a broken underline. */
  .send-search-control {
    align-items: center;
    background: var(--bramble-elevated);
    border-bottom: 1px solid var(--bramble-border);
    border-radius: ${RADIUS.md};
    display: flex;
    gap: ${SPACE.sm};
    min-height: ${SIZE.control};
    overflow: hidden;
    padding-left: ${SPACE.md};
  }
  .send-search-control > .icon { color: var(--bramble-muted); flex: none; }
  .send-search-control input {
    align-self: stretch;
    background: transparent;
    border-bottom: 0;
    border-radius: 0;
    min-height: 0;
    padding-left: 0;
  }
  .send-search-control input:focus-visible { outline: 0; }
  .send-search-control:has(input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--bramble-focus-ring);
  }
  /* The icon and the input are one control: hover tints the whole box, never
     just the input's share of it. The bare amount field sits inside a card
     rather than a box of its own, so it takes no hover fill at all. */
  .send-search-control { transition: background ${MOTION.pressMs}ms ${MOTION.ease}; }
  @media (hover: hover) and (pointer: fine) {
    .send-search-control:has(input:not(:disabled):hover) { background: var(--bramble-hover); }
    .send-search-control input:not(:disabled):hover,
    .send-amount-field input:not(:disabled):hover { background: transparent; }
  }
  .send-recipient-list, .send-asset-list { display: grid; gap: ${SPACE.sm}; }
  .send-list-heading {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
  }
  .send-list-heading > .icon { height: ${CONTROL.icon}; width: ${CONTROL.icon}; }
  .send-list-heading > strong:first-of-type { color: var(--bramble-text); margin-right: auto; }
  /* Recipient folders: the same grouping the account drawer shows, so an
     account is found under the folder the user filed it into. */
  .send-recipient-folder { display: grid; gap: ${SPACE.sm}; }
  button.send-folder-head {
    background: transparent;
    padding: 0;
    text-align: start;
    width: 100%;
  }
  .send-folder-count {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    font-variant-numeric: tabular-nums;
  }
  /* The mark is chevronRight. An open folder rotates it to point down, the
     same way a disclosure mark does, so the glyph follows data-collapsed. */
  .send-folder-mark { display: inline-flex; }
  .send-folder-mark .icon { height: 14px; width: 14px; }
  .send-recipient-folder[data-collapsed="false"] .send-folder-mark { transform: rotate(90deg); }
  .send-folder-empty { margin: 0; }
  .send-recipient-row, .send-asset-row {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-text);
    display: grid;
    min-height: ${SIZE.tile};
    padding: ${SPACE.md};
    text-align: left;
  }
  @media (hover: hover) and (pointer: fine) {
    .send-recipient-row:not(:disabled):hover,
    .send-asset-row:not(:disabled):hover {
      background: var(--bramble-hover);
      color: var(--bramble-text);
    }
  }
  .send-recipient-row:not(:disabled):active,
  .send-asset-row:not(:disabled):active {
    background: var(--bramble-soft-press);
    color: var(--bramble-text);
  }
  .send-recipient-row:focus-visible,
  .send-asset-row:focus-visible {
    outline-offset: -2px;
  }
  .send-recipient-row {
    align-items: center;
    grid-template-columns: ${SIZE.mark} minmax(0, 1fr) auto;
  }
  .send-recipient-row > .icon { color: var(--bramble-muted); height: 16px; width: 16px; }
  .send-recipient-avatar {
    border-radius: ${RADIUS.full};
    height: ${SIZE.mark};
    overflow: hidden;
    width: ${SIZE.mark};
  }
  .send-recipient-avatar .avatar { height: 100%; width: 100%; }
  .send-recipient-copy { display: grid; gap: 2px; min-width: 0; padding: 0 ${SPACE.md}; }
  .send-recipient-copy strong,
  .send-recipient-copy code {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-recipient-copy small {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  #send-recipient-continue { width: 100%; }
  .send-amount-card {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: ${SPACE.md};
    padding: ${SPACE.lg};
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      box-shadow ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .send-amount-card:has(.send-amount-field input:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--bramble-focus-ring);
  }
  .send-token-trigger {
    background: var(--bramble-elevated);
    color: var(--bramble-text);
    justify-self: start;
    min-height: ${CONTROL.hit};
    padding: 0 ${SPACE.md};
  }
  @media (hover: hover) and (pointer: fine) {
    .send-token-trigger:not(:disabled):hover {
      background: var(--bramble-hover);
      color: var(--bramble-text);
    }
  }
  .send-token-trigger:not(:disabled):active {
    background: var(--bramble-soft-press);
    color: var(--bramble-text);
  }
  .send-token-trigger > span:first-child,
  .send-token-trigger > span:first-child > svg,
  .send-token-trigger .token-mark {
    height: 26px;
    width: 26px;
  }
  .send-token-trigger .icon { height: 15px; width: 15px; }
  .send-amount-field {
    align-items: center;
    display: flex;
    justify-content: flex-end;
  }
  .send-amount-field input {
    background: transparent;
    border-radius: 0;
    text-overflow: ellipsis;
    font-size: ${TYPE.amount.size};
    font-variant-numeric: tabular-nums;
    font-weight: ${WEIGHT.semibold};
    min-height: 52px;
    padding: 0;
    text-align: right;
  }
  .send-amount-field input:focus-visible {
    background: transparent;
    outline: 0;
  }
  .send-amount-prefix {
    color: var(--bramble-muted);
    font-size: ${TYPE.display.size};
    font-weight: ${WEIGHT.semibold};
  }
  .send-amount-meta {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
  }
  /* The balance line is rewritten after first paint — an asset pick, a bucket
     flip, the repaint once discovery or the recipient check settles — with
     whatever the balance carries. It must never widen the card: the label may
     shrink and, as a last resort, break inside a long figure, while the
     shortcuts keep their size and drop below it when the two no longer share a
     line. A row that could not shrink grew the whole stage past the panel. */
  .send-amount-meta > span:first-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .send-amount-shortcuts {
    align-items: center;
    display: flex;
    flex: none;
    gap: ${SPACE.xs};
    margin-left: auto;
  }
  .send-amount-shortcuts button {
    background: transparent;
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    min-height: ${CONTROL.hitSmall};
    padding: 0 ${SPACE.sm};
  }
  .send-amount-shortcuts #send-unit-toggle {
    background: var(--bramble-elevated);
    color: var(--bramble-text);
  }
  @media (hover: hover) and (pointer: fine) {
    .send-amount-shortcuts button:not(:disabled):hover {
      background: var(--bramble-hover);
      color: var(--bramble-text);
    }
  }
  .send-amount-shortcuts button:not(:disabled):active {
    background: var(--bramble-soft-press);
    color: var(--bramble-text);
  }
  .send-amount-shortcuts .icon { height: 14px; width: 14px; }
  .send-fiat-estimate {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    margin: -${SPACE.sm} 0 0;
    text-align: right;
  }
  .send-context-receipt {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    margin: 0;
    padding: 0 ${SPACE.lg};
  }
  .send-context-receipt > div,
  .send-review-facts > div {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
    min-height: ${SIZE.rowCompact};
    position: relative;
  }
  .send-context-receipt > div + div::before,
  .send-review-facts > div + div::before {
    background: var(--bramble-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .send-context-receipt dt,
  .send-review-facts dt { color: var(--bramble-muted); font-size: ${TYPE.label.size}; }
  /* An account row in the receipt: identity on the left, and for the two
     accounts, the balance that account's value moves through on the right. */
  .send-context-receipt dd:has(.send-route-toggle) {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: flex-end;
  }
  /* The identity column is repainted with the chosen account's own name; a
     long single word must clip beside its toggle, not push the receipt out. */
  .send-context-account { display: grid; justify-items: end; min-width: 0; }
  .send-context-account strong,
  .send-context-account code {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  /* The network row keeps its mark beside the name; the generic dd grid
     below would otherwise stack them. */
  .send-context-receipt dd.network-inline-value {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    justify-content: flex-end;
  }
  .send-context-receipt dd,
  .send-review-facts dd {
    display: grid;
    gap: 2px;
    justify-items: end;
    margin: 0;
    max-width: 70%;
    min-width: 0;
  }
  .send-context-receipt code,
  .send-review-facts code { color: var(--bramble-muted); font-size: ${TYPE.micro.size}; }
  /* The reviewed recipient: truncated address and its copy control on one
     line, the address clipping first so the control never leaves the fact. */
  .send-review-address { align-items: center; display: flex; gap: 2px; max-width: 100%; min-width: 0; }
  .send-review-address code { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
  #send-review-button { margin-top: auto; width: 100%; }
  /* The busy review button swaps its send glyph for the shared Liquid Dots
     mark, so a running preparation reads as work rather than as a dimmed
     control — the same treatment the working screen uses, at button scale. */
  #send-review-button .liquid-dots { display: none; }
  #send-review-button[data-busy] .liquid-dots { display: inline-flex; }
  #send-review-button[data-busy] > .icon { display: none; }

  .send-asset-stage { gap: ${SPACE.lg}; }
  .send-asset-search .send-search-control { background: var(--bramble-panel); }
  .send-asset-row {
    align-items: center;
    grid-template-columns: ${SIZE.mark} minmax(0, 1fr) auto;
  }
  .send-asset-glyph,
  .send-asset-glyph > svg,
  .send-asset-glyph .token-mark {
    height: ${SIZE.mark};
    width: ${SIZE.mark};
  }
  .send-asset-copy { display: grid; gap: 2px; min-width: 0; padding: 0 ${SPACE.md}; }
  .send-asset-copy strong,
  .send-asset-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .send-asset-spam {
    color: var(--bramble-danger);
    font-style: normal;
    font-weight: ${WEIGHT.semibold};
  }
  .send-asset-value { display: grid; gap: 2px; justify-items: end; }
  .send-asset-value strong { font-variant-numeric: tabular-nums; }
  .send-asset-change[data-direction="down"] { color: var(--bramble-danger); }
  .send-asset-change[data-direction="up"] { color: var(--bramble-positive); }

`;
