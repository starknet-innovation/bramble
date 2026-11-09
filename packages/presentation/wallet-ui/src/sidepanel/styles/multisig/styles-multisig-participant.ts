/** Multisig participant selection and public-key sharing styles. */
import { CONTROL, EASE, MOTION, RADIUS, SIZE, SPACE, TYPE } from "@bramble/ui-kit/tokens";

/**
 * Token-only styles for the participant sub-flow and public-key copy action.
 */
export const MULTISIG_PARTICIPANT_STYLES = `
  [data-participant-origin] { display: grid; gap: ${SPACE.lg}; min-width: 0; }
  .multisig-signer-set > [data-open-participant-picker] {
    background: transparent;
    border-radius: 0;
    border-top: 1px solid var(--bramble-hairline);
    color: var(--bramble-text);
    justify-content: flex-start;
    min-height: ${SIZE.control};
    width: 100%;
  }
  .multisig-participant-screen:not([hidden]) {
    display: grid;
    gap: ${SPACE.xl};
    min-width: 0;
    transform: translateX(0);
    transition: transform ${MOTION.enterMs}ms ${EASE.out};
  }
  @starting-style {
    .multisig-participant-screen:not([hidden]) { transform: translateX(${SPACE.sm}); }
  }
  .multisig-participant-head {
    align-items: start;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: auto minmax(0, 1fr);
  }
  .multisig-participant-head h2 { font-size: ${TYPE.display.size}; margin: 0 0 ${SPACE.xs}; }
  .multisig-participant-head p { color: var(--bramble-muted); margin: 0; }
  .multisig-participant-external { display: grid; gap: ${SPACE.md}; min-width: 0; }
  .multisig-participant-external h3 { font-size: ${TYPE.body.size}; margin: 0; }
  .multisig-participant-known .disclosure-body { display: grid; gap: ${SPACE.sm}; }
  .multisig-participant-option .option-copy strong,
  .multisig-participant-option .option-copy code,
  .multisig-participant-option .option-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-participant-methods { display: grid; gap: ${SPACE.sm}; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .multisig-participant-methods button {
    align-content: center;
    background: var(--bramble-panel);
    border-radius: ${RADIUS.lg};
    color: var(--bramble-text);
    display: grid;
    gap: ${SPACE.xs};
    justify-items: center;
    min-height: calc(${SIZE.row} + ${SPACE.xl});
    min-width: 0;
    padding: ${SPACE.md};
    text-align: center;
  }
  .multisig-participant-methods button > span {
    align-items: center;
    color: var(--bramble-muted);
    display: flex;
    height: ${CONTROL.icon};
  }
  .multisig-participant-methods button strong { font-size: ${TYPE.label.size}; text-wrap: nowrap; }
  .multisig-participant-methods button small {
    color: var(--bramble-muted);
    font-size: ${TYPE.micro.size};
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-participant-methods button[aria-pressed="true"] {
    background: var(--bramble-soft-press);
  }
  .multisig-participant-methods button[aria-pressed="true"] > span { color: var(--bramble-text); }
  @media (max-width: 390px) {
    .multisig-participant-methods button { padding-inline: ${SPACE.xs}; }
  }
  .multisig-participant-external > [data-participant-field] { display: grid; gap: ${SPACE.xs}; }
  .multisig-participant-external > [data-participant-field] > label { display: grid; gap: ${SPACE.xs}; }
  [data-participant-result]:empty { display: none; }
  .multisig-participant-selection {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-height: ${SIZE.row};
    min-width: 0;
  }
  .multisig-participant-selection .option-copy strong,
  .multisig-participant-selection .option-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .multisig-participant-screen:not([hidden]) { transition: none; }
  }
`;
