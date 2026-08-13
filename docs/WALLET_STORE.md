---
layout: default
title: Wallet store architecture
permalink: /wallet-store/
---

# Wallet store architecture and update safety

This document is the reviewed persistence contract for MC Wallet. It covers the store layout at
the v6 encrypted-vault schema, account identity and scoping, mutation rules, Chrome extension
updates, and the custody boundary for a future Ledger-derived STRK20 viewing key.

Review baseline: `main` at `4bdd457b216e1dd1a07df49db68b62b22675a6d9`; implementation tracked by
[issue #208](https://github.com/starknet-innovation/mc-wallet/issues/208).

## Security conclusions

- Public account metadata and secret material remain structurally separate. `AccountRef` is safe to
  project; `accountSecrets`, `signingKeys`, and `mnemonic` are encrypted-vault-only.
- HD-derived, imported-key, and Ledger signer accounts share one stable `AccountRef` union and the
  same active-account, permission, activity, token, allowance, network, and UI projection rules.
- Watched multisigs are durable first-class contract accounts in their own public on-chain registry.
  They deliberately do not masquerade as signer accounts: every mutation resolves an owned signer
  and re-checks the multisig on chain. Their ids use the same `networkId:canonical-address` identity
  convention, and frozen signing intents reference the multisig id.
- Every authoritative read-modify-write store is mutation-serialized. Account/network identifiers
  remain explicit at consumer boundaries, and validators prove the account id's embedded network
  agrees with that explicit scope.
- Every operation that can change the selected account or network shares one worker-level
  coordinator. The plain selected-network preference is the durable intent written first; the
  encrypted account pointer is repaired toward it after interruption or preference import.
- Chrome persistent and session storage are restricted to `TRUSTED_CONTEXTS` before unlock-session
  restoration or request handling can begin. Missing or failed lockdown support stops privileged
  startup; extension messages remain the validated capability boundary.
- Vault migrations are adjacent, deterministic, staged, verified, restart-recoverable, and
  performed only after unlock. Invalid source data is rejected before the primary ciphertext is
  touched.
- A Ledger STRK20 viewing key can be retained only as a canonical, bounded, account/chain/pool/
  scheme-bound encrypted optional secret. It is absent from provider, UI, preferences, session,
  activity, logs, exports, and public account/status response types.

## Persistence map

| Key / state | Area | Sensitivity | Identity and bounds | Failure policy |
| --- | --- | --- | --- | --- |
| `mc-wallet:vault` | `storage.local`, AES-GCM | mnemonic, signing keys, optional viewing keys, grants | schema v6; account ids unique; strict cross-references | fail closed |
| `mc-wallet:vault-migration` | `storage.local`, AES-GCM | temporary full migrated vault | exists only during a verified schema commit | authenticated recovery, then remove |
| `mc-wallet:preferences` | `storage.local`, plain | labels, groups, contacts, tokens, networks, watched NFTs | schema v1; deterministic ids and bounded validators | fail closed on invalid root |
| `mc-wallet:activity` | `storage.local`, plain | public transaction history | account + network; 200 entries per scope | discard invalid rows; monotonic status |
| `mc-wallet:allowances` | `storage.local`, plain | public ERC20 approvals | account + network + token + spender; 200 total | discard invalid rows |
| `mc-wallet:argent-multisigs:v2` | `storage.local`, plain, trusted contexts only | public contracts, frozen transaction intents, exact-hash authorization fragments | network + canonical contract; 20 multisigs / 100 intents / 100 operations | discard invalid or orphaned rows; never silently evict active authority |
| `mc-wallet:origin-history` | `storage.local`, plain | first-seen dapp origins | valid HTTPS/localhost origin; 500 origins | discard invalid entries |
| `mc-wallet:prices`, `mc-wallet:charts` | `storage.local`, plain | recoverable market cache | TTL and cache-size bounded | cached-or-empty |
| `mc-wallet:phishing-feed` | `storage.local`, plain | signed/validated blocklist cache | TTL and response bounds | bundled baseline remains active |
| `mc-wallet:session` | `storage.session`, plain trusted-context only | unlock passphrase capability | timeout-bound session | cleared on lock/update/browser exit |
| `mc-wallet:strk20-maturity` | `storage.session`, plain | public pending transaction metadata | account + network + pool; 100 records | discard invalid rows |
| approvals, AES keys, selected UI view | worker/page memory | transient authority or presentation state | request/session/view scoped | lost safely on restart |

`storage.local` and `storage.session` are locked to trusted extension contexts with
`setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`. Chrome documents that local data persists
until extension removal, while session data is cleared when an extension is updated. See the
[Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Account identity and first-class behavior

`AccountRef` is a public discriminated union:

- `starknet-bip44`: HD coordinates and full public point; one encrypted signing-key reference.
- `imported-raw-key`: public x-coordinate and one encrypted signing-key reference.
- `ledger`: EIP-2645 account index/path, `LedgerW` application marker, and public x-coordinate; no
  signing-key reference.

All three carry an explicit `argent` or `openzeppelin` account-contract type and use
`networkId:address` as the stable account id. Network projection intentionally creates a new
account id because contract type, class hash/address, and every account-scoped cache are network-specific.
`sameWalletKey` is the only cross-network identity comparator.

A watched multisig is public contract state rather than a signing authority. Its stable id has the
same network/address form, but it remains in `MultisigStore` so code cannot accidentally call a
single-signer signing method with a multisig. UI and background code combine the two typed sets into
an account drawer/portfolio projection. Multisig operations bind the multisig id and an exact frozen
V3 transaction hash. Each imported or locally produced signature is verified against current Argent
membership before storage. This separation is a safety type boundary, not second-class storage.

An unbroadcast signature fragment is a narrow authorization capability even though it contains no
secret key. The store is therefore reachable only through the privileged background after Chrome
storage access is restricted to trusted extension contexts. A fragment authorizes only its frozen
hash and nonce; importing or submitting it revalidates the complete intent and fresh on-chain signer
configuration. It never enters the encrypted single-signer vault, account metadata, preferences,
activity summaries, logs, provider messages, or dapp-reachable routes.

Cross-store references follow these rules:

1. Vault collections are strict: every grant, signing key, and optional account secret must resolve
   to an existing account; duplicates and orphans invalidate the whole decrypted vault.
2. Recoverable public chain caches may filter invalid/orphaned rows. They cannot authorize a spend,
   and the chain remains the source of truth.
3. Every activity, allowance, STRK20 maturity, NFT discovery, and multisig request resolves an
   explicit account/multisig plus network before returning data to UI.
4. Mutations preserve unknown current-schema siblings with object spread. A method changing one
   collection must not reconstruct the whole vault and accidentally drop later fields.

## Chrome Web Store update lifecycle

`runtime.onInstalled` fires for install and update, including an unpacked-extension reload. It may
open onboarding on first install, but it must not attempt an encrypted data migration: the worker
has no vault passphrase, and `storage.session` is intentionally cleared on update. Chrome documents
the lifecycle reasons in the [runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime).

The first authenticated vault operation after unlock performs the data update:

1. Read and authenticate the primary AES-GCM envelope.
2. Run every adjacent pure migration through `CURRENT_SCHEMA_VERSION` and validate the complete v4
   graph. No storage write occurs if source or output is invalid.
3. Encrypt the migrated vault under the distinct migration-store AAD scope, read it back, validate
   it, and compare it with the expected value.
4. Encrypt the same value under the primary AAD scope, read it back, validate it, and compare it.
5. Remove staging only after the primary verification succeeds, then read the staging scope back
   and fail closed unless its absence is confirmed.

If the MV3 worker stops before step 4, the old primary remains authoritative. If it stops after the
primary write but before cleanup, both copies contain the same authenticated current vault. If the
primary is unreadable while a valid stage exists, the next authenticated read restores and verifies
the stage. A current primary wins over stale staging, removes it, and verifies its absence. Re-running
the process is idempotent and does not rewrite a current envelope.

Release checks must retain tests for:

- every adjacent migration and a contiguous migration table;
- missing/v1/v2/v3/current/future/invalid sources;
- unchanged primary ciphertext on invalid migration input;
- stage verification and interrupted-worker recovery;
- failed stage verification and failed primary writes leaving the old primary intact;
- silent stage-cleanup failures retaining an authenticated recovery copy and surfacing an error;
- wrong-passphrase reads never restoring or deleting an authenticated stage;
- account, grant, signing-key, and optional-secret preservation;
- current-schema idempotence and public response non-disclosure.

## Optional Ledger STRK20 viewing keys

The v4 shape is intentionally not an `optionalHotKeys` field on `AccountRef`. Public account refs are
returned to extension pages and granted origins; putting a viewing key there would make a later
object spread an exfiltration bug. Instead, the encrypted vault owns a parallel optional collection:

```ts
type AccountSecretRef = {
  accountId: string;
  ledgerStrk20ViewingKeys: readonly {
    chainId: string;
    poolAddress: string;
    scheme: "ledger-strk20-typed-data-v1";
    viewingKey: string;
  }[];
};
```

An entry is valid only when:

- `accountId` resolves to a retained Ledger account;
- chain id, pool address, and key are canonical lowercase non-zero felts;
- the chain equals the account network's configured chain id;
- the key is a valid Stark private scalar (a viewing credential, never an account signing key);
- chain/pool scopes are unique and at most eight are retained per account. Replacing an existing
  scope is atomic; a ninth distinct scope fails explicitly instead of silently evicting a key.

Software accounts continue deriving through Krusty on demand and never write this collection.
Ledger lookup fails closed unless the exact account/chain/pool record exists. Storing and forgetting
are background-only vault-service methods and are intentionally absent from `WalletStatusReader`,
runtime messages, provider methods, and UI clients.

### Hardware derivation ceremony: required proof obligations

The store is ready; the Ledger ceremony is not yet authorized for production. Before wiring it, a
separate reviewed change must pin:

1. The exact SNIP-12 domain name, version, revision, primary type, field order, and felt/string
   encoding.
2. Explicit binding to purpose, account address, Ledger public key/path, chain id, pool address, and
   derivation-scheme version. A signature valid for one account or pool must not provision another.
3. The signature-to-viewing-scalar transform, including Poseidon/hash inputs, zero rejection, curve
   order reduction/folding, canonical output, and official test vectors.
4. Deterministic recovery. If the Ledger app can emit more than one valid signature for the same
   message, hashing `(r,s)` is not a recoverable seed; this must be proven with supported app/device
   versions or replaced by a deterministic construction.
5. A device confirmation UX that identifies the privacy credential purpose and scope. Blind hash
   approval without a wallet-side review is insufficient.
6. Registration-commitment parity with the official Privacy SDK and a fresh-profile recovery test
   proving the same device recreates the same note-discovery identity.
7. Lifecycle controls: explicit forget/re-derive, account removal cleanup, backup exclusion, lock
   cache clearing, and failure behavior when the Ledger is unavailable.

Until those obligations and vectors land, no UI or provider message can populate the slot. This
prevents a convenient storage feature from silently standardizing an unrecoverable or weak
derivation protocol.

## Mutation and UI subscription rules

- Vault mutations and KDF/schema upgrades share one queue. Passive reads cannot race a stale
  upgrade over account, grant, or optional-secret writes.
- Account creation/import, Ledger additions, account selection, network switching, unlock/lock,
  preference import, and dapp-approved chain switches share one active-state coordinator. The
  preference write happens before the encrypted pointer mutation, so a partial failure leaves a
  retryable intent rather than a hidden created account that makes the retry fail as a duplicate.
- Preferences, activity, allowances, multisigs, origin history, and maturity use the shared
  `serializeStoreMutations` wrapper. New mutable stores must reuse it rather than create a sibling
  queue implementation.
- Read responses are immutable snapshots. UI state changes only through validated background
  messages and refreshes the affected account/network scope; UI code never reads Chrome storage.
- `storage.onChanged` is not an authority boundary and is currently unnecessary because the
  background is the sole persistent writer. If multiple trusted writers are introduced, add a
  revision/CAS protocol rather than treating change notifications as transactions.
- Price and phishing data are recoverable caches, not authority. They may degrade to stale/empty;
  no cached value may alter signing, permission, or transaction verification policy.

## Review findings and remaining work

Fixed in this change:

- Medium, defense in depth: `storage.local` was not explicitly restricted away from extension
  content-script contexts. No page-reachable storage exploit was identified, but background-only
  ownership is now enforced by the browser as well as by code structure.
- Medium: the initial lockdown was started as an unawaited best-effort side effect, so a privileged
  request could race storage restriction and errors were hidden. Local and session lockdowns are
  now one fail-closed startup gate ahead of session restore, wallet requests, phishing-cache refresh,
  and transaction monitoring.
- Medium, data integrity: activity, allowance, privacy-maturity, and multisig operation records
  validated account and network fields separately but admitted contradictory pairs. One shared
  account/network predicate now rejects those rows, malformed multisig owner ids, and contradictory
  balance, private-state, and approval projections before UI rendering.
- Medium, UX/data consistency: the selected network and encrypted active account live in separate
  stores, so a locked switch or worker stop between writes could project an account from the wrong
  network even though transaction operations chose the correct fallback. All selection mutations
  now share one coordinator and use preference-first ordering. Startup, unlock, and preference
  import reconcile the durable pointer when that network already has an account; passive status
  projects the same network-scoped fallback without extending the unlock session. Reconciliation
  is bound to the authorizing session generation, so stale work cannot clear a replacement unlock.
- Medium, migration robustness: staging cleanup was not read back. A silent backend no-op could
  leave an authenticated stale recovery candidate; cleanup is now verified and fails closed while
  leaving the authoritative primary unchanged and the stage available for a later retry.
- Medium, robustness: decrypted schema migration was returned in memory but not durably persisted
  unless a later mutation happened.
- Security design requirement: Ledger STRK20 had no retained viewing-key model; the new encrypted
  design avoids the sensitive-metadata exposure that public-account placement would create.
- Medium: vault creation reconstructed the current shape in places, making a new field vulnerable
  to being dropped; current-schema mutations now preserve sibling collections and validate writes.
- Medium: schema/KDF reads and writes now share the vault mutation queue and schema commits are
  staged and verified.
- Defense in depth: the source standards scanner now treats `accountSecrets` and `viewingKey` as
  secret-material identifiers, so introducing them in a new file requires explicit boundary review.

Deliberately deferred:

- The Ledger typed-data derivation/provisioning flow, pending the proof obligations above.
- Moving `activeNetworkId` and `activeAccountId` into one atomic encrypted selection record. They
  remain split between preferences and vault for schema compatibility; serialized preference-first
  mutations, startup/unlock/import reconciliation, and network-scoped status projection cover
  interrupted writes, but a future schema may remove the cross-store transaction entirely.
- Persisting the currently open multisig portfolio. The durable multisig and intent state already
  survives restarts; the selected screen is presentation state and safely returns to the active
  signer after a browser/update restart.
- A destructive account-removal feature. When introduced, it must atomically remove signing keys,
  optional secrets, grants, labels/groups, and account-scoped public caches, with migration and
  rollback tests.
