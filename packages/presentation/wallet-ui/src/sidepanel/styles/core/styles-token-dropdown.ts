/**
 * The shared token dropdown: one anchored panel of tickers, used by Send and
 * Swap. Follows the Clean Mono skin — a panel surface with a hairline edge and
 * per-side strokes only, no rings — and carries no colour of its own.
 */
import { CONTROL, RADIUS, SHADOW, SPACE, TYPE, WEIGHT } from "@bramble/ui-kit/tokens";

/**
 * Token dropdown stylesheet fragment, injected with the core layers.
 */
export const TOKEN_DROPDOWN_STYLES = `
  .token-dropdown { position: relative; }
  .token-dropdown-panel {
    background: var(--bramble-panel);
    border-radius: ${RADIUS.md};
    box-shadow: ${SHADOW.md};
    display: grid;
    gap: ${SPACE.xs};
    inset-inline-start: 0;
    margin-block-start: ${SPACE.xs};
    max-height: 15rem;
    /* Never wider than the panel it sits in: a dropdown that overflows the
       side panel widens the document, and the whole screen slides to make
       room for it. */
    max-width: calc(100vw - ${SPACE.lg} * 2);
    min-width: 11rem;
    overflow-y: auto;
    padding: ${SPACE.xs};
    position: absolute;
    scrollbar-gutter: stable;
    top: 100%;
    z-index: 20;
  }
  /* A trigger sitting at the right of its row hangs its panel from that edge
     instead, so the panel opens inward. */
  .token-dropdown[data-align="end"] .token-dropdown-panel {
    inset-inline-end: 0;
    inset-inline-start: auto;
  }
  .token-dropdown-panel[hidden] { display: none; }
  .token-dropdown-group { display: grid; gap: 1px; }
  .token-dropdown-label {
    margin: 0;
    padding: ${SPACE.xs} ${SPACE.xs} 0;
  }
  /* A plain button inherits the primary accent fill and ITS text colour; the
     row is a neutral surface, so both are restored here or the ticker reads as
     accent text on the panel. */
  .token-dropdown-option {
    align-items: center;
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--bramble-text);
    display: flex;
    gap: ${SPACE.xs};
    justify-content: flex-start;
    min-height: ${CONTROL.hit};
    padding: 0 ${SPACE.xs};
    text-align: start;
    width: 100%;
  }
  /* The glyph is a 40px chip by default, sized for list rows; in a dropdown of
     tickers it only has to identify the token. */
  .token-dropdown-option .token-mark, .token-dropdown-option .token-logo {
    height: 20px;
    width: 20px;
  }
  .token-dropdown-option .token-mark { font-size: 8px; }
  .token-dropdown-option strong {
    font-size: ${TYPE.body.size};
    font-weight: ${WEIGHT.medium};
  }
  .token-dropdown-option[aria-selected="true"] { background: var(--bramble-hover); }
  @media (hover: hover) and (pointer: fine) {
    .token-dropdown-option:not(:disabled):hover { background: var(--bramble-hover); }
  }
  .token-dropdown-option:not(:disabled):active { background: var(--bramble-hover); }
  .token-dropdown-options { display: grid; gap: 1px; }
  .token-dropdown-search {
    background: var(--bramble-sunken);
    border: 0;
    border-radius: ${RADIUS.sm};
    color: var(--bramble-text);
    font: inherit;
    font-size: ${TYPE.caption.size};
    margin: ${SPACE.xs} 0;
    min-height: 32px;
    padding: 0 ${SPACE.xs};
    width: 100%;
  }
  .token-dropdown-search::placeholder { color: var(--bramble-muted); }
  /* The way out of the dropdown: a token it does not list is added on the
     tokens screen, so the list ends by naming that instead of dead-ending. */
  .token-dropdown-action {
    background: transparent;
    border-radius: ${RADIUS.sm};
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    font-weight: ${WEIGHT.medium};
    justify-content: flex-start;
    margin-block-start: ${SPACE.xs};
    min-height: 34px;
    padding: 0 ${SPACE.xs};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    .token-dropdown-action:not(:disabled):hover {
      background: var(--bramble-hover);
      color: var(--bramble-text);
    }
  }
  .token-dropdown-empty {
    color: var(--bramble-muted);
    font-size: ${TYPE.caption.size};
    margin: 0;
    padding: ${SPACE.xs};
  }
`;
