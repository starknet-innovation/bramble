# Nostr identity, wallet card, and shared accounts on mobile

Status: design for the `mobile/nostr-multisig` workstream (2026-09-24), revised after review: the
four must-fix items (held-package trust, checkpoint semantics, the stored record shape, and the relay
frame judge) are resolved in §1, §2.4, §3, §4 and §5. Section 11 records what was implemented, what was not, and where the implementation deliberately differs from this text.
Scope: bring the extension's Nostr coordination identity, the wallet contact card, Argent (Ready)
Multisig 0.2 shared accounts, and the coordination relay settings to the Rust core and the iOS app,
with Android written against the generated Kotlin bindings (uncompiled, see the last section).

## 0. Two corrections to the brief

1. **The extension's multisig is Argent Multisig 0.2, not OpenZeppelin.** The pinned class
   `0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594` takes the constructor
   `[threshold, n, 0, pk_0, 0, pk_1, …]` with signers sorted by Argent signer GUID
   (`packages/platform/starknet/src/accounts/account-contracts.ts`). Krusty 0.11.0's
   `OpenZeppelinMultisig` builds `[quorum, n, signer_address…]` in caller order. It is a different
   contract, and its addresses never match the extension's. **This design does not use it.**
2. **Krusty 0.11.0 has no Argent-multisig descriptor.** The core builds the Argent layout from
   Krusty's public `calculate_contract_address` and `encode_short_string`, plus the 2-to-1
   `starknet_types_core::hash::Poseidon::hash`. That crate is already a direct dependency, pinned
   `=0.2.4`, and it is the same primitive library Krusty uses. These are public hash functions, not
   key handling, so they are not fallback crypto. The protocol formula still lives in bramble-core
   rather than Krusty, so §8 proposes the upstream descriptor. `krusty_kms_crypto::poseidon_hash_many`
   (the many-input sponge) must **not** be used for the GUID: it gives different results.

## 1. What ships and what is deferred

| Area | Delivered here | Deferred (and why) |
| --- | --- | --- |
| Nostr identity | Coordination public key (m/44'/1237'/0'/0/0, no BIP-39 passphrase) derived in the core; gift-wrap wrap/open with the adapter's bounds, used internally | Public `wrap` over FFI: nothing on mobile sends yet (see Intents) |
| Wallet card | Receive switch "Address / Bramble contact card", copy wallet card, "Wallet identity" disclosure; card encode/parse in the core | Scanning a card with the camera (no camera permission yet) |
| Contacts | Minimal address book: label, address, network, optional wallet card. Needed because coordination trusts only saved contacts | Send-recipient integration (transactions workstream) |
| Shared accounts | List, add by address (deployed: pinned-block authority read, `currentConfig` only when every GUID resolves locally, §2.4; undeployed: saved without config), create (Participants, Approval), save as undeployed, Fund (address, QR, copy, balance check), class-declared check, remove, multisig Receive | **Deploy** (DEPLOY_ACCOUNT broadcast and its signature format belong to the transactions workstream; never in tests); signer-key discovery from `SignerLinked` events; balances beyond STRK/ETH |
| Coordination | Relay protocol as sans-IO request builders and frame judges (publish and sync), checkpoint store, sender trust judgement, "Check for updates" end to end | **Importing and sharing signing intents**, which need `isPreparedArgentMultisigInvokeV3` (invoke-v3 re-hash) and Stark signature verification, which Krusty 0.11.0 does not export (§8). Prepare, sign, and submit of intents |
| Relay settings | Endpoints → "Multisig coordination relay": save, reset, validate | none |

Until intent import lands, "Check for updates" authenticates each gift wrap and judges its sender
fully. A package counts as trusted only when its sender is a saved co-signer contact **and** its
`configSnapshot` equals the authority this device already holds for the record (§4 Trust). Trusted
packages are then **held, not imported**: the screen reports them and their event ids go into a
bounded held list (§5). The checkpoint keeps the extension's semantics exactly: `syncedAt` always
advances and every authenticated id is marked seen. The held list stores ids, not content, so a
later release can ask relays for those ids, but a held package whose event a relay has pruned must
be re-shared. Mobile does not promise import without a re-share.

## 2. User-visible behaviour, screen by screen

Copy is the extension's, byte for byte, except the four mobile-only strings marked **[mobile]**.
Stylesheets are in `packages/presentation/wallet-ui/src/sidepanel/styles`. Stories are in
`apps/ui-lab/src/stories/journeys/multisig.stories.ts` ("Wallet journeys/09 Argent multisig") and
the receive stories. SwiftUI reuses `DesignSystem/Controls.swift` and `Surfaces.swift`. New shared
controls (segmented control, disclosure row, stepper header) go in new DesignSystem files and use
generated tokens only.

### 2.1 Receive (software account)

Extension source: `journeys/send/receive-view.ts`, `shell/dashboard-bindings.ts:30-180`.

- QR labelled "QR code for your Starknet address"; below it "Your Starknet address", the full address,
  "Network: <name>" and the existing hint.
- Segmented control "QR code contents": "Address" (pressed) / "Bramble contact card" (disabled until
  `nostr_public_key()` returns; card QR label "QR code for wallet contact card"). Explainer: "The contact
  card is public: this address, the signer public key, and the coordination public key. It holds nothing secret."
- "Copy address" and secondary "Copy wallet card" ("Preparing card…", disabled, while the key loads).
- Disclosure "Wallet identity" / "Signer and coordination keys": "Signer public key" (first 6 + "…" + last
  4, "Copy signer public key"); "Coordination public key" ("Preparing secure coordination…", then the
  truncated key and "Copy coordination public key").
- On derivation failure the switch, explainer and card button hide; status "Coordination is unavailable.
  Share the account address instead." Copy uses the existing local-only, 120 s pasteboard path (all public
  values). The multisig Receive passes no signer key, so it has no card or identity disclosure.

