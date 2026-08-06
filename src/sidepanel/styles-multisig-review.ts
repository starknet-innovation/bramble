/** Multisig review-sheet and confirmation-choice styles. */
import { MOTION, RADIUS, SPACE, TYPE, WEIGHT } from "../ui/tokens";

/**
 * Review styles split from the main multisig surface to keep both modules bounded.
 */
export const MULTISIG_REVIEW_STYLES = `
  .multisig-review-sheet {
    align-items: center;
    background: color-mix(in srgb, var(--mc-bg) 72%, transparent);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: ${SPACE.lg};
    position: fixed;
    z-index: 80;
  }
  .multisig-review-card {
    background: var(--mc-bg);
    border-radius: ${RADIUS.xl};
    box-shadow: var(--mc-elev-lg);
    display: grid;
    gap: ${SPACE.md};
    max-height: calc(100dvh - ${SPACE.xl});
    overflow: auto;
    padding: ${SPACE.lg};
    width: min(100%, 360px);
  }
  .multisig-review-card h2 { font-size: ${TYPE.title.size}; }
  .multisig-confirm-card {
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    width: min(100%, 380px);
  }
  .multisig-confirm-head,
  .multisig-confirm-head > div { min-width: 0; }
  .multisig-confirm-scroll {
    display: grid;
    gap: ${SPACE.md};
    grid-auto-rows: max-content;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding-inline: 1px;
  }
  .proposal-confirm-summary {
    background: var(--mc-soft);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: 1px;
    overflow: hidden;
  }
  .proposal-confirm-summary > div {
    align-items: start;
    background: var(--mc-panel);
    display: grid;
    gap: ${SPACE.xs};
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .proposal-confirm-summary span {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .proposal-confirm-summary strong {
    align-items: center;
    display: inline-flex;
    font-size: ${TYPE.label.size};
    gap: ${SPACE.xs};
    justify-content: flex-end;
    overflow-wrap: anywhere;
    text-align: right;
  }
  .proposal-confirm-summary .network-inline-mark {
    display: inline-flex;
    flex: 0 0 auto;
  }
  .proposal-confirm-summary .network-inline-mark .token-logo {
    height: 18px;
    width: 18px;
  }
  .proposal-confirm-effect { padding-block: ${SPACE.md}; }
  .multisig-confirm-modes { display: grid; gap: ${SPACE.xs}; }
  .multisig-confirm-mode {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    font: inherit;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
    text-align: left;
    transition: background ${MOTION.pressMs}ms ${MOTION.ease};
  }
  .multisig-confirm-mode > span { display: grid; gap: 2px; min-width: 0; }
  .multisig-confirm-mode strong { font-size: ${TYPE.label.size}; }
  .multisig-confirm-mode small {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .multisig-confirm-mode > .icon { color: var(--mc-positive); opacity: 0; }
  .multisig-confirm-mode[aria-pressed="true"] {
    background: var(--mc-soft-press);
  }
  .multisig-confirm-mode[aria-pressed="true"] > .icon { opacity: 1; }
  @media (hover: hover) and (pointer: fine) {
    .multisig-confirm-mode:hover { background: var(--mc-hover); color: var(--mc-text); }
  }
  .multisig-confirm-fieldset {
    border: 0;
    display: grid;
    gap: ${SPACE.sm};
    margin: 0;
    min-width: 0;
    padding: 0;
  }
  .multisig-confirm-fieldset legend {
    font-size: ${TYPE.label.size};
    font-weight: ${WEIGHT.semibold};
    padding: 0;
  }
  .multisig-confirm-signers {
    display: grid;
    gap: ${SPACE.xs};
    max-height: 184px;
    overflow: auto;
  }
  .multisig-confirm-signer {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: ${RADIUS.lg};
    color: var(--mc-text);
    display: grid;
    font: inherit;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: ${SPACE.sm};
    text-align: left;
    transition:
      background ${MOTION.pressMs}ms ${MOTION.ease},
      color ${MOTION.pressMs}ms ${MOTION.ease};
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    .multisig-confirm-signer:hover { background: var(--mc-hover); color: var(--mc-text); }
  }
  .multisig-confirm-signer:active { background: var(--mc-soft-press); }
  .multisig-confirm-signer[aria-pressed="true"] { background: var(--mc-soft); }
  .multisig-confirm-signer .multisig-signer-check { opacity: 0; }
  .multisig-confirm-signer[aria-pressed="true"] .multisig-signer-check { opacity: 1; }
  .multisig-confirm-actions {
    background: var(--mc-bg);
    border-top: 1px solid var(--mc-hairline);
    display: grid;
    gap: ${SPACE.sm};
    margin-inline: -${SPACE.lg};
    padding: ${SPACE.md} ${SPACE.lg} 0;
  }
  .multisig-confirm-actions [data-ms-confirm-submit],
  .multisig-confirm-retry { width: 100%; }
  .multisig-confirm-fee {
    align-items: center;
    display: flex;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.sm};
    justify-content: space-between;
  }
  .multisig-confirm-fee span { color: var(--mc-muted); }
  .multisig-confirm-fee strong { font-variant-numeric: tabular-nums; text-align: right; }
  .multisig-confirm-card [data-ms-confirm-status]:empty { display: none; }
  .multisig-confirm-card [data-ms-confirm-status] {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    margin: 0;
  }
  .multisig-review-qr {
    background: var(--mc-text);
    border-radius: ${RADIUS.lg};
    color: var(--mc-bg);
    justify-self: center;
    padding: ${SPACE.md};
    width: 156px;
  }
  @media (max-height: 640px) {
    .multisig-review-sheet { padding: ${SPACE.sm}; }
    .multisig-confirm-card {
      max-height: calc(100dvh - ${SPACE.md});
      padding: ${SPACE.md};
    }
    .multisig-confirm-actions {
      margin-inline: -${SPACE.md};
      padding-inline: ${SPACE.md};
    }
  }
`;
