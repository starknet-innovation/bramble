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
  .multisig-intent .row { flex-wrap: wrap; justify-content: flex-start; }
  .multisig-intent ol { min-width: 0; padding-left: ${SPACE.lg}; }
  .multisig-review-flow { min-width: 0; }
  .multisig-intent-list { overflow: hidden; }
  [data-ms-exact-identity] .receipt-row { align-items: flex-start; }
  [data-ms-exact-identity] .receipt-row dd { max-width: 70%; }
  [data-ms-exact-identity] .receipt-row dd code { overflow-wrap: anywhere; text-align: left; word-break: break-word; }
  .shared-collectible-card { cursor: default; }
  .drawer-multisig .account-groups-line {
    color: var(--mc-muted);
    font-size: ${TYPE.micro.size};
  }
`;
