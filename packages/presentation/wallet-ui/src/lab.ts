/**
 * Development-only Wallet UI surface consumed by UI Lab and integration tests.
 * Production extension entrypoints must import `@bramble/wallet-ui/start` instead.
 */

/**
 * Public Argent multisig view shape for deterministic UI Lab fixtures.
 */
export type { ArgentMultisigView } from "./popup/responses/multisig-responses";
export * from "./popup/responses/responses";
export * from "./sidepanel/app/screens/views";
export * from "./sidepanel/journeys/approvals/approval-cards";
export * from "./sidepanel/journeys/collectibles/nft-send-view";
export * from "./sidepanel/journeys/collectibles/nft-ui";
export * from "./sidepanel/journeys/collectibles/nft-views";
export * from "./sidepanel/journeys/ledger/onboard-views";
export * from "./sidepanel/journeys/ledger/sign-session";
export * from "./sidepanel/journeys/ledger/sign-views";
export * from "./sidepanel/journeys/multisig/multisig-management-views";
export * from "./sidepanel/journeys/multisig/multisig-model";
export * from "./sidepanel/journeys/multisig/multisig-portfolio";
export * from "./sidepanel/journeys/multisig/multisig-runtime";
export * from "./sidepanel/journeys/multisig/multisig-ui";
export * from "./sidepanel/journeys/multisig/multisig-views";
export * from "./sidepanel/journeys/onboarding/backup-verify";
export * from "./sidepanel/journeys/onboarding/gate-views";
export * from "./sidepanel/journeys/onboarding/onboarding-surface";
export * from "./sidepanel/journeys/onboarding/onboarding-ui";
export * from "./sidepanel/journeys/onboarding/unlock-ui";
export * from "./sidepanel/journeys/portfolio/home-tabs";
export * from "./sidepanel/journeys/portfolio/home-ui";
export * from "./sidepanel/journeys/portfolio/token-row";
export * from "./sidepanel/journeys/privacy/privacy-model";
export * from "./sidepanel/journeys/privacy/privacy-runtime";
export * from "./sidepanel/journeys/send/send-model";
export * from "./sidepanel/journeys/send/send-views";
export * from "./sidepanel/journeys/send/transfer-ui";
export * from "./sidepanel/journeys/swap/swap-client";
export * from "./sidepanel/journeys/swap/swap-ui";
export * from "./sidepanel/runtime/runtime";
/** The chain's answer a receipt is built from, and the table that maps a status onto it. */
export {
  type ConfirmationOutcome,
  confirmationOutcome,
} from "./sidepanel/shared/confirm-submitted";
export { showToast } from "./sidepanel/shared/dom";
/** Builds and writes a settled-transaction receipt, as every journey does. */
export { outcomeReceiptFor, paintOutcomeReceipt } from "./sidepanel/shared/outcome-receipt";
export * from "./sidepanel/shared/parts";
export * from "./sidepanel/shared/review-render";
export * from "./sidepanel/shared/token-dropdown";
export * from "./sidepanel/shell/account-types";
export * from "./sidepanel/shell/dashboard-bindings";
/** The deployment receipt's copy, so lab checkpoints paint what the binder ships. */
export { DEPLOY_RECEIPT_COPY } from "./sidepanel/shell/shell-bindings";
export * from "./sidepanel/styles/index";
