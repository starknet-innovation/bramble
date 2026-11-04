---
layout: default
title: Wallet store architecture
permalink: /wallet-store/
---

# Wallet store architecture and update safety

This document is the reviewed persistence contract for Bramble. It covers the store layout at
the v10 encrypted-vault schema, account identity and scoping, mutation rules, Chrome extension
updates, and the custody boundary for a future Ledger-derived STRK20 viewing key.

Review baseline: `main` at `4bdd457b216e1dd1a07df49db68b62b22675a6d9`; implementation tracked by
[issue #208](https://github.com/starknet-innovation/bramble/issues/208).

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
| `bramble:vault` | `storage.local`, AES-GCM | mnemonic, signing keys, account deployment salts, optional viewing keys, grants | schema v10; account ids unique; strict cross-references; capacity below | fail closed |
| `bramble:vault-migration` | `storage.local`, AES-GCM | temporary full migrated vault | exists only during a verified schema commit | authenticated recovery, then remove |
| `bramble:qsb-journal:<journalId>` | `storage.local`, AES-GCM, same vault passphrase, commit records like the vault's | one QSB account's disclosure journal: allocation high-water mark and vault records (no phrase, no preimage) | journal schema v1; header bound to `accountId` and the random 256-bit `journalId`; 64 records and 256 KiB per journal; 8 accounts | fail closed for that account: not a writer, every allocation and disclosure refused, never recreated empty |
| `bramble:qsb-deposit:<journalId>` | `storage.local`, AES-GCM, same vault passphrase, commit records like the vault's | one QSB account's pending deposits: signed deposit transactions kept before they are sent (public chain data, no key) | record schema v1; header bound to `accountId` and `journalId`; at most 4 deposits of at most 12,000 bytes, 100 KiB per record; created by the first deposit | fail closed for that account: every deposit and resend refused; the listing shows no pending deposit |
| `bramble:vault:commit:<lineage>`, `bramble:vault-migration:commit:<lineage>`, `bramble:qsb-journal:<journalId>:commit:<lineage>`, `bramble:qsb-deposit:<journalId>:commit:<lineage>` | `storage.sync`, plain, trusted contexts only | non-secret commit record that vouches for the current envelope | one per lineage; at most 211 bytes each (see the `storage.sync` budget below) | rollback refused; a missing primary-vault or journal record is restored from the local mirror |
| `bramble:vault:commit:<lineage>`, `bramble:qsb-journal:<journalId>:commit:<lineage>`, `bramble:qsb-deposit:<journalId>:commit:<lineage>` mirror (primary vault, each journal and each pending-deposit record, never staging) | `storage.local`, plain | copy of the `storage.sync` commit record | read only when the `storage.sync` record is missing | fail closed when both are missing |
| `bramble:vault:legacy`, `bramble:qsb-journal:<journalId>:legacy` | `storage.local`, plain | marker that this store has committed a version-3 envelope | one per store | any version-2 envelope after it is a rollback |
| `bramble:vault:recovering` | `storage.local`, plain | lineage of an Unlock anyway write in progress | only while a recovery writes | the next recovery removes the records an interrupted one left |
| `bramble:vault:commit:<lineage>`, `bramble:vault:promoted` shadow, and the same two per journal key | `storage.session`, plain | session copy of the commit record and the last promoted lineage | browser session | a durable record that disagrees is a rollback |
| `bramble:preferences` | `storage.local`, plain | labels, groups, contacts, tokens, networks, watched NFTs | schema v1; deterministic ids and bounded validators | fail closed on invalid root |
| `bramble:activity` | `storage.local`, plain | public transaction history | account + network; 200 entries per scope | discard invalid rows; monotonic status |
| `bramble:relay-signatures` | `storage.local`, plain | OutsideExecution messages signed for relay: origin, message hash, nonce, deadline, call count, chain-read status and check time; no signature or calldata | account + network; 100 total | discard invalid rows; monotonic status (`nonce-used` is final) |
| `bramble:allowances` | `storage.local`, plain | public ERC20 approvals | account + network + token + spender; 200 total | discard invalid rows |
| `bramble:argent-multisigs:v2` | `storage.local`, plain, trusted contexts only | public contracts, frozen transaction intents, exact-hash authorization fragments | network + canonical contract; 20 multisigs / 100 intents (25 per multisig) / 100 operations | discard invalid or orphaned rows; never silently evict active authority |
| `bramble:nostr-coordination:v1` | `storage.local`, plain | relay sync checkpoints: relay selection, last sync time, receipted gift-wrap event ids | multisig account; 20 accounts / 200 event ids each | discard invalid rows; event ids only save repeated work and never decide an import |
| `bramble:nostr-coordination:removed:v1` | `storage.local`, plain | ids of intents the user removed | multisig account; 20 accounts / newest 100 intent ids each | discard invalid rows; relay sync never re-imports a listed intent |
| `bramble:side-panel-learning` | `storage.local`, plain | the side-panel learner's own record: whether this browser draws the side panel (`verified`), or a toolbar click proved it doesn't and a side-panel choice is served as the popup (`unsupported`), plus a one-time notice flag; never the user's request-display choice | one record per install, one writer | discard an invalid record (learn again); an unreadable or unwritable store keeps the built-in behavior |
| `bramble:origin-history` | `storage.local`, plain | first-seen dapp origins | valid HTTPS/localhost origin; 500 origins | discard invalid entries |
| `bramble:prices`, `bramble:charts` | `storage.local`, plain | recoverable market cache | TTL and cache-size bounded | cached-or-empty |
| `bramble:phishing-feed` | `storage.local`, plain | signed/validated blocklist cache | TTL and response bounds | bundled baseline remains active |
| `bramble:analytics-installation-id` | `storage.local`, plain, trusted contexts only | random pseudonymous installation metadata | canonical UUIDv4; independent of accounts, sites, and browser identity | omit analytics on read/write failure; retained while analytics is off |
| `bramble:session` | `storage.session`, plain trusted-context only | unlock passphrase capability | timeout-bound session | cleared on lock/update/browser exit |
| `bramble:strk20-maturity` | `storage.session`, plain | public pending transaction metadata | account + network + pool; 100 records | discard invalid rows |
| QSB coordinator session tokens | worker memory | bearer credential for one account's owner address at the QSB coordinator | per account; at most an hour from its sign-in, less a minute | dropped on lock and worker restart; never persisted, logged or returned |
| approvals, AES keys, selected UI view | worker/page memory | transient authority or presentation state | request/session/view scoped | lost safely on restart |

`storage.local`, `storage.session` and `storage.sync` are locked to trusted extension contexts with
`setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` on Chromium; Firefox has no `setAccessLevel`,
so there `local` and `sync` stay reachable from this extension's own content script.

The commit record lives in `storage.sync` so that restoring an old copy of `storage.local` does not
roll the vault back: `sync` still names the newer commit and refuses the old envelope. `storage.sync`
can also be dropped on its own (a sync-account change, a profile reset, quota eviction), so the primary
vault's record is mirrored in `storage.local` and the mirror is read only when the `sync` record is
missing. The `vault-migration` staging store has no mirror: the wallet removes its `sync` record after
every migration, so a mirror there would let a restored `storage.local` vouch for its own staged copy.
Replaying an old vault therefore takes rolling back `local` and deleting the `sync` record together,
the coordinated rollback of both areas this design already accepts. The version-2 downgrade marker
stays in `storage.local`, because every synced install of the extension shares one `storage.sync`
area and a marker there refused other installs' own vaults; an earlier release's marker in `sync`
is moved to `local` on the next unlock. The cost is that a copy of `storage.local` taken before this
install's version-3 migration (pre-0.9.2) carries no marker, so restoring that copy alone replays its
version-2 vault unless this browser session has already seen a version-3 commit. Chrome documents that local data persists
until extension removal, while session data is cleared when an extension is updated. See the
[Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).

**Vault capacity.** The vault validators apply the provider JSON budget (`JSON_BUDGETS.provider`,
1 MiB with strings charged at six bytes per character) on read as on write, so that budget is the
vault's one capacity. It is shared by accounts, signing keys, imported phrases, retained secrets and
connected sites and QSB account phrases, so it is not an account count: a vault of derived accounts alone holds about 243
(pinned in `vault-capacity.test.ts`). STRK20 shadow-account scope records may use at most half of it
(`SHADOW_ACCOUNT_SCOPES_BUDGET`), so they can never leave the rest of the vault unwritable. `writeVault` refuses the first vault past it with
`Vault storage limit reached` before any storage is touched. Every storage area validates writes
against `JSON_BUDGETS.storage`, which is derived to admit the base64 envelope of anything the provider
budget admits, so storage never refuses a vault its validators accepted; the store still checks the
envelope before writing the pending commit record, so a value storage refuses leaves no half-commit
(Sherlock 261).

**QSB disclosure journals.** A QSB account's vault record holds only account-level data (phrase,
provenance, backup flag, `journalId`); its journal lives under its own key with its own budget, chosen
over compacting retired records inside the vault, because full-size QSB records (scripts up to
10,000 bytes) would fit only about a dozen times in the vault's budget. Each journal is capped at
`QSB_JOURNAL_MAX_BYTES` (256 KiB of plaintext) and `MAX_QSB_VAULTS_PER_ACCOUNT` (64) records, and its
key alone gets the matching at-rest budget (`JSON_BUDGETS.qsbJournalStorage`). The manifest requests no
`unlimitedStorage`, so `storage.local` has Chrome's 10 MiB quota; eight full journals take about
2.8 MB at rest, so they can never crowd out the vault and its migration copy (about 1.4 MB each at
most). Hitting a limit refuses the write; nothing is evicted. Because the phrase and the journal no
longer change in one write, creation writes the empty journal first and the vault account naming it
second; a journal left without an account is an orphan that nothing reads. An account whose journal is
missing, unreadable, invalid, or bound to another account or journal id fails closed, and nothing
recreates an empty journal over a lost one. Creation also checks that the vault will accept the new
account (its capacity and validators) before writing the journal, so a full vault leaves no orphan;
only a vault write that fails in storage can. Journal writes run in the vault's mutation queue and are
durable before any commitment or preimage they authorize is released. No wallet-reset flow exists; if
one is added it should leave `bramble:qsb-journal:*` keys in place, since they hold the only disclosure
history, and a new wallet never binds them because its accounts draw fresh journal ids.