### 2.2 Contacts (new Settings entry "Address book")

Extension source: `support-flows.ts:60-135`. Fields are "Wallet card (optional)", "Label", "Address",
"Coordination public key (optional)" and "Signer public key (optional)"; a parsed card fills the last three. Card errors are "This wallet card belongs to a different network." and "That wallet
card is not recognized.". On success: "Wallet card verified. Add a label, then save." A parsed card
fills in the address. Rows show the label and the truncated address, and removal is a swipe action.

### 2.3 Settings entries and the Shared accounts list

"Shared accounts" (icon `users`) in the hub's "Accounts & networks" group (`settings-views.ts:43`) and
"Multisigs" (icon `users`) under Security → "External access" (`settings-views.ts:163`) open the same list;
the `SettingsViews.swift` edit is two row insertions linking to views in new files. The list
(`multisig-views.ts`, `multisig-management-views.ts:150-190`): header "Shared accounts" / "N account(s)";
rows "Add shared account" (plus) and "Create a multisig" (users); record rows show the display name and
"<t> of <n> signers" from the stored view (`storedMultisigView`), or "Authority unavailable". The extension's
" · Watch only" means unsupported signer types, which mobile cannot detect (§2.4), so it is never shown;
" · k open" needs intents (deferred); empty state "No shared accounts are saved on this network yet." The gateway is "Ready Multisig"
/ "Multiple signers approve together" with "Create a multisig" ("Set participants, fund, and deploy.") and
"Add a shared address" ("Sync it or resume setup.").

### 2.4 Add shared account (join)

"Add shared account" / "Sync or resume a Ready multisig"; field "Multisig address"; hint "If deployed,
signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before
use."; button "Add shared account". The active network must match and the address be canonical, non-zero.
The core's pinned-block authority read (§3.4) yields one of:

- `available`: the record is saved in the extension's exact `ArgentMultisigRecord` shape. It gets
  `currentConfig {signerPublicKeys, threshold}` only when **every** on-chain GUID resolves to a
  Stark public key through the extension's discovery candidates that need no event reads: the local
  accounts' `publicKeyX` on this network, then same-network address-book `publicKeyX`
  (`discoverArgentSigners` in `multisig-config-reconcile.ts` without the `SignerLinked` step).
  `signerPublicKeys` are GUID-ordered, so the record passes `isArgentMultisigCurrentConfig`. If any
  GUID stays unresolved, `currentConfig` is left out, exactly as `addMultisig` does. The fresh
  `{threshold, signerGuids}` read is then kept in the mobile-only `observed` list of `multisigs.json`
  (§5), never in `currentConfig`. An export drops `observed`.
- `undeployed`: saved without config, as `addWithoutConfig` does.
- `unsupported-class`, `invalid-config`, `network-unavailable`: refused with the matching
  `unavailableAddError` copy (for example "This address is not the pinned Argent Multisig 0.2 account").

`unsupported-signers` is not a refusal in the extension. There it is reported beside a stored record,
and it can only be detected from `SignerLinked` events. Mobile defers event discovery, so it cannot
detect non-Stark signers. Such a record is saved without `currentConfig` and shown as watch-only until
event discovery lands. The enum therefore has no `UnsupportedSigners` case on mobile.

Re-adding an existing record keeps its name and deployment. A fresh read whose GUIDs all resolve
replaces `currentConfig`, as `addRecord` does through `updateCurrentConfig`, so a rotation or threshold
change reaches the trust judge; an unresolved read leaves the stored config as it is.

### 2.5 Create multisig

Extension source: `multisig-deploy-view.ts`, `multisig-participant.ts`. The stepper shows
Participants, Approval, Fund, Deploy. When resuming a saved setup the title is "Complete multisig
setup".

