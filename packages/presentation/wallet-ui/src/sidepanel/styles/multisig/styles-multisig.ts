/** Argent multisig portfolio styles. */
import { SPACE, TYPE } from "@mc-wallet/ui-kit/tokens";

/**
 * Stylesheet fragment for current Argent multisig surfaces.
 */
export const MULTISIG_STYLES = `
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
