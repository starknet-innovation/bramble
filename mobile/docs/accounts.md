# Accounts — mobile design

Status: design for the `mobile/accounts` workstream (2026-09-24), written against worktree HEAD
`660a538e`, revised after review (signing by record, network projection, the restore
acknowledgement, and the clipboard amendment). Phase A is implemented on `mobile/accounts`.
Read with [../SCOPE.md](../SCOPE.md).

Aim: close the account-management gaps between the mobile apps and the extension. That covers
naming, discovery on import, adding accounts, the drawer and groups, and address truncation and
copy. Every rule below comes from the extension's sources, which are named next to it. Wherever
the workstream brief and the extension disagree, this document follows the extension and marks
the difference with **Decision**.

## 1. What the extension actually does (the parity target)

| Topic | Extension rule | Source |
| --- | --- | --- |
| Display name | `preferences.accountLabels[id]`, else `friendlyAccountName(address)` = `ADJ[a mod 30] + " " + ANIMAL[(a div 131) mod 30]`, where `a = BigInt(address)` (0 if it doesn't parse). `0x0` gives "Amber Otter". There is no "Account N" name anywhere. | `wallet-ui/src/sidepanel/shared/parts.ts:193-295` |
| Family name | openzeppelin → "Bramble", argent → "Ready", braavos → "Braavos" | `shell/account-types.ts` |
| Label rules | Keyed by `"<networkId>:<canonical address>"`. The label is trimmed. Empty clears it. Otherwise it must be 1-64 characters (JS/UTF-16 length) or "Invalid account label". Labels are kept in plain preferences, not in the vault. | `features/settings/src/preferences.ts:116-135,345-360`; `wallet-model/src/preferences/preferences.ts` |
| Truncation | `accountLabel = shortAddress = a.slice(0,6) + "…" + a.slice(-4)` (U+2026), applied to the canonical address. The full address goes in `title`. Onboarding preview only: `slice(0,10) + "…" + slice(-8)`. | `parts.ts:157-160`; `onboarding-ui.ts:427` |
| Copy | Writes the full value. Shows "Copied" in the section's status line, or else a toast that lasts 3200 ms. The icon becomes a check for 1400 ms. Failure shows "Copy failed" (error toast, 8000 ms). | `shared/dom.ts:63,242-293` |
| Where copy exists | Manage accounts & groups (inline copy on each row, plus a receipt with Copy address / signer public key / class hash), Receive (full address plus the "Copy address" button), deploy review, approvals | `app/screens/flows.ts:280-397`; `send/receive-view.ts` |
| Where copy is deliberately absent | Drawer rows (the row is the switch control) and the header | `shell/account-drawer.ts:1-17`; `sidepanel-copy-affordance.test.ts` |
| Add account | Opens the chooser "Add a new account". "Regular account" always adds **OpenZeppelin** at `nextAccountIndex`, the lowest unused `starknet-bip44` index on this network for this seed. Duplicate id → "Account already exists". The new account becomes active. Toast: "Account added". | `service-creation.ts:65-90`; `vault/src/accounts/accounts.ts:361` |
| Ready/Argent | The UI offers Ready only through **private-key import** (contract choice plus an optional salt) or through recovery discovery. It never creates Ready from the phrase. Braavos is never creatable; recovered Braavos accounts are "view only for now". | `settings/import-key-ui.ts`; `onboarding/import-key-ui.ts:80-110` |
| Discovery | Indices 0-19 in batches of 4. Each index has 6 shapes: OZ, argent 0.3.1/0.3.0/0.4.0, braavos 1.0.0/base. Probe: `starknet_getClassHashAt` at `latest`. Only code 20 or /contract not found/i means "not deployed"; any other error propagates. If not deployed, `balanceOf` is read for the network's default ETH and STRK. Keep = deployed ∨ funded ∨ (creatable ∧ (index 0 ∨ manual)). Selectable = OZ ∨ deployed ∨ funded. Auto-selection caps at 40. Manual index 0..0x7fffffff. | `onboarding-ops.ts:46-190`; `wallet-model/src/accounts/recovery.ts` |
| Restore | 1-40 selections, all distinct by `type:class:index`. Every selection is re-derived through Krusty, and derived addresses must be unique. The set is committed atomically. The first selection becomes active. | `vault/src/service/recovery.ts` |
| Groups | `{id, name, icon, accountIds}`. Name 1-64 characters. Id = slug. Icon from `GROUP_ICONS` (18). An account is in at most one group. **There are no default groups**: "Operations" and "Long term" are ui-lab fixtures. | `features/settings/src/groups.ts`; `ui-lab/src/fixtures/journey-fixtures.ts:41-54` |
| Network switch | One `activeAccountId` for the whole vault. Switching network keeps the active account if it is on the target network, else takes the first account there, else projects the active account (same family, `accountIndex`, class for non-OZ, salt) onto the target network, stores it and makes it active. | `runtime/runtime-state.ts:125-132,280-307`; `vault/src/accounts/network-account.ts`; `vault/src/service/service.ts:119-150` |
| Signing key | One key per index for every family: `m/44'/9004'/i'/0/0`. OZ, Argent and Braavos records at index `i` share it. | `vault/src/accounts/accounts.ts` (`deriveAccount`); mobile `kms.rs::private_key` |

## 2. User-visible behaviour, screen by screen

### 2.1 Header (`WalletShell.swift`, `.account-network-label`)

- Replace `"Account \(index + 1)"` with the core's `display_name`. The header keeps avatar, name,
  chevron, network and the explorer link.
- **Decision (parity):** no address text and no copy in the header, as in the extension. The brief
  lists the header as a copy site. The extension deliberately has none, and the copy-affordance
  test exempts it, so mobile matches the extension. Copy is one tap away in Manage and Receive.

### 2.2 Account drawer (`AccountsSheet.swift` ↔ `shell/account-drawer.ts`)

- Header: title "Accounts", network name under it, close button labelled "Close accounts".
- Filter chips appear only when at least one group exists: "All" (wallet icon), then one chip per
  group with its icon. The selected chip has the accessibility trait `.isSelected`, matching the
  extension's `aria-pressed`. Choosing a chip limits the list to that group's `accountIds`.
- Rows show only this network's accounts: avatar, display name, `account_label(address)` in mono.
  The full address is the accessibility value; in the extension it is `title`. The active row uses
  accent-soft and a trailing check. Tapping a row switches account and closes the drawer.
- Each row has a ghost folder button showing the group's icon, or `folder` when the account has no
  group. Its accessibility label is "Folder: <name>" or "No folder — choose one". It opens a
  single-select picker listing the groups plus "None".
- **Decision (parity):** drawer rows have **no copy button**, as in the extension.
- Empty states, verbatim: "No accounts in this group yet. Open an account's folder button to add
  it." / "No accounts on this network yet. Add one below."
- Footer: secondary "Add account" (plus icon) and the menu row "Manage accounts & groups" (settings
  icon).
- Multisig rows are left out here. The nostr-multisig workstream owns them, so the row list stays
  a simple `ForEach` they can append to.

### 2.3 Add account chooser (`flows.ts:201-245`, "Add a new account")

| Option | Mobile |
| --- | --- |
| Regular account: "Create the next account from this wallet's recovery phrase." | **Yes.** OZ at `next_account_index(network)`, set active, toast "Account added". |
| Ledger account / Restore a Ready Ledger account | Hidden (Ledger over BLE is Phase 2, out of scope). |
| Multisig account | Slot left for the nostr-multisig workstream; hidden here. |
| Import an existing account → Private key | **Phase B of this workstream** (§2.6): Bramble/Ready contract choice plus the Ready salt. |
| Import an existing account → Recovery phrase | Out of scope: needs multi-seed vaults (`seedId`). |

**Decision (Ready/Argent creation):** the brief asks for "Ready/Argent with its account-contract
choice" under Add account. The extension does not offer that: its background accepts
`addAccount('argent')`, but no UI sends it. Mobile offers Ready the way the extension does:

1. Recovery discovery restores existing Ready accounts (0.4.0, 0.3.1 and 0.3.0). This is Phase A.
2. Private-key import with the "Ready Account" contract choice and the optional salt. This is
   Phase B.

Adding "Ready account" as a Regular option would diverge from the extension and needs an
extension-side decision first.

### 2.4 Manage accounts & groups (new `AccountsManageView.swift`, view "account", title "Accounts & groups")

- **Active account** section (`#label-form`): a "Name" field (at most 64 characters). Its
  placeholder is the truncated address and its hint is "Shown instead of the address. Leave empty
  to clear.". The button is "Save name". Toasts: "Label saved" / "Label cleared" / "Label update
  failed".
- Receipt: "Copy address", "Copy signer public key", "Copy class hash". Each value is truncated
  with `account_label` and copies the full value. Family and class are shown as the
  `knownAccountType` label, e.g. "Ready Account (Argent 0.3.1)".
- The account list has an inline ghost copy button on each row, labelled "Copy <name> address".
- Groups section: create a group (name plus an icon picked from `GROUP_ICONS`), rename, change icon,
  delete. Membership is set with the drawer's folder picker. Before building this section, read
  `group-members.ts` and `group-ui.ts` in full; the research did not cover them.
- "Add account" (`#new-account`) opens the same chooser.

Copying the signer public key and the class hash needs the SCOPE.md clipboard amendment in §2.8,
which this workstream makes.

### 2.5 Receive (`ReceiveView.swift`)

This screen already matches: it shows the full address and a primary "Copy address" button. As in
the extension, the signer public key is **not** a top-level row: it sits inside the collapsed
"Wallet identity" disclosure ("Signer and coordination keys", `receive-view.ts:152-176`), truncated
with `account_label`, with its own "Copy signer public key" button. The coordination (Nostr) key
row and the contact card belong to the nostr-multisig workstream and are left out here. Copy
feedback moves to the shared `CopyButton` (§2.8).

### 2.6 Onboarding

**Create.** The review step's label becomes "Primary Bramble account". The preview address uses
`account_preview_label` (10…8). The account is OZ index 0 on the selected network.

**Import.** The route becomes
`recovery phrase → passphrase (vault written, recovery pending) → Find your accounts → all set`.
The "Review discovered accounts" and "Confirm recovered accounts" names in the brief are ui-lab
checkpoint labels. The rendered step is `recovery-accounts`:

- Back button "Back to passphrase". Title "Find your accounts". Lede "Bramble checks the first 20
  account indices for Bramble, Ready, and Braavos accounts. Accounts with on-chain activity are
  selected automatically."
- Status line: "Ready to search." → "Searching every account type…" → "Checked N of 20 indices…"
  → "Search complete. Checked N indices across every account type." On error: "Account search
  paused. Check the network and retry." A refresh icon button is labelled "Retry account search".
- Three disclosures: "Bramble accounts", "Ready accounts", "Braavos accounts". Each shows "N
  account(s) detected" and opens automatically the first time it has a detected account. Rows are
  sorted by index. A row has a checkbox, the title "Account <index>" (0-based; Argent classes
  other than 0.4.0 add " · Argent 0.3.1"), `account_label` in mono, and the hint strings from
  `recovery-account-ui.ts`, reproduced verbatim through the core (`RecoveryCandidate.hint`).
- The "Advanced manual index" disclosure holds an "Account index" field and a "Check this index"
  button. An invalid index shows the toast "Enter a valid non-negative account index".
- On **every** network, a checkbox reading "I checked these account types and indices and want to
  restore the selected accounts on Starknet Mainnet." This is the extension's text verbatim, even
  on Sepolia: `recoveryScanFields` always renders `recoveryMainnetAck`
  (`onboarding-views.ts:365-370`), and `refreshGate` in `recovery-account-ui.ts` requires it on
  every network (it does not use `mainnetAckSatisfied`). Mobile matches that.
- The CTA "Restore selected accounts" is enabled only when at least 1 row is selected **and** the
  box is checked, on every network. A new search unchecks it again (`start()` resets it). A
  selection over 40 shows the toast "Choose at most 40 accounts.
  Uncheck one to add another." While restoring, the status reads "Restoring the selected accounts
  into your encrypted vault…". Afterwards the toast reads "N account(s) restored", or "Account
  recovery failed" on error.
- The screen states that the search queries the configured RPC endpoint (privacy, §5).

If the app locks or is killed before restore, unlocking a vault with `recovery_pending` routes
straight back to "Find your accounts". There is no way into the wallet with zero accounts.

**Phase B, private-key import.** The "Account contract" choice offers "Bramble Account —
Recommended" or "Ready Account", with the hint "Choose the contract that already owns this key. A
different choice derives a different address." The field "Ready deployment salt (optional)" is
disabled and cleared unless Ready is chosen, and carries the extension's hint verbatim. The toast
reads "Account imported".

### 2.7 Braavos

Recovered Braavos rows can be restored and are displayed, but they are **view-only**. The hint
says "· view only for now", and the header and Manage views show the "Braavos Account" type. This
matches the extension's current state.

What "view-only" can and cannot mean is limited by the key layout. Every family at index `i` uses
the same key, `m/44'/9004'/i'/0/0` (§1). A raw-hash signature made for index `i` is therefore a
valid owner signature for **every** account at that index, the Braavos one included. A refusal
keyed only by index cannot stop that. The core enforces view-only in the only way it can:

- `sign_hash_for_account(account_id, hash)` looks the record up and refuses a `view_only` record
  and any vault with `recovery_pending`. It then derives from the record's `account_index`.
- The legacy `sign_hash(index, hash)` signs only when an **OpenZeppelin** record exists at that
  index (on either network) and recovery is not pending. It refuses every other index, including
  indices that hold only Argent or Braavos records. This replaces the old
  `account_index >= account_count` guard.
- **Residual risk (documented, not solved here):** a host that holds a signable OZ record at index
  `i` can still ask for a signature over a Braavos transaction hash for the account at index `i`,
  because the core cannot see what the hash commits to. Closing that needs the core to compute
  the hashes it signs (the transactions workstream, `compute_invoke_v3_hash` over a
  core-validated request) and to bind them to the record's address. Until then, view-only is a
  UI and API guarantee, not a cryptographic one.

### 2.8 Copy affordance (new `DesignSystem/CopyButton.swift`, `App/Clipboard.swift`)

- **SCOPE.md amendment (made in this workstream):** the clipboard line changes from "Addresses
  only" to "Public identifiers only (account address, signer public key, class hash)". The
  local-only and 120 s expiry rules are unchanged. Nothing secret is ever copied: not the phrase,
  a private key, or a viewing key.
- iOS: `UIPasteboard.general.setItems([[UTType.plainText.identifier: value]], options:
  [.localOnly: true, .expirationDate: now + 120 s])`. This is mobile policy (SCOPE.md) and is
  stricter than the extension. It copies the full canonical value, never the truncated text.
- Feedback: "Copied" goes to the section's status line if it has one, otherwise a toast for
  `SUCCESS_TOAST_MS`. The icon swaps to `check` for `COPY_CONFIRM_MS`. Failure shows "Copy
  failed". Both timings are generated from `dom.ts` into `generated/accounts.json` (§4) and read
  through the core's `copy_feedback()`. Neither is typed by hand.
- Android (uncompiled): `ClipboardManager.setPrimaryClip`, then `clearPrimaryClip()` after
  120 s, and only if the current clip is still ours (compared by a label nonce). On API 33+ the
  system already shows a copy confirmation, so the app shows no toast there.

## 3. UniFFI surface

New logic goes in new files: `account_classes.rs`, `account_names.rs`, `account_store.rs` (the v2
payload and migration), `recovery.rs` (scan state machine and probes), `groups.rs`, and
`wallet_accounts.rs`, a second `#[uniffi::export] impl WalletCore` block. `lib.rs` only gains `mod`
lines and `pub use` lines.

### 3.1 Types

```rust
#[derive(uniffi::Enum)] pub enum AccountFamily { OpenZeppelin, Argent, Braavos }

#[derive(uniffi::Record)] pub struct AccountClassInfo {        // generated table, read-only
    pub family: AccountFamily, pub class_hash: String, pub label: String,   // knownAccountType
    pub release: String, pub deployment: bool, pub implementation: bool }

#[derive(uniffi::Record)] pub struct AccountRecord {           // public; safe to render
    pub id: String,                  // "<SN_MAIN|SN_SEPOLIA>:<canonical address>"
    pub network: NetworkId, pub family: AccountFamily, pub class_hash: String,
    pub account_index: u32,          // Phase B private-key imports will make this optional
    pub address: String, pub public_key: String,
    pub deployment_salt: Option<String>,   // Some for argent/braavos, None for OZ
    pub label: Option<String>, pub display_name: String, pub short_address: String,
    pub type_label: Option<String>,        // knownAccountType; None for an unknown class
    pub authorization_shape: String,       // "stark-pair" | "argent-signer-array"
    pub group_id: Option<String>,
    pub view_only: bool, pub active: bool }

#[derive(uniffi::Record)] pub struct AccountGroup { pub id: String, pub name: String,
    pub icon: String, pub account_ids: Vec<String> }

#[derive(uniffi::Record)] pub struct RpcRequest  { pub id: u64, pub body: String }
#[derive(uniffi::Record)] pub struct RpcResponse { pub id: u64, pub body: String }

#[derive(uniffi::Record)] pub struct RecoveryCandidate {
    pub key: String,                 // recoverySelectionKey: "type:class|default:index"
    pub family: AccountFamily, pub class_hash: String, pub account_index: u32,
    pub address: String, pub short_address: String, pub title: String, pub hint: String,
    pub deployed: bool, pub funded: bool, pub selectable: bool,
    pub auto_select: bool }
// `already_in_wallet` is dropped: discovery runs only on a recovery-pending vault, which holds no
// accounts. It returns with the in-wallet phrase import (multi-seed, out of scope).

#[derive(uniffi::Record)] pub struct RecoveryScanStep {
    pub requests: Vec<RpcRequest>,   // empty ⇒ this batch is judged
    pub candidates: Vec<RecoveryCandidate>, pub checked: u32, pub next_index: u32,
    pub complete: bool, pub status: String }

#[derive(uniffi::Record)] pub struct RecoverySelection {
    pub family: AccountFamily, pub account_index: u32, pub class_hash: Option<String> }
```

`AccountInfo`, `accounts()` and `sign_hash(index)` stay as a **deprecated OZ-only shim** so other
branches keep compiling without mis-signing:

- `accounts(network)` returns only the **OpenZeppelin** records on that network, as `AccountInfo`
  with `index = account_index`. An OZ index is unique per network, so no two rows share an
  `index`, and no Argent or Braavos record can be mistaken for OZ. (Argent 0.4.0 needs the
  `argent-signer-array` authorization, not OZ's `stark-pair`; `authorizationShape` in
  `account-families.ts`.) A recovery-pending vault returns `[]`.
- `sign_hash(index, hash)` signs only when an OZ record exists at `index` and recovery is not
  pending (§2.7).
- New code uses `account_records()` and `sign_hash_for_account()`. The shim is removed once the
  transactions and portfolio branches migrate.

### 3.2 Free functions (pure presentation, no session)

```rust
#[uniffi::export] pub fn friendly_account_name(address: String) -> String;
#[uniffi::export] pub fn account_display_name(address: String, label: Option<String>) -> String;
#[uniffi::export] pub fn account_label(address: String) -> String;          // 6…4
#[uniffi::export] pub fn account_preview_label(address: String) -> String;  // 10…8, onboarding
#[uniffi::export] pub fn is_account_label(label: String) -> bool;           // trimmed 1..=64 UTF-16
#[uniffi::export] pub fn account_family_name(family: AccountFamily) -> String;
#[uniffi::export] pub fn account_classes() -> Vec<AccountClassInfo>;
#[uniffi::export] pub fn group_icons() -> Vec<String>;
#[uniffi::export] pub fn copy_feedback() -> CopyFeedback;      // { confirm_ms, success_toast_ms, error_toast_ms }
#[uniffi::export] pub fn recovery_limits() -> RecoveryLimits;  // RECOVERY_SCAN_LIMITS
```

### 3.3 `WalletCore` methods (need an unlocked session)

```rust
pub fn account_records(&self, network: NetworkId) -> Result<Vec<AccountRecord>, CoreError>;
pub fn all_account_records(&self) -> Result<Vec<AccountRecord>, CoreError>;   // groups editor spans networks
pub fn active_account(&self) -> Result<Option<AccountRecord>, CoreError>;
pub fn select_account(&self, account_id: String) -> Result<(), CoreError>;
/// Network switch: mirrors `accountForNetwork` + `ensureNetworkAccount` (§1). Keeps the active
/// account if it is on `network`, else selects the first record there, else projects the active
/// record (same family, index, class for non-OZ, salt) and stores it atomically. None only for an
/// empty or recovery-pending vault.
pub fn ensure_network_account(&self, network: NetworkId) -> Result<Option<AccountRecord>, CoreError>;
pub fn add_regular_account(&self, network: NetworkId) -> Result<AccountRecord, CoreError>;
/// Signs for one record: refuses view-only records and a recovery-pending vault (§2.7).
pub fn sign_hash_for_account(&self, account_id: String, message_hash: String) -> Result<StarkSignature, CoreError>;
pub fn set_account_label(&self, account_id: String, label: String) -> Result<Option<String>, CoreError>;
pub fn account_groups(&self) -> Result<Vec<AccountGroup>, CoreError>;
pub fn create_account_group(&self, name: String, icon: String) -> Result<AccountGroup, CoreError>;
pub fn update_account_group(&self, group_id: String, name: String, icon: String) -> Result<AccountGroup, CoreError>;
pub fn delete_account_group(&self, group_id: String) -> Result<(), CoreError>;
pub fn set_account_group(&self, account_id: String, group_id: Option<String>) -> Result<(), CoreError>;
pub fn recovery_pending(&self) -> Result<bool, CoreError>;

// Discovery: a sans-IO state machine held in the session, never persisted.
pub fn recovery_scan_next(&self, network: NetworkId, manual_index: Option<u32>) -> Result<RecoveryScanStep, CoreError>;
pub fn recovery_scan_submit(&self, responses: Vec<RpcResponse>) -> Result<RecoveryScanStep, CoreError>;
pub fn recovery_scan_reset(&self);
pub fn restore_recovered_accounts(&self, network: NetworkId, selections: Vec<RecoverySelection>) -> Result<Vec<AccountRecord>, CoreError>;

// Phase B only; needs the SCOPE.md amendment in §5.
pub fn import_private_key_account(&self, network: NetworkId, private_key: String,
    family: AccountFamily, deployment_salt: Option<String>) -> Result<AccountRecord, CoreError>;
```

`add_account(network)` stays in place as a thin alias of `add_regular_account` that returns
`AccountInfo`, so other branches keep compiling. It is to be removed once they migrate.

**Scan protocol.** The host calls `recovery_scan_next`. The core derives the batch's indices and
returns one `starknet_getClassHashAt(addr, "latest")` body per candidate, with fresh ids. The host
POSTs them (bounded concurrency, through the chain-verified `RpcClient`) and passes the bodies to
`recovery_scan_submit`. The core judges each body:

- a felt result means deployed;
- code 20 or /contract not found/i means not deployed;
- anything else, or a missing or duplicate id, fails the batch with
  `CoreError::Rpc { reason: "account search paused" }`.

For candidates that are not deployed, the core returns `balanceOf` bodies for every default token
of the network (the extension reads `defaultWalletPreferences().tokens` for that network; mobile
reads the same list from `networks.json`), through the existing
`rpc::balance_of_request`/`parse_balance_of`. When
`requests` comes back empty, the batch is done. The host calls `recovery_scan_next` again until
`complete`. A failed batch leaves `next_index` where it was, so the retry re-issues the same
batch. The scan cache is keyed by (fingerprint = OZ index-0 address, network) as in
`recovery-cache.ts`. It lives only in the `Session` and is dropped on `lock()`.

**Restore.** The core accepts only `(family, account_index, class_hash?)`. It:

- re-derives each address from the phrase;
- validates the class against the generated deployment classes (absent for OZ, optional for
  Argent meaning 0.4.0, required for Braavos);
- rejects duplicates, fewer than 1 or more than 40 selections, and duplicate derived addresses;
- writes all records in one atomic vault write, sets the first as active and clears
  `recovery_pending`.

**The host never supplies an address or public key that the core then persists.**

### 3.4 What never crosses the boundary

- Outbound, never: private keys, the phrase (except SCOPE's two existing paths), the BIP-39
  passphrase, the vault key, the scan's derived keys, the imported private key.
- Inbound, never: addresses or public keys to be stored, class hashes outside the generated table,
  or an account "index" for an imported key.
- Phase B adds exactly one new *inbound* secret: the typed private key, consumed once into
  `SecretFelt` and sealed. It is never returned and never echoed in errors.
- Errors stay input-free: labels and group names never appear in `CoreError` text.

## 4. Single-sourced data (generated, not restated)

`scripts/mobile-assets/` gains a renderer for `mobile/core/generated/accounts.json`, emitted by
`bun run mobile:assets`, byte-compared in `bun run check`, and `include_str!`'d by the core. It
holds:

- `ACCOUNT_CLASSES` from `wallet-model/src/accounts/account-families.ts`: family, hash, release,
  roles, constructor shape. This stands in for krusty-kms#146 until it ships.
- `knownAccountType` labels and `accountFamilyName` from `shell/account-types.ts`.
- `NAME_ADJECTIVES` and `NAME_ANIMALS` from `parts.ts`, and `GROUP_ICONS` plus the group name and
  id limits from `features/settings/src/groups.ts`.
- `RECOVERY_SCAN_LIMITS` (batch 4, count 20, max 0x7fffffff, selections 40).
- `SUCCESS_TOAST_MS`, `ERROR_TOAST_MS` and the 1400 ms copy confirmation (`COPY_CONFIRM_MS`).
  They go here rather than into `BrambleTokens.generated.{swift,kt}` so this workstream does not
  edit the token renderers the design-mobile workstream owns.

The recovery row titles and hints (`candidateTitle`, `candidateState`, `selectable`) are written in
Rust and pinned by the parity fixture (§7, in accounts-verification.md), which runs the extension's own functions over every
(family, class, deployed, funded) combination.

**Required extension edit (additive, outside `mobile/`):** `NAME_ADJECTIVES`, `NAME_ANIMALS`,
`SUCCESS_TOAST_MS`, `ERROR_TOAST_MS`, the 1400 ms literal, and the recovery row helpers are
module-private today. They need `export` (the literal becomes the named constant
`COPY_CONFIRM_MS`) so the generator and the parity script can import them. Behaviour does not
change; the owning tests still pass.

## 5. Storage and migration

The payload moves from v1 to **v2**. It stays inside the same `EncryptedEnvelope`, with the same
scope string `bramble.mobile.vault.v1`: the scope names the envelope's purpose, and the payload
`version` carries the schema.

```json
{ "version": 2, "mnemonic": "…", "mnemonicPassphrase": null, "recoveryPending": false,
  "accounts": [{ "id": "SN_MAIN:0x…", "network": "SN_MAIN", "family": "openzeppelin",
                 "classHash": "0x…", "accountIndex": 0, "deploymentSalt": null,
                 "address": "0x…", "publicKey": "0x…" }],
  "activeAccountId": "SN_MAIN:0x…",
  "labels": { "SN_MAIN:0x…": "Savings" },
  "groups": [{ "id": "long-term", "name": "Long term", "icon": "piggyBank", "accountIds": [] }] }
```

**One `activeAccountId`, as the extension keeps.** An earlier draft used a per-network map. It is
dropped: the extension's network switch (§1) already answers "which account on this network" by
keeping, picking or projecting, so a second selection state per network would only disagree with
it. The host calls `ensure_network_account(network)` on unlock and on every network switch.
`importedKeys` is added with Phase B, not before, so `deny_unknown_fields` keeps refusing it.

- `deny_unknown_fields` stays, and every field is validated on open. An `id` must equal
  `network:canonical(address)`. The salt is present exactly for Argent and Braavos. The class must
  be a deployment class of its family. Labels must pass `is_account_label`. Group invariants come
  from `groups.ts`: one group per account, unique ids, known icon.
- **On unlock, the core re-derives every phrase record and compares it with the stored
  address/public key.** A mismatch is `Storage("vault payload is invalid")` and fails closed, so
  a stored address is never trusted blindly.
- Caps: 40 per restore (extension). `MAX_ACCOUNT_RECORDS = 128` across networks is mobile policy,
  replacing `MAX_ACCOUNTS = 32` and bounding vault size and unlock work. Labels and groups are
  capped at the record cap.
- `importedKeys` (Phase B, not in v2 yet) will be `[{accountId, privateKey}]` and
  zeroize-on-drop, like `mnemonic`.
- `recoveryPending` ⇔ `accounts` is empty. `activeAccountId` names a stored record whenever
  accounts exist.
- **Decision (labels in the vault):** the extension keeps labels and groups in plain preferences.
  Mobile seals them. UserDefaults/SharedPreferences are backed up, and a name next to an address
  is privacy-sensitive. The drawer is only reachable when the wallet is unlocked, so nothing is
  lost. Label changes re-seal with the session key, so no password prompt is needed.
- **Migration v1 → v2** (one adjacent step in `account_store.rs`, deterministic):
  - For each network in `supported_networks()` order and each `i in 0..account_count`, write an OZ
    record at index `i`, derived with the phrase and passphrase. v1 showed every index on both
    networks, so nothing disappears.
  - `activeAccountId` = the Mainnet index-0 record (the host's `ensure_network_account` then
    selects the selected network's own record); `labels = {}`, `groups = []`,
    `recoveryPending = false`.
  - The migration runs inside `open_session` and is written back atomically before the unlock
    returns. An older build then fails closed on `version != 1`, which is intended.
- Create writes OZ index 0 on the selected network. Import writes `accounts: []`,
  `recoveryPending: true`. `accounts()` on a pending vault returns `[]`, and the host routes to
  discovery. Switching network afterwards projects the active account (§1), so no network is
  ever left empty.
- **Coordination:** vault-security may also bump the payload. The branch that merges second
  renumbers its step to v3 and keeps the chain adjacent. SCOPE's "vault portability" decision (the
  extension's schema v4) is unchanged. The v2 field names follow the extension's record names so
  a later port stays mechanical.
- The selected network stays in UserDefaults (non-secret, already there). `WalletStore` changes are
  additive: `records`, `groups`, `select(id:)`.

Sections 6-10 (threat model, parity fixtures, test plan, delivery phases, and what is out of
scope or blocked on krusty-kms) continue in [accounts-verification.md](accounts-verification.md).
