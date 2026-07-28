/**
 * Multisig portfolio, proposal, deployment, and independent-review styles.
 * The common proposal path deliberately reuses Send component classes.
 */
import { RADIUS, SPACE, TYPE } from "../ui/tokens";

/**
 * Multisig stylesheet fragment consumed after Send composition styles.
 */
export const MULTISIG_STYLES = `
  .multisig-portfolio-hero {
    padding-top: ${SPACE.md};
  }
  .multisig-primary-actions { padding-block: ${SPACE.xs}; }
  .multisig-primary-actions .action-row { width: 100%; }
  .home-tab-count {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    font-variant-numeric: tabular-nums;
    margin-left: ${SPACE.xs};
  }
  .multisig-portfolio-tabs { min-width: 0; }
  .multisig-portfolio-tabs .tab-set { gap: ${SPACE.lg}; }
  .multisig-portfolio-tabs [data-ms-home-panel] { min-width: 0; }
  .shared-collectible-card { cursor: default; }

  .proposal-flow { min-width: 0; }
  .proposal-compose-form { display: grid; gap: ${SPACE.md}; min-width: 0; }
  .proposal-stage {
    align-content: start;
    display: grid;
    gap: ${SPACE.md};
    min-width: 0;
  }
  .proposal-stage-heading { display: grid; gap: ${SPACE.xs}; }
  .proposal-stage-heading h2 {
    font-size: ${TYPE.headline.size};
    letter-spacing: -0.02em;
    line-height: ${TYPE.headline.line};
  }
  .proposal-stage-heading > p:last-child {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
    margin: 0;
  }
  .proposal-flow .send-recipient-list { max-height: 220px; overflow: auto; }
  .proposal-flow .send-asset-list { max-height: 330px; overflow: auto; }
  .proposal-advanced-entry {
    align-items: center;
    background: transparent;
    color: var(--mc-muted);
    display: inline-flex;
    font: inherit;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
    justify-self: center;
    min-height: 36px;
    padding: 0 ${SPACE.sm};
  }
  @media (hover: hover) and (pointer: fine) {
    .proposal-advanced-entry:hover { color: var(--mc-text); }
  }
  .proposal-inline-back {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--mc-muted);
    display: inline-flex;
    font: inherit;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
    justify-self: start;
    min-height: 32px;
    padding: 0;
  }
  .proposal-inline-back .icon { height: 15px; width: 15px; }
  .proposal-options .disclosure-body { display: grid; gap: ${SPACE.md}; }
  #proposal-review-button,
  #proposal-advanced-review,
  #proposal-submit { width: 100%; }
  #multisig-propose-result:empty { display: none; }
  #multisig-propose-result:not(:empty) {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    margin: 0;
  }
  .proposal-fieldset {
    border: 0;
    display: grid;
    gap: ${SPACE.md};
    margin: 0;
    min-width: 0;
    padding: 0;
  }

  .proposal-row { align-items: stretch; display: block; padding: ${SPACE.lg}; }
  .proposal-copy { display: grid; gap: ${SPACE.sm}; min-width: 0; width: 100%; }
  .proposal-head {
    align-items: start;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .proposal-title { display: grid; gap: 2px; min-width: 0; }
  .proposal-title strong {
    font-size: ${TYPE.body.size};
    line-height: ${TYPE.body.line};
    overflow-wrap: anywhere;
  }
  .proposal-id {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .proposal-effect {
    align-items: center;
    display: grid;
    gap: ${SPACE.md};
    grid-template-columns: auto minmax(0, 1fr);
    padding: ${SPACE.md} 0 ${SPACE.xs};
    position: relative;
  }
  .proposal-effect::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto;
    position: absolute;
  }
  .proposal-effect > div { display: grid; gap: 2px; min-width: 0; }
  .proposal-effect strong {
    font-size: ${TYPE.body.size};
    line-height: ${TYPE.body.line};
    overflow-wrap: anywhere;
  }
  .proposal-effect span:not(.proposal-effect-mark) {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .proposal-effect-mark {
    align-items: center;
    background: var(--mc-soft);
    border-radius: ${RADIUS.full};
    display: inline-flex;
    height: 38px;
    justify-content: center;
    width: 38px;
  }
  .proposal-review-links {
    align-items: center;
    display: grid;
    gap: ${SPACE.xs};
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .proposal-review-links .proposal-disclosure { margin-top: 0; }
  .proposal-review-links > .btn { min-width: 0; padding-inline: ${SPACE.sm}; }
  .proposal-review-links > .review-panel { grid-column: 1 / -1; }
  .proposal-disclosure { margin-top: ${SPACE.xs}; min-width: 0; }
  .proposal-disclosure .disclosure-body {
    display: grid;
    font-size: ${TYPE.caption.size};
    gap: ${SPACE.xs};
  }
  .proposal-disclosure code { overflow-wrap: anywhere; }
  .proposal-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
    margin-top: ${SPACE.xs};
    min-width: 0;
  }
  .proposal-actions .btn { min-width: 0; width: 100%; }
  .proposal-action-hint { grid-column: 1 / -1; }

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
  .multisig-review-qr {
    background: var(--mc-text);
    border-radius: ${RADIUS.lg};
    color: var(--mc-bg);
    justify-self: center;
    padding: ${SPACE.md};
    width: 156px;
  }

  .multisig-deploy-stage { display: grid; gap: ${SPACE.lg}; }
  .multisig-signer-list {
    display: grid;
    gap: ${SPACE.xs};
    max-height: 150px;
    overflow: auto;
  }
  .multisig-signer-option {
    align-items: center;
    appearance: none;
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
    width: 100%;
  }
  @media (hover: hover) and (pointer: fine) {
    .multisig-signer-option:hover { background: var(--mc-soft); }
  }
  .multisig-signer-check { color: var(--mc-positive); opacity: 0; }
  .multisig-signer-option[aria-pressed="true"] { background: var(--mc-soft); }
  .multisig-signer-option[aria-pressed="true"] .multisig-signer-check { opacity: 1; }
  .multisig-signer-option .send-recipient-copy strong {
    align-items: center;
    display: flex;
    gap: ${SPACE.xs};
  }
  .multisig-signer-option .send-recipient-copy span {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .multisig-custom-signer {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .multisig-selected-summary {
    background: var(--mc-soft);
    border-radius: ${RADIUS.lg};
    display: grid;
    gap: 1px;
    overflow: hidden;
  }
  .multisig-selected-summary > div {
    align-items: center;
    background: var(--mc-panel);
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .multisig-selected-summary code {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
  }
  .drawer-shared {
    border-top: 1px solid var(--mc-border);
    display: grid;
    gap: ${SPACE.sm};
    margin-top: ${SPACE.md};
    padding-top: ${SPACE.md};
  }
  .drawer-multisig .account-groups-line {
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
  }
`;
