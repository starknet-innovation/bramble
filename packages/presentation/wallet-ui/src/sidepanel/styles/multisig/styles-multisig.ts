/** Argent multisig portfolio styles. */
import { RADIUS, SIZE, SPACE, TYPE } from "@mc-wallet/ui-kit/tokens";

/**
 * Stylesheet fragment for current Argent multisig surfaces.
 */
export const MULTISIG_STYLES = `
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) {
    align-items: start;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    row-gap: ${SPACE.sm};
  }
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) > .icon-button {
    grid-row: 1 / span 2;
  }
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) > .flow-title,
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) > .pill {
    grid-column: 2;
  }
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) > .pill { justify-self: start; }
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) .flow-title h1,
  .flow-header:has(+ [id^="wallet-screen-multisig-"]) .flow-title p {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-setup-options { display: grid; gap: ${SPACE.md}; }
  .multisig-setup-option .add-account-option-copy strong,
  .multisig-setup-option .add-account-option-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-deploy-section,
  #multisig-deploy-form,
  #multisig-deploy-form > label { min-width: 0; }
  .multisig-signer-set {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    min-width: 0;
    overflow: hidden;
  }
  .multisig-signer-set-head {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
    min-height: ${SIZE.control};
    padding: ${SPACE.sm} ${SPACE.lg};
  }
  .multisig-signer-set-head strong { font-size: ${TYPE.body.size}; }
  .multisig-selected-signers { display: grid; min-width: 0; }
  .multisig-selected-signer {
    align-items: center;
    display: flex;
    gap: ${SPACE.sm};
    min-height: ${SIZE.row};
    padding: ${SPACE.sm} ${SPACE.sm} ${SPACE.sm} ${SPACE.lg};
    position: relative;
  }
  .multisig-selected-signer:not([hidden]) ~ .multisig-selected-signer:not([hidden])::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto ${SPACE.lg};
    position: absolute;
  }
  .multisig-selected-signer .option-copy strong,
  .multisig-selected-signer .option-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-selected-signer .icon-button:disabled { opacity: 0; pointer-events: none; }
  .multisig-signer-set > .multisig-signer-sources {
    background: transparent;
    border-radius: 0;
    border-top: 1px solid var(--mc-hairline);
  }
  .multisig-deployment-signer-field { display: grid; gap: 6px; min-width: 0; }
  .multisig-deployment-signer .option-name {
    align-items: center;
    display: flex;
    min-width: 0;
  }
  .multisig-deployment-signer[aria-pressed="false"] .option-mark { opacity: 0; }
  .multisig-signer-sources .disclosure-body { display: grid; gap: ${SPACE.md}; }
  .multisig-manual-signer {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .multisig-manual-signer button { min-height: ${SIZE.control}; text-wrap: nowrap; }
  .multisig-manual-signer-result:empty { display: none; }
  .multisig-key-source { min-height: 68px; padding-block: ${SPACE.sm}; }
  .multisig-key-source .option-copy { gap: 2px; }
  .multisig-key-source .option-copy strong,
  .multisig-key-source .option-copy code,
  .multisig-key-source .option-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-portfolio-hero { padding-top: ${SPACE.md}; }
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
  .multisig-intent { align-items: stretch; display: grid; gap: ${SPACE.md}; min-width: 0; overflow: hidden; }
  .multisig-intent .decision-head .pill { margin-left: auto; }
  .multisig-intent .decision-head h2, .multisig-intent code { overflow-wrap: anywhere; }
  .multisig-intent-action { display: grid; gap: ${SPACE.sm}; }
  .multisig-intent-action > button { width: 100%; }
  .multisig-action-note {
    color: var(--mc-muted);
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .multisig-collaboration { margin-top: ${SPACE.xs}; }
  .multisig-collaboration .disclosure-body { display: grid; gap: ${SPACE.md}; }
  .multisig-collaboration-actions {
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .multisig-collaboration-actions > :only-child { grid-column: 1 / -1; }
  .multisig-collaboration-actions button { min-width: 0; width: 100%; }
  .multisig-intent ol { min-width: 0; padding-left: ${SPACE.lg}; }
  .multisig-review-flow { min-width: 0; }
  .multisig-intent-list { overflow: hidden; }
  .multisig-intent-row { position: relative; }
  .multisig-intent-row.has-assets .menu-icon { visibility: hidden; }
  .multisig-intent-assets { display: inline-flex; inset-inline-start: calc(${SPACE.lg} - 4px); pointer-events: none; position: absolute; top: 50%; transform: translateY(-50%); }
  .multisig-intent-assets > * + * { margin-left: -6px; }
  .multisig-intent-assets .token-logo, .multisig-intent-assets .token-mark { height: 28px; width: 28px; }
  .multisig-intent-assets .token-mark { font-size: 8px; }
  [data-ms-exact-identity] .receipt-row { align-items: flex-start; }
  [data-ms-exact-identity] .receipt-row dd { max-width: 70%; }
  [data-ms-exact-identity] .receipt-row dd code { overflow-wrap: anywhere; text-align: left; word-break: break-word; }
  .shared-collectible-card { cursor: default; }
  .drawer-multisig .account-groups-line {
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
  }
`;
