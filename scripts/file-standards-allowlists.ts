/**
 * Files sanctioned to mention secret-material field names, each with the reason
 * it is a trust boundary.
 *
 * Data, not logic: kept beside the check rather than inside it so adding a
 * boundary is a reviewable one-line diff against a list, and so the checker
 * stays under the size limit it enforces.
 */

export const SECRET_MATERIAL_FILES = new Set([
  "apps/extension/src/background/ledger/account-hash-signer.ts",
  "apps/extension/src/background/accounts/account-creation-inputs.ts",
  // Privileged first-run boundary: the phrase is validated through Krusty and
  // only the boolean verdict returns; the phrase is never logged or persisted.
  "apps/extension/src/background/onboarding/onboarding-ops.ts",
  // Keeps the unlocked vault credential inside the privileged worker while
  // coordinating fail-closed network/vault commits; never persists or emits it.
  "apps/extension/src/background/runtime/active-network-mutation.ts",
  "apps/extension/src/background/provider/add-chain-ops.ts",
  "apps/extension/src/background/approvals/approval-decisions.ts",
  "apps/extension/src/background/transactions/chain-ops.ts",
  "apps/extension/src/background/portfolio/discovery-ops.ts",
  "apps/extension/src/background/transactions/declare-ops.ts",
  "apps/extension/src/background/accounts/import-inputs.ts",
  "apps/extension/src/background/ledger/ledger-ops.ts",
  "apps/extension/src/background/ledger/ledger-sign-queue.ts",
  "apps/extension/src/background/ledger/ledger-signer.ts",
  "apps/extension/src/background/approvals/signature-waiters.ts",
  "apps/extension/src/background/index.ts",
  "apps/extension/src/background/routing/message-inputs.ts",
  // Wires collaborators by name only. Its sole match is the `./signature-waiters`
  // import path; it holds no secret material and touches no key operations.
  "apps/extension/src/background/routing/message-context.ts",
  "apps/extension/src/background/routing/messages.ts",
  "apps/extension/src/background/provider/provider-ops.ts",
  // Executes an invoke the user already approved: it re-resolves the granted
  // account behind a non-renewing session peek and hands the unlocked vault
  // credential straight to the protected signer. Same boundary, same rule —
  // never logged, persisted, or returned across a message.
  "apps/extension/src/background/provider/invoke-execution.ts",
  "apps/extension/src/background/settings/origins-ops.ts",
  "apps/extension/src/background/privacy/strk20-account-context.ts",
  // Recovery-phrase scan handler: holds the unlocked passphrase only to reach the
  // vault service, and returns public account metadata alone.
  "apps/extension/src/background/accounts/seed-scan-ops.ts",
  // Approved-request execution split out of strk20-ops.ts: it re-resolves the
  // granted account behind a non-renewing session peek and hands the unlocked
  // vault credential straight to the protected signer wiring. Same boundary,
  // same rule — never logged, persisted, or returned across a message.
  "apps/extension/src/background/privacy/strk20-approval-execution.ts",
  // Queues approvals only. Since the execution half moved out, its sole match
  // is the `./signature-waiters` import path; no secret material transits here.
  "apps/extension/src/background/privacy/strk20-ops.ts",
  // Active-account context split from strk20-wallet-ops; the vault passphrase
  // only transits into the protected signer wiring, never logged or stored.
  "apps/extension/src/background/privacy/strk20-op-context.ts",
  "apps/extension/src/background/privacy/strk20-wallet-ops.ts",
  // Viewing-key custody split from strk20-wallet-ops. It resolves the retained
  // key to test whether one exists — presence is a vault fact nothing else can
  // answer — and discards the value immediately without returning or logging it.
  "apps/extension/src/background/privacy/strk20-viewing-key-state.ts",
  "apps/extension/src/background/runtime/runtime-state.ts",
  "apps/extension/src/background/runtime/runtime-types.ts",
  "apps/extension/src/background/runtime/session.ts",
  "packages/platform/ledger-protocol/src/broker.ts",
  "apps/extension/src/background/routing/unlock-errors.ts",
  "apps/extension/src/background/accounts/wallet-ops.ts",
  "apps/extension/src/background/accounts/wallet-reader.ts",
  "apps/extension/src/background/ledger/ledger-inputs.ts",
  "packages/platform/kms-krusty/src/adapter.ts",
  "packages/foundation/wallet-model/src/accounts/signing.ts",
  // Pure length policy only; carries no passphrase value across a boundary.
  "packages/foundation/wallet-model/src/preferences/passphrase.ts",
  "packages/testing/testkit/src/fake-kms.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-ledger.ts",
  "packages/foundation/wallet-protocol/src/provider/results.ts",
  "packages/foundation/wallet-protocol/src/provider/bridge.ts",
  // Sends the phrase being recovered to the privileged scan so setup can list its
  // accounts before a vault exists; never stores, logs, or receives one back.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/accounts-runtime-client.ts",
  "packages/presentation/wallet-ui/src/sidepanel/shared/dom.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/rendering/focus-memo.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/gate-views.ts",
  "packages/platform/ledger-protocol/src/client.ts",
  "packages/platform/ledger-protocol/src/errors.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/first-run.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/onboard-entry.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/runtime-client.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-runtime.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-session.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/sign-views.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/import-key-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
  // English BIP39 word list embeds the token `seed`; assist-only, never crypto.
  "packages/presentation/wallet-ui/src/recovery/bip39-english.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-onboarding.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-views.ts",
  // Recovery discovery keeps the phrase and vault credential only in the
  // first-run DOM closure and forwards them to the privileged background.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-account-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-import-bind.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-word-assist.ts",
  // Locked-gate UI forwards the passphrase to the privileged background and
  // neither persists it nor renders it.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/unlock-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/reveal-ui.ts",
  // Compares the two vault-passphrase fields to report whether they agree. Reads
  // their values only to compare them; stores, logs, and returns nothing.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/vault-passphrase-fields.ts",
  // Passes the phrase being recovered to the privileged create message so a
  // restored wallet can start from the account the user chose; never stores or
  // logs one.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/restore-accounts.ts",
  "packages/presentation/wallet-ui/src/sidepanel/runtime/runtime.ts",
  // Privileged UI message client: credentials transit directly to the
  // background and are never retained or rendered here.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/runtime-accounts.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-runtime.ts",
  // Public Argent multisig packages and verified signature fragments cross
  // these UI boundaries; no private signing material is ever present.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-model.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-runtime.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-ui.ts",
  // Public intent packages and verified public signature fragments only; all
  // private signing remains inside the privileged background/Krusty boundary.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-intent-ui.ts",
  // Renders public signature-fragment transport controls only; private signing
  // remains behind the privileged background accountHashSigner boundary.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-intent-actions.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/multisig/multisig-views.ts",
  "packages/features/transactions/src/routing/ledger-verify.ts",
  // Pure public-key verification consolidated for Ledger and KMS probe
  // callers; it receives no private key or vault credential.
  "packages/platform/starknet/src/transactions/signature-verify.ts",
  // Public account ABI serialization and signer façades. These files carry
  // public keys/signature fragments; private-key operations remain in Krusty.
  "packages/platform/starknet/src/accounts/account-contracts.ts",
  "packages/platform/starknet/src/rpc/account-signer.ts",
  "packages/platform/starknet/src/rpc/multisig-invoke.ts",
  "packages/platform/starknet/src/rpc/rpc-estimate.ts",
  "packages/platform/starknet/src/transactions/declare.ts",
  "packages/platform/starknet/src/transactions/deployment.ts",
  "packages/platform/starknet/src/rpc/provider.ts",
  "packages/platform/starknet/src/rpc/rpc.ts",
  "packages/features/privacy/src/policy/call-set-signer.ts",
  "packages/features/privacy/src/sdk/official-sdk-service.ts",
  // CallSet signing and viewing-key wiring extracted from official-sdk-service;
  // same Krusty-delegated boundary, no secret ever stored or logged here.
  "packages/features/privacy/src/sdk/official-sdk-transfers.ts",
  "packages/features/privacy/src/paymaster/paymaster.ts",
  "packages/features/privacy/src/service.ts",
  // Argent multisig stores public signer identifiers and verified public
  // signature fragments only. Private signing remains behind Krusty and the
  // privileged background accountHashSigner boundary.
  "packages/features/multisig/src/chain.ts",
  "packages/features/multisig/src/deploy.ts",
  "packages/features/multisig/src/repository-schema.ts",
  "apps/extension/src/background/multisig/multisig-deploy-ops.ts",
  "apps/extension/src/background/multisig/multisig-inputs.ts",
  // Explicit user-triggered coordination keeps the vault credential inside the
  // privileged worker while Krusty opens or wraps payloads; it is never stored.
  "apps/extension/src/background/multisig/multisig-coordination-ops.ts",
  "apps/extension/src/background/multisig/multisig-tx-ops.ts",
  "packages/platform/vault/src/accounts/account-secrets.ts",
  "packages/platform/vault/src/encrypted-store.ts",
  "packages/platform/vault/src/kms-port.ts",
  "packages/platform/vault/src/schema/migrations.ts",
  "packages/platform/vault/src/schema/schema.ts",
  "packages/platform/vault/src/schema/store-migration.ts",
  "packages/platform/vault/src/accounts/accounts.ts",
  // Walks HD positions using the vault's stored phrase. Derives public metadata
  // only and discards every intermediate; the phrase is read from an
  // already-decrypted vault and never returned, logged, or re-persisted.
  "packages/platform/vault/src/accounts/seed-account-scan.ts",
  "packages/platform/vault/src/accounts/strk20-viewing-key.ts",
  "packages/platform/vault/src/accounts/network-account.ts",
  // Origin-grant read-modify-writes split from vault-service; the passphrase
  // transits into the injected vault io and is never stored or logged.
  "packages/platform/vault/src/service/reveal.ts",
  // Atomic recovery re-derives selected accounts and writes their protected
  // keys directly into the encrypted vault; no secret is returned or logged.
  "packages/platform/vault/src/service/recovery.ts",
  // Wallet-level Nostr derivation and application-data crypto stay behind the
  // same encrypted-vault/Krusty boundary and never return private material.
  "packages/platform/vault/src/service/nostr.ts",
  "packages/platform/vault/src/service/service.ts",
  // Composes the two viewing-key methods. The passphrase transits to the vault
  // read and the ceremony's own writer; the Ledger form returns nothing at all,
  // so no key can leave through it.
  "packages/platform/vault/src/service/strk20-viewing-key-methods.ts",
  "packages/platform/vault/src/service/service-types.ts",
]);
