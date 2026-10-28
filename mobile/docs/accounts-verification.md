# Accounts — threat model, verification, and scope

Continues [accounts.md](accounts.md) (sections 1-5: the parity target, behaviour, the UniFFI
surface, single-sourced data, and storage). Section numbers carry on from there.

## 6. Threat model

| Threat | Mitigation |
| --- | --- |
| Hostile or faulty RPC hides or invents accounts during discovery | It can only change deployed/funded flags. Addresses are derived locally and re-derived at restore. Responses must answer their ids and are size-bounded. Unexpected errors pause the scan instead of reading as "not deployed". Endpoints are trusted only after `starknet_chainId` proves the chain. |
| Host (compromised UI layer) injects an attacker address as an account | The core never persists a host-supplied address or key. Selections are `(family, index, class)`, and classes come from the generated table only. |
| Tampered vault record redirects receive/copy to another address | Records are AEAD-sealed, and on unlock every phrase record is re-derived and compared (fail closed). |
| Key leakage via krusty discovery helpers (`generate_candidates` holds keys as cloneable `String`s, and uses the wrong path with no passphrase) | Not used. Each index uses `kms::private_key` → `SecretFelt`, then the public key. Only public data leaves the scan. |
| Address poisoning / look-alike truncation | The truncated form is always shown next to the avatar and name. Copy, receive and QR always use the full canonical address. Receive shows it in full. |
| Clipboard exfiltration | iOS `.localOnly` (no Universal Clipboard) with a 120 s expiry. Android clears after 120 s if the clip is still ours. Only public values are ever copied. |
| Privacy: one RPC host sees ~120 addresses from one IP | The screen says so. The user's configured endpoint is used. Scanning happens only when the user asks for it, and the manual index is explicit. |
| Label and group metadata leaking via backups or logs | Sealed in the vault, which is excluded from backup. Never in errors, logs or UserDefaults. XCUITest uses public fixtures only. |
| Accidental restore of the wrong set | Nothing is written until Restore, which needs a selection (the extension dropped its acknowledgement tick, so mobile has none). Rows name each account's type and index, and the restore is one atomic write. |
| Resource exhaustion via manual index or big selections | Index ≤ 0x7fffffff (krusty's unhardened bound). ≤ 40 per restore. Record cap 128. Label ≤ 64. |
| Braavos signing with an unsupported account | The key is shared across families at one index, so a raw-hash signature for index `i` is cryptographically valid for **every** account at that index; a per-index refusal alone cannot stop it. `sign_hash_for_account` refuses unknown ids and pending vaults (since Braavos support, every record passes; what an account may sign is decided on chain by the send plan, `docs/braavos.md`); legacy `sign_hash(i)` signs only when an OZ record exists at `i`. Enforcement rests on the core signing only hashes it can attribute to a non-view-only account; the full fix is core-computed transaction hashes (transactions workstream). §2.7. |
| Signing before discovery finishes | Both signing entry points refuse while `recoveryPending` is set; a pending vault has no records. |
| Network switch leaves no account | `ensure_network_account` keeps, picks or projects, as the extension does, and projects only through local derivation. |
| Phase B private key typed on the device | Secure text entry, no autocorrect or learning (Android `IME_FLAG_NO_PERSONALIZED_LEARNING`). Single inbound crossing. Zeroized into `SecretFelt`. Never returned. Screen covered in the app switcher. |
| Interrupted import leaves an unusable wallet | `recoveryPending` survives lock and kill and routes back to discovery. The restore is one atomic write. |

## 7. Parity fixtures (extension → `mobile/core/tests/fixtures/accounts-parity.json`)

A second fixture beside `extension-parity.json`, computed by `scripts/mobile-parity-accounts.ts`
through the extension's real code, written by `bun run mobile:parity`, and compared in
`bun run check` by `tests/conformance/mobile-accounts-parity.test.ts`:

1. **families**, via `deriveAccount(kms, {accountContractType, classHash, accountIndex,
   networkId, mnemonic})` over the real Krusty WASM package: indices {0, 1, 3, 19} × {SN_MAIN,
   SN_SEPOLIA} × {OZ, argent 0.3.1/0.3.0/0.4.0, braavos 1.0.0/base}, plus one Sepolia index-0 set
   with a BIP-39 passphrase. Each vector records address, publicKeyX, classHash and
   deploymentSalt. Rust restores each set through `restore_recovered_accounts` and compares.
2. **names**: `accountDisplayName` (nickname) and `accountLabel` over edge inputs (0x0, BigInt
   grammar: decimal, `0X`, `0b`, `0o`, whitespace, negative, junk) and real family addresses.
3. **labels**: `isLabel` and the trimmed stored value (JS whitespace, U+FEFF, U+2028, 64/65 units,
   surrogate pairs).
4. **groups**: `createGroup` ids over a name sequence (collisions `-2`/`-3`, fallback "group",
   symbol runs, 64 and 80 characters, blanks).
5. **recovery rows**: `candidateTitle`, `candidateState`, `selectable`, and `recoverySelectionKey`
   for every shape at indices 0 and 3 × {none, funded, deployed}.

Not shipped as fixtures, and covered by Rust unit tests instead: the keep rule
(`isCreatableCandidate` is private to `onboarding-ops.ts`), probe judging, `nextAccountIndex`, and
the onboarding 10…8 preview (an inline expression in `onboarding-ui.ts`). Phase B `keyImports`
waits for Phase B.

## 8. Test plan

**Rust** (`cargo test --locked`, clippy):

- `tests/accounts_parity.rs`: every vector set above. Argent and Braavos addresses come from
  Krusty's `ArgentAccount::try_with_class_hash` / `BraavosAccount::with_class_hash` with
  `SaltPolicy::Explicit(salt)` (default salt = public key); OZ from
  `derive_oz_account_address(.., Some(&Felt::ZERO))`. At runtime the core also refuses a class
  whose Krusty constructor layout disagrees with the extension's `constructorShape`.
- `tests/recovery.rs`: a scripted in-memory responder drives the state machine for 20 indices,
  covering batch sizes, id mismatch, duplicate ids, error pause and retry, a manual index keeping
  `next_index`, fingerprint and network cache invalidation, cache cleared on lock, the 40-selection
  cap, a duplicate selection, an unknown class, a Braavos class that is required, and atomic
  restore (inject a write failure → no records).
- Migration and tamper cases (in `tests/accounts.rs`): a v1 payload sealed through the test hook
  opens as v2 with 2 × N OZ records and is written back; a zero-count v1 is refused; invalid v2
  (address that does not re-derive, bad id, salt on OZ, swapped family, unknown active id,
  pending-with-accounts, label for no account, unknown field, two groups per account, version 3)
  → `Storage`.
- Unit tests in each new module: label trimming, group edits, `display_name`.
- Signing by record (`tests/accounts.rs`, `tests/transactions_plan.rs`): a vault holding OZ,
  Ready and Braavos records at the **same index** — `sign_hash_for_account` signs each id with its index's
  key and refuses every id on a recovery-pending vault (originally it refused Braavos and Ready
  ids; both now sign, judged on chain by the plan); `tests/ffi_surface.rs` fails if an exported function
  signs, plans or reads activity by index (the `sign_hash(index)` shim was removed in the merge).
- Network projection (`tests/accounts.rs`): `ensure_network_account` keeps an on-network active
  account, picks the first record on the target network, and projects OZ (class re-resolved per
  network), Argent 0.3.1 (its class and salt kept) and Braavos; the projection persists across
  lock and unlock.
- Opt-in `tests/mainnet.rs` extension: `BRAMBLE_MOBILE_MAINNET_DISCOVERY=1` plus the existing
  phrase variables. It runs the scan through a blocking HTTP helper that exists only in the test,
  is `#[ignore]` by default, and is refused when `CI` is set. It never prints the phrase.

**Swift unit** (`BrambleTests`):

- Bridge tests for naming, label and truncation against the fixture.
- `Clipboard` sets `.localOnly` and an expiration.
- `RecoveryScanDriver` with a stub transport covers completion, pause, retry and cancel on lock.
- `WalletStore` routing for `recoveryPending`.

**XCUITest** (`BrambleUITests/AccountsTests.swift`, run only on the **"Bramble accounts"** simulator):

```bash
xcrun simctl list devices | grep "Bramble accounts" || xcrun simctl create "Bramble accounts" "iPhone 16"
mobile/scripts/build-core-ios.sh debug && (cd mobile/ios && xcodegen generate)
xcodebuild -project mobile/ios/Bramble.xcodeproj -scheme Bramble \
  -destination 'platform=iOS Simulator,name=Bramble accounts' CODE_SIGNING_ALLOWED=NO test
```

1. Create → the header and drawer show the friendly name from the fixture, never "Account 1".
2. Add account → a new row with the next name; it becomes active.
3. Manage → rename → the header updates, and clearing restores the friendly name. The toasts
   "Label saved" / "Label cleared" appear.
4. Copy on Manage and Receive → "Copied" is shown and the pasteboard holds the full address.
   Drawer rows expose no copy button.
5. Groups: create a group, assign it via the folder picker, check the filter chips and the empty
   state.
6. Import on Sepolia with the published E2E phrase → Find your accounts. The UI test uses a
   stub transport compiled only under `#if DEBUG` and switched on by a launch argument, which
   answers `starknet_chainId` and reports every probed address as undeployed and unfunded, so
   there is no network use. Checks: the index-0 Bramble row is listed but not auto-selected, the
   manual index, a selection being the only restore gate (there is no acknowledgement to tick),
   restore, and kill-before-restore resuming discovery.
7. After import, switch Sepolia → Mainnet: the drawer shows the projected account (same friendly
   name rule, the Mainnet address), never an empty list.

The existing mainnet UI suite keeps passing. Its README instructions, which name the "iPhone 16"
device, are not changed by this workstream.

**Android** (Kotlin against the generated bindings, **uncompiled** because there is no SDK on this
machine): the drawer, manage and discovery screens, and `Clipboard.kt`. This is stated in the PR.

## 9. Delivery phases

- **A (this branch, implemented):** generated `accounts.json` plus the extension exports; naming
  and truncation; vault v2 plus migration; signing by record; the network switch; drawer, groups
  and Manage; `CopyButton` and `Clipboard`; Regular add; discovery and restore; both fixtures;
  Rust, Swift unit and XCUITest coverage; Android sources (uncompiled).
- **B (follow-up in this workstream):** private-key import with the Bramble/Ready choice and salt.
  It is blocked on a SCOPE.md amendment allowing one inbound private-key crossing, which the user
  or maintainers must approve.
- **Implementation notes (Decisions made while building A):**
  - `create_wallet(password, words)` keeps its signature and places the first account on Mainnet
    (the extension's `DEFAULT_NETWORK`); hosts call `create_wallet_on_network` with the selected
    network, as iOS and Android now do.
  - "Find your accounts" has no "Back to passphrase": mobile seals the vault (recovery pending) at
    the passphrase step, so there is no earlier step to return to; a kill or lock resumes here.
  - Group slugs are trimmed again after the 64-character cut, so a dash at position 64 cannot
    produce an id the validator refuses (the extension keeps it and then fails its own check).
  - Debug builds accept `-BrambleUITestStubRpc` (local undeployed/unfunded node for discovery) and
    `-BrambleUITestReset` (empty vault directory at launch) for the UI suites; release builds
    compile neither.

## 10. Out of scope, deferred, or blocked on krusty-kms

- **Out of scope:** multisig accounts (nostr-multisig), sending and deploy-account
  (transactions), Ledger, in-wallet "Import a recovery phrase" (multi-seed `seedId`), Braavos
  signing, biometrics and back-off (vault-security), activity and dollar values
  (portfolio-activity).
- **krusty-kms#146 (curated class table):** krusty 0.11.0 lacks the Braavos base
  `0x13bfe114…a8e6` and the current `0x3957f9f5…bf8a` classes, and has no roles or authorization
  shapes. Its `BraavosAccount::CLASS_HASH` is the extension's "1.0.0". Until #146 ships, the
  table comes from the extension's TypeScript via `mobile:assets`, with no Rust copy.
  **Address math needs no upstream change:** `calculate_contract_address`, `ArgentAccount`,
  `BraavosAccount::with_class_hash` and `SaltPolicy` are public in 0.11.0.
- **Not used from krusty:** `discovery::generate_candidates` / `derive_discovery_keypairs`. They
  use the wrong path (`m/44'/9004'/0'/0/i`), take no passphrase, cover a different class set, and
  hold keys in `String`. `krusty-kms-client` discovery is networked (tokio/reqwest), which breaks
  sans-IO. A proposed upstream change is a passphrase-aware, account-index,
  caller-chosen-class candidate API returning only public data, so both wallets could share it.
- **Performance note:** every krusty derive call re-runs BIP-39 PBKDF2, and derivation from a seed
  is private. A 20-index scan is 20 seed derivations, which is acceptable. A public
  derive-from-seed API would be the upstream fix if the scan is slow on older devices.
- **Devnet:** krusty's `ChainId` has no devnet, and the extension hardcodes the devnet OZ class.
  Mobile supports only Mainnet and Sepolia, so nothing changes.
- **Open decisions for the user:** (1) Ready via Regular add, which the extension does not offer;
  (2) copy on the header and drawer rows, which the extension deliberately omits; (3) the Phase B
  inbound private-key amendment.

## 11. The merged vault migration chain

Both branches minted a "version 2" from the original v1, so the merge defines one chain over
every vault ever written, with exactly one adjacent step per version, as the extension's
`schema/migrations.ts` does:

| Version | On disk | Payload | Written by |
| --- | --- | --- | --- |
| 1 | bare envelope, scope `bramble.mobile.vault.v1` | `accountCount` | the original core (660a538e) |
| 2 | DEK container, `version: 2` | `accountCount` (payload `version: 2`) | vault-security |
| 2 | bare envelope, scope `bramble.mobile.vault.v1` | records (payload `version: 2`) | the accounts branch before the merge |
| 3 | DEK container, `version: 3` | records (payload `version: 3`) | the accounts merge |
| 4 | DEK container, `version: 4` | records and `backupPending` (payload `version: 4`) | this core |

`VAULT_MIGRATIONS = [(1, v1_to_v2), (2, v2_to_v3), (3, v3_to_v4)]`:

- **1 → 2** (vault-security's step): the same account count, phrase and passphrase, re-tagged.
  The move from the bare envelope into a DEK container happens when the migrated payload is
  sealed.
- **2 → 3** (this workstream's step, renumbered from its branch's 1 → 2 as §5 planned): a count
  payload becomes records, one OZ record per index `0..count` on every network in
  `supported_networks()` order, Mainnet index 0 active, no labels or groups; the accounts
  branch's records payload is already that shape and is only re-tagged. Both results are then
  validated in full, re-deriving every record from the phrase.
- **3 → 4** (the backup-pending flow, `src/backup.rs`): records gain `backupPending: false`. A
  version-3 wallet predates the flag, so whether its backup was confirmed is unknown; it is
  recorded as not pending, which keeps its behaviour unchanged. A created wallet is written
  with `backupPending: true` and cleared by `confirm_backup`; an import writes `false`. The
  field is refused before version 4 and required from 4 on.

The steps are pure functions of the decrypted payload. The layout is decided around them:

- A bare envelope (versions 1 and accounts' 2) opens only with the passphrase; its payload is
  migrated and sealed into a **new** DEK container at the current version (fresh DEK, the same lineage, the
  passphrase slot at today's KDF strength), proven to round-trip, and written atomically. A
  failed write keeps the old file and commits the new one on the next payload write.
- A version-2 or version-3 container is migrated **in place**: the payload is re-sealed under the same DEK
  with a fresh IV and commit, and the passphrase and biometric slots are kept byte for byte. It
  needs no KDF, so a biometric unlock of an older container migrates it too.
- Each layout accepts only what it was ever written with: an envelope holds a v1 count payload or
  a v2 records payload; a version-2 container a v2 count payload; a version-3 container a v3
  records payload; a version-4 container a v4 records payload. Anything else, including a
  version below 1 or above 4, fails closed as
  `Storage("vault payload is invalid")` and leaves the file untouched.

Tests: `src/migrations_tests.rs` (adjacency, determinism against a golden file, each shape,
layout rules, invalid payloads) and `tests/migration.rs`, which opens a vault file written by
each branch's own core: `vault-v1.json` (original), `vault-v2-container.json` (vault-security,
with a biometric slot) and `vault-v2-records.json` (the accounts branch: OZ, Ready and Braavos
records, a label, a group, a projected Mainnet account); and `tests/backup_pending.rs` opens
`vault-v3-container.json` (the version-3 core: two OZ records and a biometric slot).