**QSB pending deposits.** A signed deposit is kept before it is sent, so an unknown outcome can only
ever resend the same bytes (qsb-app's pending-deposit rule). Each account's are one record under
`bramble:qsb-deposit:<journalId>`, opened through the same store registry and factory as its journal
(same `storage.local` area, `storage.sync` commit record, session shadow and local mirror, keys dropped
on lock) and written in the vault's mutation queue. The record is bound to its account and journal id
and validated on every read and write; one that is unreadable, invalid or foreign fails closed, so no
deposit or resend runs for that account. Its budget is sized for Bramble's deposits: at most eight
P2WPKH inputs, a 10,000-byte vault script and change make a transaction of at most 11,246 bytes, so a
deposit is capped at 12,000 bytes (24,000 hex digits plus about 110 bytes of fields), four may be
pending at once, and the record is capped at 100 KiB of plaintext (`QSB_DEPOSIT_STORE_MAX_BYTES`),
whose encrypted envelope (about 137 KB) stays inside the provider budget every non-vault key is held
to. A fifth pending deposit is refused (`depositPending`), never evicting one. A deposit stays pending
from just before `fund/submit` until the coordinator answers about this vault and these bytes
(`submitted` naming this txid, or `rejected` with no funding) or `/funding` confirms that txid; any
other answer, a transport failure included, leaves it pending for a resend. Eight full records take
about 1.1 MB at rest, so with eight full journals and the vault and its migration copy `storage.local`
stays under 7 MB of its 10 MiB.

**QSB vault messages.** Five more extension-page-only messages, `wallet.qsbVaults`,
`wallet.createQsbVault`, `wallet.quoteQsbDeposit`, `wallet.depositQsbVault` and
`wallet.resendQsbDeposit`, reach the journal and the pending deposits only through the vault service's
QSB session (`packages/platform/vault/src/service/qsb-vault-access.ts`). A session holds no slot of the
mutation queue: each of its calls (a read, one durable write, one Krusty derivation or signature) takes
one short slot and re-reads and re-validates the account, journal and pending deposits it depends on, so
no coordinator request or Pyodide run ever holds the queue. One account's flows are serialized end to end
by the background's per-account QSB lock instead. The coordinator's origin is not a required host
permission (that would be a privilege increase on update): the user grants `QSB_COORDINATOR_PERMISSION`
at runtime under the optional HTTPS pattern, and the background asks `permissions.contains` before any
coordinator request. Without the grant, create, quote, deposit and resend refuse with `accessNeeded`
before anything is allocated, kept or sent, and the listing answers with the local vaults, `funds` and
`registered` null, asking the coordinator nothing. The session derives the BIP-84 owner key
`m/84'/0'/0'/0/0` through Krusty inside the slot that uses it and hands out public data only. Creation
allocates the vault and records its script durably before anything that names a commitment or the
script is sent; a deposit's bytes are durable before they are submitted; a
funding is recorded only once the chain confirms it. Every reply is built from `QsbVaultView`,
`QsbOwnerFunds` and `QsbDepositQuote`: no phrase, owner key, journal id, coordinator id or token, or
signed bytes. The listing peeks at the session rather than renewing it.

**QSB account messages.** Five extension-page-only messages reach these records, through the vault
service's QSB methods (`packages/platform/vault/src/service/qsb-accounts.ts`), each run in the
mutation queue: `wallet.qsbAccounts`, `wallet.createQsbAccount` (a 24-word phrase from Krusty, unconfirmed),
`wallet.importQsbAccount` (canonical spelling, dedicated, read-only for life), `wallet.confirmQsbBackup`
(three retyped words at distinct positions) and `wallet.revealQsbPhrase`. Every reply is a
`QsbAccountView`, with no phrase and no `journalId`, except the reveal's: the one QSB phrase a message
may carry, after the vault decrypts under the password re-entered in the request, never the session's.
The key-boundary scan sanctions that reveal alone.

**`storage.sync` budget.** Chrome gives `storage.sync` 102,400 bytes in all, 8,192 bytes per item
(key length plus the item's JSON) and 512 items; the wallet keeps only commit records there. A record
is at most 87 bytes of JSON (`current` and `pending` both set, mid-write), so the vault's
`bramble:vault:commit:<lineage>` item is at most 140 bytes, the staging copy's 150 (only during a
migration), and each journal's `bramble:qsb-journal:<journalId>:commit:<lineage>` 211 (a 124-character
key), and each pending-deposit record's `bramble:qsb-deposit:<journalId>:commit:<lineage>` 211 too (its
prefix is as long as the journal's). A journal and a pending-deposit record each keep one lineage for
life, so eight accounts' journals take 1,688 bytes in 8 items and their pending-deposit records another
1,688 in 8, and with the vault and a staged migration everything fits in 3,666 bytes and 18 items: under
4% of the total and 3% of one item's limit. Each orphan journal adds one 211-byte item, which room for
about 467 more covers; a pending-deposit record has no orphans, since only a deposit for an existing
account creates one. Every journal or pending-deposit write is two `storage.sync` writes (pending, then
current), so creating an account costs four of Chrome's 120 per minute and 1,800 per hour, creating a
vault four (allocation, then its script), a deposit four (kept, then released) and recording its
funding two.