- **Participants.** "Shared account name (optional)" (≤ `MULTISIG_LIMITS.nameLength` = 48), "Signer set"
  (N signers, current account pre-filled), "Add participant". Picker: "Public key" ("Use shared key") and
  "Wallet card" ("Add full contact"; name 1–64, full card with both keys; errors "Paste a valid Bramble
  card.", "That wallet card belongs to a different network.", "Ask the participant to share a full wallet
  card with signer and coordination keys."). A card participant is also saved as a contact, as in the
  extension. "Address" ("Look up key") is hidden: it needs signer discovery (deferred).
- **Approval.** "Signatures required" (1..n, default 1); "Deployment signer" ("This account signs and pays
  for deployment.") from local accounts in the set; "Advanced deployment settings" ("Default salt · 0x0").
  Continuing saves the undeployed record with `deployment {salt, signerPublicKeys, threshold}`, which must
  re-derive to the stored address.
- **Fund.** "Fund this multisig", predicted address with QR and copy, "Check funding" (existing balance
  read). "Send at least <fee>…" needs a DEPLOY_ACCOUNT estimate, so it becomes **[mobile]** "Send STRK to
  this saved address to pay for deployment."; "Fund from this wallet" needs Send and is hidden. If the class
  is undeclared: "The pinned Ready Multisig 0.2 class is not declared on this network. Predeclare the
  audited class before deployment."
- **Deploy.** The frozen review (address, threshold, sorted signers, salt) and a disabled button with
  **[mobile]** "Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for
  browser, or come back after the update."

### 2.6 Shared account home

- Overview: name, truncated address with copy, "<t> of <n> signers", deployment state, Receive (§2.1, no
  card). Remove is refused while an operation is unresolved (none exist yet) and asks for confirmation.
- Intents tab: "Co-signer updates" / "Check securely for intents and signatures shared by known contacts."
  and "Check for updates". Results "No new co-signer updates" or **[mobile]** "N co-signer update(s)
  received. Open them after the next Bramble update." (in place of "N signing intent(s) updated"); errors
  "Secure co-signer updates are unavailable. Try again shortly" / "Secure co-signer updates could not be
  verified. Try again shortly". "Share securely with co-signers" is absent: no intents exist on mobile yet.

### 2.7 Relay settings

Extension source: `network-views.ts:216-241`, `endpoint-ui.ts:43-80,193-210`. Under Settings →
Network → the disclosure "Multisig coordination relay", with the status "Custom" or "Reviewed
defaults".

Field "Custom Nostr relay" (monospace, placeholder `wss://relay.example`), hint "Used across networks for
encrypted intent handoffs. Every co-signer must select the same relay. Leave empty for the reviewed
defaults.", button "Save coordination relay", toasts "Coordination relay saved" / "Coordination relay reset"
/ "Coordination relay update failed". Trimmed; empty means the defaults `wss://relay.primal.net` and
`wss://nos.lol`; a custom relay replaces both, never joins them. **[mobile]** `ws://` is refused with
"Mobile connects to secure relays only (wss://)." — the extension allows `ws://localhost`, but ATS and
`usesCleartextTraffic=false` block it, and saving a relay that can never connect is worse than refusing it.

## 3. New UniFFI surface

All new code lives in new core files: `nostr.rs`, `contact_card.rs`, `argent_multisig.rs`,
`multisig_rpc.rs`, `nostr_relay.rs`, `coordination.rs`, `public_store.rs`, `contacts.rs`,
`multisig_store.rs`, and `ffi_nostr_multisig.rs` for the exports. The edit to `lib.rs` is only
`mod` lines and `pub use` lines. Errors reuse `CoreError`, adding at most one variant,
`Coordination { reason }`, whose reason is a fixed operation name and never input text. Limits and
constants come from `core/generated/multisig.json` (§6.1).

### 3.1 Records (all public data)

```rust
#[derive(uniffi::Record)] pub struct WalletContactCard {
    pub network: NetworkId, pub address: String,
    pub public_key_x: Option<String>, pub nostr_public_key: Option<String> }
#[derive(uniffi::Record)] pub struct Contact {
    pub id: String, pub label: String, pub network: NetworkId, pub address: String,
    pub public_key_x: Option<String>, pub nostr_public_key: Option<String> }
#[derive(uniffi::Record)] pub struct ArgentMultisigConfig {
    pub threshold: u32, pub signer_public_keys: Vec<String> }        // normalised: GUID-sorted
#[derive(uniffi::Record)] pub struct ArgentMultisigPrediction {
    pub address: String, pub class_hash: String, pub salt: String,
    pub constructor_calldata: Vec<String>, pub config: ArgentMultisigConfig,
    pub signer_guids: Vec<String> }
#[derive(uniffi::Enum)] pub enum MultisigAuthorityStatus {
    Available, Undeployed, UnsupportedClass, InvalidConfig, NetworkUnavailable }  // no UnsupportedSigners (§2.4)
#[derive(uniffi::Record)] pub struct MultisigRecord {      // a view: stored shape is §5's ArgentMultisigRecord
    pub id: String /* "<networkId>:<address>" */, pub network: NetworkId, pub address: String,
    pub name: Option<String>, pub threshold: Option<u32>, pub signer_count: u32,
    pub signer_public_keys: Vec<String> /* currentConfig or deployment; empty when unresolved */,
    pub has_current_config: bool, pub deployment: Option<ArgentMultisigPrediction>,
    pub local_signer_account_ids: Vec<String> }
#[derive(uniffi::Record)] pub struct RpcRequest { pub id: u64, pub body: String }
#[derive(uniffi::Enum)] pub enum RelayStep {
    Continue, Finish { close_frame: Option<String> } }   // send close_frame if any, then close the socket
#[derive(uniffi::Record)] pub struct CoordinationSyncOutcome {
    pub received: u32, pub trusted: u32, pub held: u32, pub imported: u32 }
#[derive(uniffi::Record)] pub struct RelayPolicy {
    pub relay_urls: Vec<String>, pub connect_timeout_ms: u32, pub request_timeout_ms: u32,
    pub is_custom: bool }
#[derive(uniffi::Record)] pub struct MultisigLimits {          // from generated/multisig.json
    pub name_length: u32, pub signers: u32, pub summary_length: u32 }
```

### 3.2 Pure free functions (no session, no secrets)

```rust
#[uniffi::export] fn wallet_contact_card_encode(card: WalletContactCard) -> Result<String, CoreError>;
#[uniffi::export] fn wallet_contact_card_parse(text: String) -> Option<WalletContactCard>;
// Short forms use the shared `account_label` (`shortAddress` on both hosts); no second helper.
#[uniffi::export] fn argent_signer_guid(public_key: String) -> Result<String, CoreError>;
#[uniffi::export] fn argent_multisig_normalize(config: ArgentMultisigConfig) -> Result<ArgentMultisigConfig, CoreError>;
#[uniffi::export] fn argent_multisig_predict(network: NetworkId, config: ArgentMultisigConfig,
                                            salt: String) -> Result<ArgentMultisigPrediction, CoreError>;
#[uniffi::export] fn nostr_relay_url_normalize(raw: String) -> Result<Option<String>, CoreError>; // None = defaults
#[uniffi::export] fn multisig_limits() -> MultisigLimits;       // {name_length 48, signers 32, summary_length 120}
```

### 3.3 `WalletCore` methods (need an unlocked session; `CoreError::Locked` otherwise)

```rust
fn nostr_public_key(&self) -> Result<String, CoreError>;                     // 64 lowercase hex
fn contacts(&self, network: NetworkId) -> Result<Vec<Contact>, CoreError>;
fn save_contact(&self, network: NetworkId, label: String, address: String,
                card: Option<String>) -> Result<Contact, CoreError>;
fn remove_contact(&self, id: String) -> Result<(), CoreError>;
fn multisigs(&self, network: NetworkId) -> Result<Vec<MultisigRecord>, CoreError>;
fn multisig_authority_read(&self, network: NetworkId, address: String)
    -> Result<Arc<MultisigAuthorityRead>, CoreError>;
fn add_multisig(&self, read: Arc<MultisigAuthorityRead>) -> Result<MultisigRecord, CoreError>;
fn save_multisig_setup(&self, network: NetworkId, name: Option<String>,
                       config: ArgentMultisigConfig, salt: String,
                       deployer_account_id: String) -> Result<MultisigRecord, CoreError>;
fn remove_multisig(&self, id: String) -> Result<(), CoreError>;
fn relay_policy(&self) -> Result<RelayPolicy, CoreError>;
fn set_nostr_relay_url(&self, raw: String) -> Result<Option<String>, CoreError>;
fn coordination_sync_begin(&self, multisig_id: String, now: u64)
    -> Result<Arc<NostrSyncPlan>, CoreError>;
fn coordination_sync_finish(&self, plan: Arc<NostrSyncPlan>)   // uses the plan's `now`, as the extension
    -> Result<CoordinationSyncOutcome, CoreError>;                  // uses one nowSeconds for since and syncedAt
```

`local_signer_account_ids` matches `argent_signer_guid` over the public keys of the vault's
signing account records on that network; only record ids cross, never an index (`accounts.md` §2.7).
Reads return `RpcRequest`s with `max_response_bytes` for the app's one RPC transport.

### 3.4 Sans-IO state machines (`uniffi::Object`, `&self` + interior `Mutex`)

`MultisigAuthorityRead` mirrors `chain-pinned-read.ts` and `getArgentMultisigConfig`:

1. `starknet_blockHashAndNumber` (what starknet.js `getBlockLatestAccepted` sends); hash must be a
   canonical non-zero felt.
2. `starknet_getClassHashAt(address, {block_hash})`: contract-not-found → `Undeployed`; another class →
   `UnsupportedClass`.
3. `starknet_call` `get_threshold` and `get_signer_guids` at that block; range-checked, unique non-zero
   GUIDs, else `InvalidConfig`. JSON-RPC 24 ("Block not found") re-pins, ≤ 3 attempts; other failures →
   `NetworkUnavailable`.

```rust
fn next_request(&self) -> Option<RpcRequest>;           // None once decided
fn accept_response(&self, id: u64, body: String) -> Result<(), CoreError>;  // judged; id must match
fn transport_failed(&self, id: u64);
fn status(&self) -> Option<MultisigAuthorityStatus>;
```

`ClassDeclaredRead` has the same shape, over `starknet_getClass(classHash, "latest")`, and
answers `declared(): Option<bool>`.

`NostrSyncPlan` mirrors `nostr-relay-socket.ts` and `nostr-relay.ts` for one sync:

```rust
fn relay_urls(&self) -> Vec<String>;
fn open_frame(&self, relay: u32) -> String;   // ["REQ","mcw-1",{"#p":[own],"kinds":[1059],"limit":50,"since":s}]
fn accept_frame(&self, relay: u32, frame: String) -> RelayStep;  // judges EVENT/EOSE/CLOSED/NOTICE/OK
fn relay_ended(&self, relay: u32);            // timeout, socket error, or the socket closed
```

The judge is `nostr-relay-socket.ts` as implemented, not a stricter variant:

- **Ignored frames.** A frame is silently ignored, and the subscription stays open, when it is over
  140,000 bytes (UTF-8 length; strictly greater, `> 140_000`; the UTF-8 length is never below the
  UTF-16 length the extension also checks), is not JSON, is not an array, or has more than 4 elements.
  Frames naming another subscription, and frame types other than EVENT, EOSE and CLOSED, are ignored.
- **EVENT.** Every EVENT frame for our subscription counts toward the cap, accepted or not
  (`pending.frames`). It is kept only if it passes `isNostrEvent`, is kind 1059 and carries our `p` tag.
  When the frame count reaches 50, the answer is `Finish{close_frame: ["CLOSE",id]}`.
- **EOSE** answers `Finish{close_frame: ["CLOSE",id]}` with the kept events.
- **CLOSED, timeout, socket error, close** (`relay_ended`) finish the relay with its kept events if it has
  any, and fail it only if it has none, as `#fail` and `#finishSubscription` do.

At finish: every relay failed → "Secure co-signer updates are unavailable". Otherwise round-robin
interleave up to 50, sort by `created_at` desc then `id` asc, drop checkpoint-seen ids, and the core
opens them itself (§4).

`NostrPublishPlan` has the same shape: an `EVENT` frame, and `OK` judging where a false ack whose
message starts with `duplicate:` counts as accepted. It is **built and tested now**, but not
exported until intent sharing lands.

The host moves bytes and enforces the connect and request timeouts that `relay_policy` returns
(8 s each, `RELAY_TIMEOUT_MS`), reporting either as `relay_ended`. It opens at most
`relay_urls.len()` sockets (at most 2), and closes them on `Finish`, on lock, and on backgrounding. Mobile
opens one socket per sync, so the extension's 20 s idle reuse does not apply.

### 3.5 What never crosses the boundary

- **The Nostr private key**: derived per call in `nostr.rs` as
  `Zeroizing::new(derive_nostr_private_key(mnemonic, 0, 0, None)?)`, only borrowed into `nostr_public_key`,
  `wrap_nostr_application_data_at` and `open_nostr_application_data`; never cached, persisted, logged or
  returned. No `NostrKeyPair` is built (it is `Clone`).
- Stark keys, mnemonic, passphrase: SCOPE.md's two phrase crossings are unchanged.
- **Gift-wrap plaintext and raw events**: judged in the core; only counts come back; wrap/open unexported.

## 4. Nostr details pinned to the extension

- **Derivation** (`vault/service/nostr.ts`): one key per wallet, `(mnemonic, index 0, account 0)`,
  **passphrase `None` even when the vault has `mnemonic_passphrase`**. The public key is BIP-340
  x-only, 64 lowercase hex, and is re-validated against `^[0-9a-f]{64}$`. A failure maps to
  `Kms{operation:"nostr public key"}`. Every mobile wallet has a mnemonic, so the extension's
  Ledger-only branch does not arise. The UI's unavailable branch still exists for errors.
- **Open** (`kms-krusty/adapter.ts` order): event JSON ≤ 131,070 bytes; exactly the keys `content,
  created_at, id, kind, pubkey, sig, tags`; non-empty content, safe `created_at` ≥ 0, `kind` 1059; `id` and
  `pubkey` 64 lowercase hex, `sig` 128; ≤ 32 tags of ≤ 8 parts of ≤ 512 chars; then Krusty verifies wrap and
  seal signatures, rumor id and p tag; output exactly `{content, identifier, senderPublicKey}` with content
  1–32,768 bytes, identifier 1–128 printable ASCII, valid sender key. A failure yields `None` for that item;
  batches hold 1–50; the session lock is re-taken per item, so a lock stops the batch (`isAuthorized()`).
- **Wrap** (internal): valid recipient, identifier `bramble.multisig`, bounded content;
  `wrap_nostr_application_data_at(..., now)` with host `now`; output re-checked for kind 1059, exactly
  `["p", recipient]`, ≤ 131,070 bytes.
- **Trust** (`trustedSharedIntent`): identifier `bramble.multisig`; content is exactly `{intent,
  kind:"bramble.argent-multisig-intent", version:1}`; `intent.accountId` equals the record id; the sender key
  is a saved same-network contact whose `argent_signer_guid(publicKeyX)` is in
  `intent.configSnapshot.signerGuids`. Until import lands, `intent` is checked structurally only (keys,
  `accountId`, `configSnapshot` shape per `isConfigSnapshot`).
- **The snapshot must match stored authority (mobile, while import is deferred).** The snapshot comes
  from the package, so the sender controls it. The extension may trust it at this step only because
  import then compares it with the account's real config (`sameConfig` in `multisig-intent-context.ts`).
  Mobile holds instead of importing, so the core runs that comparison itself. The snapshot's class hash
  must be the pinned class, and its `signerGuids` and `threshold` must equal the record's stored
  authority. That authority is the first available of: the GUIDs of `currentConfig.signerPublicKeys`
  with its threshold; the GUIDs of `deployment.signerPublicKeys` with its threshold; the mobile-only
  `observed` read (§5). A record with none of these trusts no package. A package that fails this check is
  authenticated but untrusted: it is marked seen and counted only in `received`. For example, a saved payee
  whose card carries a Nostr key sends `accountId` = the public record id and a snapshot that lists its own
  GUID. It fails here and is never shown as a co-signer update.

## 5. Storage

No vault change: nothing secret is added, so `VaultPayload` and its version stay as they are. The
new state is public metadata held in the core's `data_dir` beside `vault.json`. It inherits
`FileProtectionType.complete`, backup exclusion, and on Android `noBackupFilesDir`. It is written
with the vault's temp-file, `sync_all`, then rename sequence, factored into `public_store.rs`.
Every file is `{"version":1, ...}`, parsed with `deny_unknown_fields`, and fully re-validated on
read. An unknown version or invalid content fails closed with `Storage{reason:"<file> unreadable"}`
and leaves the file untouched. It is never silently reset.

| File | Shape (mirrors) | Bounds |
| --- | --- | --- |
| `contacts.json` | `entries: AddressBookEntry[]` exactly as `isAddressBookEntry`, id = `addressBookEntryId` | label per `isLabel`; count per the extension's address-book cap |
| `multisigs.json` | `records: ArgentMultisigRecord[]` in the extension's exact shape: `accountContractType` `argent-multisig`, `address` (canonical), pinned `classHash`, optional `currentConfig {signerPublicKeys, threshold}` (GUID-ordered Stark keys, written only per §2.4), optional `deployment {salt, signerPublicKeys, threshold}`, `id`, optional `name`, `networkId`. Plus the mobile-only `observed: [{id, signerGuids, threshold}]`, which an export drops | ≤ 20 records; name 1–48; deployment must re-derive to address; each record passes the extension's `isArgentMultisigRecord` (fixture-checked, §6.2) |
| `coordination.json` | `{relayUrl?, checkpoints[], held[]}`: `bramble:nostr-coordination:v1` checkpoints, the `nostrRelayUrl` preference, and the mobile-only held list | ≤ 20 checkpoints, ≤ 200 seen ids, 1–2 relay URLs, `syncedAt ≤ 4102444800`; held ≤ 50 and inside the 30-day window |

Records use the extension's field names and value shapes, so a later encrypted export or import between
devices (the SCOPE.md "Vault portability" decision) maps `records` one to one. The two mobile-only lists
(`observed`, `held`) are dropped on export.

**Migration**: new files at version 1, so none; a missing file means empty. Later changes follow the vault
rule (bump, one adjacent step, tests for old/current/invalid). **Deletion**: `delete_wallet` also removes
the three files (one-line call to `public_store::remove_all` in `wallet.rs`); lock leaves them.

**Checkpoint rule (the extension's, unchanged).** Every sync that reaches the open step records a
checkpoint exactly like `recordSync`: `syncedAt` advances to the sync's `now`. Every authenticated event
id, whether trusted, held or untrusted, is marked seen. Seen ids merge with the stored ones only when the
relay set is unchanged, capped at 200. Held packages never freeze the checkpoint, so `nostrSyncSince`
stays inside the documented window: 30 days on the first sync, then `syncedAt` − 3 days.

**Held list (mobile-only, bounded).** `coordination.json` also keeps
`held: [{accountId, createdAt, eventId}]`. The list has no duplicate ids and is capped at 50 entries,
newest `createdAt` first. On every sync, entries older than the 30-day lookback (`now − 2,592,000`) are
dropped. It only counts packages for the UI and names ids a later release may request. It holds no
content, and a package whose event a relay has pruned must be re-shared. `delete_wallet` removes it with
the other files.

## 6. Parity fixtures

### 6.1 Generated constants (`bun run mobile:assets`)

`scripts/generate-mobile-assets.ts` gains `mobile/core/generated/multisig.json`: `MULTISIG_LIMITS`,
`ARGENT_MULTISIG_CONTRACT`, `MULTISIG_NOSTR_RELAYS`, the three `MAX_NOSTR_*` bounds, the identifier,
lookback windows, checkpoint bounds, and the relay frame limit and timeouts. The identifier, lookbacks and
socket constants are module-private today; exporting them is an additive TypeScript change, single-sourced.
The core `include_str!`s the JSON and `bun run check` byte-compares it like the other generated files.

### 6.2 Vectors (`bun run mobile:parity`)

These go in a new `mobile/core/tests/fixtures/nostr-multisig-parity.json`. It is a separate file
from `extension-parity.json` so that sibling branches do not conflict. It is written by
`scripts/generate-mobile-parity-vectors.ts` through the extension's real modules.

1. **Nostr key**: `deriveNostrPublicKey(PARITY_MNEMONIC, 0, 0)` via `createKrustyKms`, and at address 1,
   the co-signer (so the only phrase in the repository is the E2E one); plus a Rust case unlocking a
   passphrase-bearing vault that must still return the no-passphrase key.
2. **Gift wrap, extension → Rust**: the adapter wraps a fixed intent-package payload (`bramble.multisig`)
   from address 0 to address 1; Rust opens it to the same content, identifier and sender.
   Rejections: wrong recipient, flipped `sig` character, kind 1 with id recomputed, oversize content, extra
   top-level key.
3. **Gift wrap, Rust → extension**: wraps are random, so a committed `rust-gift-wrap.json` (rewritten only
   with `BRAMBLE_WRITE_FIXTURES=1`) is opened by `tests/conformance/mobile-nostr-parity.test.ts` with
   `krusty-kms-wasm` 0.11.0 inside `bun run check`; Rust also round-trips its own wraps.
4. **Argent multisig**: `argentSignerGuid` (0x123, 0x456, parity keys); normalise, calldata and
   `argentMultisigAddress` for {0x456, 0x123}/2, 1-of-1, 2-of-3, 32 signers, salts 0x0 and non-zero;
   rejections: threshold 0, threshold > n, 33 signers, duplicate, zero, non-canonical felt.
   **Joined record**: the record the extension's `addMultisig` would store after reading a deployed
   account whose GUIDs all resolve to local keys (the parity phrase's accounts 0 and 1), and the one whose
   GUIDs do not all resolve (no `currentConfig`). The conformance test asserts both pass
   `isArgentMultisigRecord` and keep the same signer keys. The Rust test performs the join over recorded RPC
   bodies and compares its stored record to the fixture byte for byte.
5. **Wallet card**: accept/reject cases of `contact-card.test.ts` (512 cap, prefix, extra parts, network,
   zero felt, bad Nostr key, `-` placeholders).
6. **Relay URL**: `isNostrRelayUrl` verdicts plus a `mobile` column differing only for `ws://`.
7. **Frames and trust**: the socket module is not pure, so its REQ/CLOSE/EVENT/OK/CLOSED cases are
   mirrored 1:1 from `tests/background/multisig/nostr-relay.test.ts` (each Rust test names its TS twin).
   Added cases pin the ignore-and-continue rules: an oversized frame, then a valid event and EOSE, yields
   that event; a timeout after 2 kept events yields 2; a relay that sends 50 rejected EVENT frames is
   closed. `trustedSharedIntent` needs a fully verified intent (invoke-v3 re-hash and Stark signature
   checks, §8), so its generated vectors wait for import. Until then the Rust trust judge is covered by unit
   tests, including a saved contact that forges a snapshot listing itself.
8. **Authority read**: recorded JSON-RPC bodies per `MultisigAuthorityStatus`, including an error-24 re-pin.

## 7. Threat model

| Threat | Mitigation |
| --- | --- |
| The Nostr private key leaks through FFI, logs, or a crash dump | Derived per call into `Zeroizing<[u8;32]>` and only borrowed. No export, no `Debug`, no cache. Errors carry operation names. Krusty's `derive_nostr_private_key` returns a bare array, so one stack copy is not wiped: an upstream fix is in §8 |
| The coordination key drifts from the extension, so co-signers cannot reach mobile | Passphrase fixed at `None`. The fixture includes a passphrase-bearing vault |
| A hostile relay floods the client, sends oversize frames, or forges events | 140 KB frame cap, 4-element arrays, strict `isNostrEvent`, kind and p-tag filter, 50-event cap, round-robin across relays so one relay cannot fill the batch, and Krusty verifies both signatures |
| A relay replays or reorders events | Seen-id checkpoint (only for authenticated events), deterministic ordering, and the `since` window with 3-day overlap |
| A stranger sends a "signed" intent | Trusted only from a saved contact whose Stark key GUID is in the snapshot, **and** the snapshot must equal the record's stored authority (§4). Held, never imported, until full intent validation exists |
| A saved contact forges a snapshot to look like a co-signer or to stall sync | The snapshot is compared with stored authority, not trusted from the package. Held packages never freeze the checkpoint (§5) |
| A stranger publishes oversized or malformed kind-1059 frames, or a relay stalls after sending events | Such frames are ignored without failing the relay, and a relay that ends early keeps the events it delivered (§3.4), as in the extension |
| A spoofed contact card substitutes a co-signer key | Card parsing is strict and network-bound. The card is shown verified before saving. Adding a contact is an explicit user action, and the key is visible in "Wallet identity" for out-of-band comparison |
| A wrong multisig address is shown for funding | The prediction is re-derived from the stored `deployment` on every read. Fixture-pinned to the extension. The review shows sorted signers and threshold |
| Joining a lookalike contract | The class hash must equal the pinned Argent 0.2 class. Threshold and GUIDs are read at one pinned block |
| Wrong chain | Existing `starknet_chainId` proof before any read, and the active network must match the record |
| Metadata at rest reveals the co-signer graph | App-private file protection and backup exclusion like the vault. Documented as public-but-sensitive. Not in UserDefaults or SharedPreferences |
| Work continues after lock | Every core method re-takes the session lock. The host closes sockets on lock and backgrounding. No background tasks |
| Cleartext relay | wss only on mobile (§2.7). The host `URLSessionWebSocketTask` is created from an ephemeral configuration |
| Clipboard exfiltration | Only public values are copied, via the existing local-only, 120 s path |
| Tests reach live relays or broadcast | The core is sans-IO. Swift tests inject a stub transport. The live relay test is opt-in and refused under CI (§9). Deploy is not implemented |

## 8. Blocked on or proposed for Krusty

1. **Argent Multisig 0.2 descriptor** beside `OpenZeppelinMultisig`: pinned class hash,
   `signer_guid(pk) = Poseidon::hash(short_string("Starknet Signer"), pk)`, GUID-sorted validated calldata
   (≤ 32 signers), `deployment_descriptor(threshold, signers, SaltPolicy::Explicit)`, and signature
   serialisation (threshold `[n,(0,pk,r,s)…]`, deploy `[1,(0,pk,r,s)]`). Until then bramble-core composes
   it from public Krusty and `starknet-types-core` functions (§0), pinned by fixtures.
2. **Stark signature verification export.** This blocks intent import. The core can re-hash
   invoke-v3 with Krusty's `compute_invoke_v3_hash`, but Krusty 0.11.0 exports no
   `verify_stark_signature`. The options are an upstream export (preferred), or a direct exact pin
   of `starknet-rust-crypto =0.19.1`, the crate Krusty already uses, which needs maintainer sign-off
   under AGENTS.md's dependency rule. **Decision needed.** Porting `isPreparedArgentMultisigInvokeV3`
   (437 lines) also overlaps the transactions workstream's invoke-v3 work, so intent import follows it.
3. **Zeroizing return from `derive_nostr_private_key`.** Returning `Zeroizing<[u8;32]>` would close
   the one unwiped stack copy. Minor.
4. **Not needed from Krusty:** relay framing, the card codec, and checkpoints, which are pure
   framing. `krusty-kms-client` is not used: its multisig targets OpenZeppelin over HTTP/NATS and
   pulls in tokio and reqwest, which would break sans-IO.

## 9. Test plan

Moved to [nostr-multisig-status.md](nostr-multisig-status.md) with the implementation status (§11).

## 10. Android and remaining scope

- **Android.** Compose screens mirroring §2 are written against the generated Kotlin bindings, with
  an OkHttp `WebSocket` transport added as an exact-pinned dependency only if the existing stack
  lacks one, justified in the PR. Card copy uses `ClipboardManager` without `EXTRA_IS_SENSITIVE`,
  because the value is public. **This code is uncompiled**: there is no Android SDK on this machine.
- **Out of scope here**: single-signer sends (transactions); multisig DEPLOY_ACCOUNT; intent prepare, sign,
  import, share, submit; config changes; signer discovery from events; multisig balances beyond STRK/ETH;
  camera scanning; biometric re-auth (vault-security — coordination reuses the core's session checks, so it
  inherits back-off when that lands).
- **Overlap to watch:** a contacts or address book may also appear in the transactions workstream.
  `contacts.rs` uses the extension's `AddressBookEntry` shape exactly so the two merge
  mechanically. Whichever lands second adopts the first.

## 11. Implementation status

See [nostr-multisig-status.md](nostr-multisig-status.md).
