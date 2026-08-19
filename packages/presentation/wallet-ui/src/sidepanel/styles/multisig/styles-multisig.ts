/** Argent multisig portfolio styles. */
import { EASE, MOTION, RADIUS, SIZE, SPACE, TYPE } from "@mc-wallet/ui-kit/tokens";

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
  #multisig-deploy-form > label,
  #multisig-deploy-review,
  #multisig-deploy-review > * { min-width: 0; }
  .multisig-deploy-progress {
    align-items: start;
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .multisig-deploy-progress li {
    align-items: center;
    color: var(--mc-muted);
    display: grid;
    font-size: ${TYPE.micro.size};
    gap: 4px;
    justify-items: center;
    position: relative;
    text-align: center;
  }
  .multisig-deploy-progress li::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    left: calc(-50% + 12px);
    position: absolute;
    right: calc(50% + 12px);
    top: 11px;
  }
  .multisig-deploy-progress li:first-child::before { display: none; }
  .multisig-deploy-progress li > span {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    display: flex;
    font-variant-numeric: tabular-nums;
    height: 22px;
    justify-content: center;
    position: relative;
    width: 22px;
  }
  .multisig-deploy-progress li[data-state="active"] { color: var(--mc-text); }
  .multisig-deploy-progress li[data-state="active"] > span {
    background: var(--mc-accent);
    color: var(--mc-accent-text);
  }
  .multisig-deploy-progress li[data-state="complete"] > span {
    background: var(--mc-positive-soft);
    color: var(--mc-positive);
  }
  .multisig-deploy-advanced .disclosure-body { display: grid; gap: ${SPACE.md}; }
  .multisig-deploy-stage-frame {
    display: grid;
    gap: ${SPACE.md};
    min-width: 0;
    overflow: clip;
    view-transition-name: multisig-deploy-stage;
  }
  .multisig-deploy-setup { display: grid; gap: ${SPACE.md}; min-width: 0; }
  .multisig-deploy-step-pane { display: grid; gap: ${SPACE.md}; min-width: 0; }
  #multisig-deploy-form[data-deployment-stage="setup"] .multisig-deploy-approval-step,
  #multisig-deploy-form[data-deployment-stage="approval"] .multisig-deploy-signers-step,
  #multisig-deploy-form:not([data-deployment-stage="setup"]):not([data-deployment-stage="approval"]) .multisig-deploy-stage-frame > .multisig-deploy-setup {
    display: none;
  }
  .multisig-deploy-actions {
    display: grid;
    gap: ${SPACE.sm};
  }
  .multisig-deploy-actions > button { min-width: 0; width: 100%; }
  #multisig-deploy-form[data-deployment-stage="setup"] .multisig-deploy-stage-frame > .multisig-deploy-actions,
  #multisig-deploy-form[data-deployment-stage="fund"] .multisig-deploy-stage-frame > .multisig-deploy-actions { display: none; }
  #multisig-deploy-form:not([data-deployment-stage="approval"]) [data-multisig-deploy-back] { display: none; }
  #multisig-deploy-form[data-deployment-stage="approval"] .multisig-deploy-stage-frame > .multisig-deploy-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  #multisig-deploy-form[data-deployment-stage="address"] #multisig-deploy-review:empty::after {
    color: var(--mc-muted);
    content: "Calculating the address and deployment fee…";
    display: block;
    padding-block: ${SPACE.xl};
    text-align: center;
  }
  #multisig-deploy-review {
    display: grid;
    gap: ${SPACE.md};
    max-width: 100%;
    overflow: hidden;
  }
  html[data-multisig-deploy-transition]::view-transition-old(root),
  html[data-multisig-deploy-transition]::view-transition-new(root) { animation: none; }
  ::view-transition-group(multisig-deploy-stage) {
    animation-duration: ${MOTION.enterMs}ms;
    animation-timing-function: ${EASE.out};
  }
  html[data-multisig-deploy-transition="forward"]::view-transition-old(multisig-deploy-stage) { animation: mc-vt-out-left ${MOTION.pressMs}ms ${EASE.out} both; }
  html[data-multisig-deploy-transition="forward"]::view-transition-new(multisig-deploy-stage) { animation: mc-vt-in-right ${MOTION.enterMs}ms ${EASE.out} both; }
  html[data-multisig-deploy-transition="back"]::view-transition-old(multisig-deploy-stage) { animation: mc-vt-out-right ${MOTION.pressMs}ms ${EASE.out} both; }
  html[data-multisig-deploy-transition="back"]::view-transition-new(multisig-deploy-stage) { animation: mc-vt-in-left ${MOTION.enterMs}ms ${EASE.out} both; }
  #multisig-deploy-review > *,
  #multisig-deploy-form button { max-width: 100%; }
  .multisig-deployment-target {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .multisig-deployment-target > span { color: var(--mc-muted); font-size: ${TYPE.caption.size}; }
  .multisig-deployment-target code {
    min-width: 0;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-deployment-target .icon-button { height: ${SIZE.control}; min-height: ${SIZE.control}; width: ${SIZE.control}; }
  .multisig-funding-stage { display: grid; gap: ${SPACE.lg}; }
  .multisig-funding-head {
    align-items: center;
    display: flex;
    gap: ${SPACE.md};
    justify-content: space-between;
  }
  .multisig-funding-head h2 { margin: 2px 0 0; }
  .multisig-funding-token {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    display: flex;
    font-size: ${TYPE.micro.size};
    font-weight: 700;
    height: 40px;
    justify-content: center;
    width: 40px;
  }
  .multisig-funding-address { display: grid; gap: ${SPACE.md}; justify-items: center; }
  .multisig-funding-address .qr-card { max-width: 148px; padding: ${SPACE.sm}; }
  .multisig-funding-address .address-line { max-width: 100%; width: 100%; }
  .multisig-funding-address .address-line code {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-funding-local { display: grid; gap: ${SPACE.sm}; }
  .multisig-deployment-success { display: grid; gap: ${SPACE.lg}; justify-items: center; text-align: center; }
  .multisig-deployment-success-mark {
    align-items: center;
    background: var(--mc-positive-soft);
    border-radius: ${RADIUS.full};
    color: var(--mc-positive);
    display: flex;
    height: 56px;
    justify-content: center;
    width: 56px;
  }
  .multisig-deployment-success .request-detail { text-align: left; width: 100%; }
  .multisig-deployment-success-actions { display: grid; gap: ${SPACE.sm}; width: 100%; }
  .multisig-deployment-success-actions > a {
    align-items: center;
    background: var(--mc-elevated);
    border-radius: ${RADIUS.full};
    color: var(--mc-text);
    display: flex;
    justify-content: center;
    min-height: ${SIZE.control};
    text-decoration: none;
  }
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
  .multisig-authority-summary { display: grid; gap: ${SPACE.lg}; }
  .multisig-signer-roster {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .multisig-signer-identity {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: auto minmax(0, 1fr) auto;
    min-height: ${SIZE.row};
    padding: ${SPACE.sm} ${SPACE.md};
    position: relative;
  }
  .multisig-signer-identity + .multisig-signer-identity::before {
    background: var(--mc-hairline);
    content: "";
    height: 1px;
    inset: 0 0 auto ${SPACE.lg};
    position: absolute;
  }
  .multisig-signer-identity .option-copy strong,
  .multisig-signer-identity .option-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-signer-manage { background: transparent; overflow: visible; }
  .multisig-signer-manage > summary {
    align-items: center;
    border-radius: ${RADIUS.full};
    display: flex;
    height: ${SIZE.control};
    justify-content: center;
    padding: 0;
    width: ${SIZE.control};
  }
  .multisig-signer-manage[open] {
    grid-column: 1 / -1;
    width: 100%;
  }
  .multisig-signer-manage[open] > summary { margin-left: auto; }
  .multisig-signer-manage .disclosure-body,
  .multisig-authority-actions,
  .multisig-authority-actions .disclosure-body { display: grid; gap: ${SPACE.md}; }
  .multisig-signer-manage form + form {
    border-top: 1px solid var(--mc-hairline);
    padding-top: ${SPACE.md};
  }
  .multisig-signer-recovery-list {
    background: var(--mc-panel);
    border-radius: ${RADIUS.lg};
    display: grid;
    overflow: hidden;
  }
  .multisig-signer-recovery-row {
    align-items: center;
    display: grid;
    gap: ${SPACE.sm};
    grid-template-columns: auto minmax(0, 1fr) auto;
    min-height: ${SIZE.row};
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .multisig-signer-recovery-row + .multisig-signer-recovery-row,
  .multisig-signer-recovery-field + .multisig-signer-recovery-field,
  .multisig-signer-recovery-row + .multisig-signer-recovery-field,
  .multisig-signer-recovery-field + .multisig-signer-recovery-row {
    border-top: 1px solid var(--mc-hairline);
  }
  .multisig-signer-recovery-row .option-copy strong,
  .multisig-signer-recovery-row .option-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    text-wrap: nowrap;
  }
  .multisig-signer-recovery-field { padding: ${SPACE.md}; }
  .multisig-signer-match { color: var(--mc-positive); display: inline-flex; }
  .multisig-config-note { color: var(--mc-muted); font-size: ${TYPE.caption.size}; margin: 0; }
  .multisig-deployment-success .request-detail dd { align-items: center; display: flex; gap: ${SPACE.xs}; }
  .multisig-authority-actions > .ghost { justify-self: start; }
  .multisig-portfolio-hero { padding-top: ${SPACE.md}; }
  .multisig-primary-actions { padding-block: ${SPACE.xs}; }
  .multisig-primary-actions .action-row { width: 100%; }
  .multisig-action-recovery { display: grid; gap: ${SPACE.sm}; }
  .multisig-action-recovery > button { justify-self: start; }
  .multisig-compose-flow {
    display: grid;
    gap: ${SPACE.xl};
    min-width: 0;
  }
  .multisig-compose-intro {
    color: var(--mc-muted);
    line-height: ${TYPE.body.line};
    margin: 0;
  }
  .multisig-compose-form {
    display: grid;
    gap: ${SPACE.md};
    min-width: 0;
  }
  .multisig-compose-form > label,
  .multisig-compose-form > button { min-width: 0; width: 100%; }
  .multisig-compose-flow:has(.multisig-advanced-call[open]) > #multisig-propose-form {
    display: none;
  }
  .multisig-compose-origin { display: grid; gap: ${SPACE.sm}; }
  .multisig-compose-origin .send-origin-account {
    min-width: 0;
    padding: ${SPACE.sm} ${SPACE.md};
  }
  .multisig-compose-origin .send-recipient-copy { padding-right: 0; }
  .multisig-recipient-picker .disclosure-body,
  .multisig-asset-picker .disclosure-body {
    display: grid;
    gap: ${SPACE.md};
    max-height: 280px;
    overflow-y: auto;
  }
  .multisig-recipient-picker .send-recipient-row,
  .multisig-asset-picker .send-asset-row { background: var(--mc-elevated); }
  .multisig-asset-picker { min-width: 0; }
  .multisig-asset-picker > summary.send-token-trigger {
    align-items: center;
    border-radius: ${RADIUS.full};
    cursor: pointer;
    display: inline-flex;
    gap: ${SPACE.sm};
    list-style: none;
  }
  .multisig-asset-picker > summary.send-token-trigger::-webkit-details-marker { display: none; }
  .multisig-asset-picker[open] > summary .icon { transform: rotate(180deg); }
  .multisig-asset-picker > .disclosure-body {
    border-top: 1px solid var(--mc-hairline);
    margin-top: ${SPACE.md};
    padding-top: ${SPACE.md};
  }
  .multisig-compose-form .send-amount-card { min-width: 0; }
  .multisig-compose-form .send-amount-field input { min-width: 0; }
  .multisig-compose-form #multisig-amount-guidance {
    color: var(--mc-muted);
    margin: -${SPACE.sm} 0 0;
    text-align: right;
  }
  .multisig-advanced-call > .disclosure-body {
    display: grid;
    gap: ${SPACE.md};
  }
  .multisig-advanced-call .multisig-compose-form { padding-top: ${SPACE.xs}; }
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
  .multisig-handoff-section { display: grid; gap: ${SPACE.sm}; min-width: 0; }
  .multisig-handoff-section + .multisig-handoff-section {
    border-top: 1px solid var(--mc-hairline);
    padding-top: ${SPACE.md};
  }
  .multisig-handoff-copy { display: grid; gap: ${SPACE.xs}; }
  .multisig-handoff-copy p {
    font-size: ${TYPE.caption.size};
    line-height: ${TYPE.caption.line};
  }
  .multisig-handoff-section > button { justify-self: start; }
  .multisig-collaboration-actions {
    display: grid;
    gap: ${SPACE.sm};
  }
  .multisig-collaboration-actions button { justify-content: start; min-width: 0; width: 100%; }
  .multisig-fragment-exports { margin-top: ${SPACE.xs}; }
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
  @media (prefers-reduced-motion: reduce) {
    html[data-multisig-deploy-transition]::view-transition-group(multisig-deploy-stage),
    html[data-multisig-deploy-transition]::view-transition-old(multisig-deploy-stage),
    html[data-multisig-deploy-transition]::view-transition-new(multisig-deploy-stage) {
      animation: none;
    }
  }
`;