## Account identity and first-class behavior

`AccountRef` is a public discriminated union:

- `starknet-bip44`: HD coordinates and full public point; one encrypted signing-key reference.
- `imported-raw-key`: public x-coordinate and one encrypted signing-key reference.
- `ledger`: EIP-2645 account index/path, application marker (`LedgerW` for accounts created here,
  `argentx` for accounts restored from Ready), and public x-coordinate; no signing-key reference.

A Ledger derives a different key per EIP-2645 application, so the marker names which of two path
schemes the stored path follows, and the validator rejects any record whose marker, path, and index
disagree. Bramble's own `LedgerW` scheme is `m/2645'/1195502025'/734980059'/0'/<index>'/0`
(byte-identical to starknet.js `getLedgerPathBuffer221`). Ready's `argentx` scheme is
`m/2645'/1195502025'/1148870696'/0'/0'/<index>`, Ready's `STANDARD_LEDGER_DERIVATION_PATH`
(`1148870696` is the low 31 bits of sha256("argentx")). The "Restore a Ready Ledger account" route
enumerates the device at Ready's scheme, derives the Argent 0.4.0 address Ready itself computes
(salt = public key, no guardian), lists only accounts with on-chain activity as selectable, and
stores that path so signing asks the device for the same key Ready did. Ready numbers a new Ledger
account after every account already in that wallet, so a restored account may sit several pages in.

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
2. Run every adjacent pure migration through `CURRENT_SCHEMA_VERSION` and validate the complete current-schema
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
