/**
 * The audited modules each file-standards allowance names.
 *
 * `check-file-standards.ts` owns the rules; this module owns the lists of files
 * those rules exempt. They are split because the exemption lists grow with the
 * codebase while the rules do not, and the gate itself is bound by the same
 * 500-line limit it enforces — a limit it reached. Every entry here is a
 * reviewed decision that one named file may do something the rest of the
 * repository may not.
 */

/**
 * What counts as naming secret material, kept beside the exemption list it is
 * paired with so a test can pin it. The session credential accessors and the
 * vault decrypt count too, so renaming the local that holds their result
 * cannot carry a vault read out of the approved boundary modules (audit #163:
 * the trust-set vault read must stay inside those modules).
 */
export const SECRET_MATERIAL_PATTERN =
  /\b(?:accountSecrets|getPassphrase|mnemonic|mnemonicPassphrase|passphrase|peekPassphrase|privateKey|readVault|seed|signature|signingKey|signingKeys|vaultPassphrase|viewingKey)\b/i;

/**
 * Modules permitted to name secret material. Each one sits on a key, vault, or
 * signing boundary where the field names are unavoidable; everywhere else,
 * naming them is the signal that secret material has leaked out of its
 * boundary.
 */
export const SECRET_MATERIAL_FILES = new Set([
  // Translates raw background diagnostics into reader-facing sentences. Three
  // of its lookup keys name secret-material fields because that is the exact
  // text the background threw; nothing here reads, logs, or persists one.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy.ts",
  // Split from friendly-error-copy.ts by the size budget: same contract — its
  // lookup keys quote diagnostics that name secret-material fields verbatim.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy-multisig.ts",
  // Classifies diagnostics the background threw ("Invalid mnemonic", "…signature
  // key mismatch") by their words; matched here, never read, logged, or persisted.
  "packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-internal.ts",
  // Decides whether a rejected send is known not sent; it names the Ledger
  // catalog code "signature-verify-failed" as a lookup key and reads no secret.
  "packages/presentation/wallet-ui/src/sidepanel/shared/submit-outcome.ts",
  "apps/extension/src/background/ledger/account-hash-signer.ts",
  "apps/extension/src/background/accounts/account-creation-inputs.ts",
  // Privileged first-run boundary: the phrase is validated through Krusty and
  // only the boolean verdict returns; the phrase is never logged or persisted.
  "apps/extension/src/background/onboarding/onboarding-ops.ts",
  // Import by address (issue 398): derives public keys from the phrase to match
  // an on-chain owner; only public account metadata leaves, nothing is
  // persisted or logged, and the phrase is never echoed.
  "apps/extension/src/background/onboarding/address-import.ts",
  // Builds the signHash for the recovery submissions; the phrase key signs
  // in the platform layer and nothing is logged or persisted.
  "apps/extension/src/background/accounts/account-recovery.ts",
  "apps/extension/src/background/routing/account-creation-handlers.ts",
  // Keeps the unlocked vault credential inside the privileged worker while
  // coordinating fail-closed network/vault commits; never persists or emits it.
  "apps/extension/src/background/runtime/active-network-mutation.ts",
  // Claim validation split out of approval-decisions: reads the session's
  // vault credential only to re-check a claimed approval's granted account
  // against the vault at decision time; never logs, persists, or returns it.
  "apps/extension/src/background/approvals/approval-claim-context.ts",
  // Claim-time session view: wraps the session's credential accessors so a
  // deferred executor cannot adopt a later unlock; it reads no value itself.
  "apps/extension/src/background/approvals/approval-session.ts",
  "apps/extension/src/background/provider/add-chain-ops.ts",
  "apps/extension/src/background/approvals/approval-decisions.ts",
  // Names the signature-waiter collaborator by its module path only. It holds
  // no secret material and touches no key operations.
  "apps/extension/src/background/approvals/approval-decision-deps.ts",
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
  "apps/extension/src/background/provider/provider-grant.ts",
  "apps/extension/src/background/provider/provider-ops.ts",
  "apps/extension/src/background/settings/origins-ops.ts",
  "apps/extension/src/background/privacy/strk20-account-context.ts",
  // Approved-request execution split out of strk20-ops.ts: it re-resolves the
  // granted account behind a non-renewing session peek and hands the unlocked
  // vault credential straight to the protected signer wiring. Same boundary,
  // same rule — never logged, persisted, or returned across a message.
  "apps/extension/src/background/privacy/strk20-approval-execution.ts",
  // Records used shadow-account scopes (#443): hands the unlocked vault
  // credential straight to the vault's record method. Never logged or returned.
  "apps/extension/src/background/privacy/strk20-shadow-scopes.ts",
  // Shadow accounts view (#443): reads the account's scope records with the
  // unlocked vault credential, like the other privileged privacy journeys.
  "apps/extension/src/background/privacy/strk20-shadow-ops.ts",
  // Queues approvals only. Since the execution half moved out, its sole match
  // is the `./signature-waiters` import path; no secret material transits here.
  "apps/extension/src/background/privacy/strk20-ops.ts",
  // Active-account context split from strk20-wallet-ops; the vault passphrase
  // only transits into the protected signer wiring, never logged or stored.
  "apps/extension/src/background/privacy/strk20-op-context.ts",
  // Compares a pool public key with the public x-coordinate the vault would
  // register. The vault credential only transits into that preview; the
  // viewing key stays in the vault and nothing here is logged or stored.
  "apps/extension/src/background/privacy/strk20-registration-owner.ts",
  "apps/extension/src/background/privacy/strk20-wallet-ops.ts",
  "apps/extension/src/background/runtime/runtime-state.ts",
  "apps/extension/src/background/runtime/runtime-types.ts",
  // Phrase-flow reply types split from runtime-types.ts: declares the reveal
  // replies' phrase fields; types only, holding and logging nothing.
  "apps/extension/src/background/runtime/runtime-phrase-types.ts",
  // QSB account parsers: bound the phrase to import and the re-entered vault
  // credential of a reveal; nothing is echoed, logged, or persisted.
  "apps/extension/src/background/qsb/qsb-account-inputs.ts",
  // QSB account handlers: hand the session's (or, for the one sanctioned
  // reveal, the re-entered) vault credential straight to the vault service and
  // return its views; the revealed phrase only transits to the extension page.
  "apps/extension/src/background/qsb/qsb-account-ops.ts",
  // QSB vault handlers: hand the session's vault credential (peeked for the
  // polled listing, renewed for user actions) straight to the vault service's
  // QSB session; replies are public vault data only. Never logged or kept.
  "apps/extension/src/background/qsb/qsb-vault-ops.ts",
  "apps/extension/src/background/runtime/session.ts",
  "packages/platform/ledger-protocol/src/broker.ts",
  "apps/extension/src/background/routing/unlock-errors.ts",
  "apps/extension/src/background/accounts/wallet-ops.ts",
  // Deploy handlers split from wallet-ops (issue 431); the vault passphrase only
  // transits into the protected hash-signer wiring, never logged or stored.
  "apps/extension/src/background/accounts/deploy-account-ops.ts",
  // Public-send review and broadcast split from wallet-ops. The session
  // credential only transits into the hash signer; it is never logged,
  // persisted, or returned.
  "apps/extension/src/background/accounts/transfer-ops.ts",
  "apps/extension/src/background/accounts/wallet-reader.ts",
  "apps/extension/src/background/ledger/ledger-inputs.ts",
  "packages/platform/kms-krusty/src/adapter.ts",
  // Krusty's QSB and Bitcoin calls, split from adapter.ts: checks the private
  // key and the signatures crossing the Krusty boundary and frees Krusty's
  // copy; nothing is logged, persisted, or returned past the vault service.
  "packages/platform/kms-krusty/src/bitcoin.ts",
  "packages/foundation/wallet-model/src/accounts/signing.ts",
  // Pure length policy only; carries no passphrase value across a boundary.
  "packages/foundation/wallet-model/src/preferences/passphrase.ts",
  // Setup meter only: scores the typed value in the UI and keeps nothing.
  "packages/foundation/wallet-model/src/preferences/passphrase-strength.ts",
  "packages/testing/testkit/src/fake-kms.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-ledger.ts",
  "packages/foundation/wallet-protocol/src/provider/results.ts",
  "packages/foundation/wallet-protocol/src/provider/bridge.ts",
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
  "packages/presentation/wallet-ui/src/sidepanel/journeys/settings/import-phrase-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/app/start.ts",
  // English BIP39 word list embeds the token `seed`; assist-only, never crypto.
  "packages/presentation/wallet-ui/src/recovery/bip39-english.ts",
  "packages/presentation/wallet-ui/src/popup/responses/responses-onboarding.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/import-key-ui.ts",
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/onboarding-ui.ts",
  // Setup strength meter: reads the typed vault credential only to score and
  // describe it; nothing is stored, logged, or sent.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/passphrase-meter.ts",
  // Show/hide on a passphrase being created: names the field in its own
  // accessible label and flips the input type. It never reads the value.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/passphrase-reveal.ts",
  // Weak-credential acknowledgement shared by the software and Ledger setup
  // flows: reads the typed vault credential only to decide whether to reveal a
  // checkbox and whether the step may proceed. It holds no reference to the
  // value, stores nothing, and sends nothing.
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
  // Quantum-safe Bitcoin client: the reveal request carries the freshly typed
  // vault passphrase and its reply the phrase; the import request carries the
  // typed phrase. Validated and passed through, never kept, logged, or stored.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/qsb/qsb-runtime.ts",
  // QSB backup screen: reads the vault passphrase once at submit and empties
  // the field as it is sent; the revealed phrase lives only in the grid cells,
  // which are emptied before the check words and whenever the screen is left.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/qsb/qsb-backup-ui.ts",
  // QSB phrase import: the typed phrase lives only in the grid cells and goes
  // once into the privileged import request; the cells are emptied on success
  // and whenever the screen is left. Nothing is stored or logged.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/qsb/qsb-import-ui.ts",
  // QSB withdrawal client: the release request carries the wallet passphrase
  // the user just typed, passed through to the background and kept nowhere.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/qsb/qsb-withdrawal-runtime.ts",
  // QSB release review: reads the wallet passphrase once at submit and empties
  // its field as it is sent, and again whenever the screen is left or
  // repainted; it never holds the value in state.
  "packages/presentation/wallet-ui/src/sidepanel/journeys/qsb/qsb-release-ui.ts",
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
  // Posts the outside-execution signature the gasless gateway requires.
  // The field is public; private signing stays in Krusty via signHash.
  "packages/features/transactions/src/gasless/gasless-submit.ts",
  "packages/features/privacy/src/service.ts",
  // QSB coordinator sign-in: matches the coordinator's fixed session-only text,
  // which names a signature, and posts the public BIP-322 proof as the
  // `signature` field; no key is read, held, logged or persisted here.
  "packages/features/qsb/src/coordinator/challenge.ts",
  "packages/features/qsb/src/coordinator/client.ts",
  // Checks the public partial signatures Krusty added to a deposit PSBT and
  // moves them into the witness; it never signs and holds no key.
  "packages/features/qsb/src/deposit/psbt.ts",
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
  "packages/platform/vault/src/schema/schema-types.ts",
  "packages/platform/vault/src/schema/schema.ts",
  // Imported-seed validators split from schema.ts on the size budget; they name
  // the retained phrase field only to validate it inside the vault.
  "packages/platform/vault/src/schema/schema-seeds.ts",
  // QSB account records: declares and validates each dedicated phrase inside
  // the encrypted vault. Validators only; no phrase is derived from, returned,
  // logged, or persisted elsewhere here.
  "packages/platform/vault/src/qsb/qsb-account.ts",
  // QSB journal store: reads and writes one account's encrypted journal with
  // the caller's vault passphrase, like every other vault service method. The
  // journal holds no phrase; the credential is never logged or returned.
  "packages/platform/vault/src/qsb/qsb-journal-store.ts",
  // QSB account methods: generate (through Krusty), import, confirm and reveal
  // a dedicated phrase inside the encrypted vault under the caller's vault
  // credential; only the re-authenticated reveal returns a phrase.
  "packages/platform/vault/src/service/qsb-accounts.ts",
  // Their type surface, split by behaviour: names the phrase and credential
  // fields of the inputs and the reveal's result; types only.
  "packages/platform/vault/src/service/qsb-account-types.ts",
  // QSB vault session: derives the owner key from the account's phrase through
  // Krusty for each use and signs with it, inside the vault service; returns
  // public data only and never keeps, logs or persists the key or the phrase.
  "packages/platform/vault/src/service/qsb-vault-access.ts",
  // Its type surface: names the session's credential input and the public
  // signatures it returns; types only.
  "packages/platform/vault/src/service/qsb-vault-types.ts",
  // QSB pending deposits: reads and writes one account's encrypted record of
  // signed public transactions under the caller's vault passphrase, like the
  // journal store; the credential is never logged or returned.
  "packages/platform/vault/src/qsb/qsb-deposit-store.ts",
  "packages/platform/vault/src/schema/store-migration.ts",
  "packages/platform/vault/src/accounts/accounts.ts",
  // Split from accounts.ts by the size budget: same boundary, same rules — the
  // mnemonic and derived keys pass through to the encrypted vault, unlogged.
  "packages/platform/vault/src/accounts/derivation-core.ts",
  // Assembles the Braavos 2FA-removal request through the signing boundary;
  // the phrase key signs here and nothing is logged or persisted.
  "packages/platform/starknet/src/transactions/braavos-recovery.ts",
  // Assembles the Ready guardian-escape request through the signing boundary;
  // the phrase key signs here and nothing is logged or persisted.
  "packages/platform/starknet/src/transactions/argent-recovery.ts",
  "packages/platform/vault/src/accounts/strk20-viewing-key.ts",
  "packages/platform/vault/src/accounts/network-account.ts",
  "packages/platform/vault/src/service/reveal.ts",
  "packages/platform/vault/src/service/service-creation.ts",
  // Atomic recovery re-derives selected accounts and writes their protected
  // keys directly into the encrypted vault; no secret is returned or logged.
  "packages/platform/vault/src/service/recovery.ts",
  // Wallet-level Nostr derivation and application-data crypto stay behind the
  // same encrypted-vault/Krusty boundary and never return private material.
  "packages/platform/vault/src/service/nostr.ts",
  "packages/platform/vault/src/service/service.ts",
  // Shadow-account scope records (#443): reads and writes the encrypted vault
  // with the caller's vault passphrase, like every other vault service method.
  "packages/platform/vault/src/service/shadow-account-scopes.ts",
  "packages/platform/vault/src/service/service-types.ts",
]);
