# Nostr identity and shared accounts on mobile: tests and status

Companion to [nostr-multisig.md](nostr-multisig.md): its test plan (§9) and implementation status (§11).

## 9. Test plan

### Rust (`cargo test --locked`, plus clippy)

- **Unit, per module**: card codec; GUID, normalise, calldata, address; relay URL grammar; frame judge
  (each frame type; oversize, non-JSON, non-array and 5-element frames ignored without failing; wrong
  subscription; non-duplicate false OK; CLOSED, timeout and close before and after events; 50 counted
  frames); publish early finish and "Nostr relays are unavailable"; interleave and ordering; checkpoint
  bounds and merge; a held package still advances `syncedAt` and the held list stays within its caps;
  trust judge, including a forged snapshot from a saved contact; authority read (every status, error-24
  re-pin, id mismatch refused); join record shape with and without resolvable GUIDs; store round trips
  and fail-closed parsing (unknown version, extra key, oversize).
- **Parity**: `tests/nostr_multisig_parity.rs` over §6.2.
- **Lifecycle** (additive, `tests/wallet.rs`): `nostr_public_key` is `Locked` when locked; lock mid-batch
  stops it; `delete_wallet` removes the stores; `save_multisig_setup` refuses a deployer outside the set;
  `local_signer_account_ids` correct.
- **Hygiene**: no exported record has a private-key-like field; Nostr `CoreError` text has no hex > 16 chars.

### Swift unit (`BrambleTests`, new `NostrMultisigBridgeTests.swift`)

FFI Nostr key equals the fixture; card encode/parse; `argent_multisig_predict` equals the fixture address;
relay URL normalisation incl. the ws refusal; `NostrSyncPlan` driven by a scripted `StubRelayTransport`
(REQ shape, EOSE close, outcome counts); `MultisigAuthorityRead` over a stub `RpcClient` with recorded
bodies; the transport closes when the store locks.

### XCUITest (`BrambleUITests`, new `NostrMultisigFlowTests.swift`)

Run only on this run's simulator:

```bash
xcrun simctl list devices | grep "Bramble nostr-multisig" || xcrun simctl create "Bramble nostr-multisig" "iPhone 16"
mobile/scripts/build-core-ios.sh debug && (cd mobile/ios && xcodegen generate)
xcodebuild -project mobile/ios/Bramble.xcodeproj -scheme Bramble \
  -destination 'platform=iOS Simulator,name=Bramble nostr-multisig' CODE_SIGNING_ALLOWED=NO test
```

The app launches with `-BrambleStubNetwork` and `-BrambleStubRelay` (recognised only in DEBUG
builds). These swap in recorded RPC and relay transports, so no test touches the network. Tests
import the public parity phrase on Sepolia.

- **Receive**: switch starts on "Address"; card enables; QR label changes; "Copy wallet card" puts
  `mcw:contact:1:…` on the pasteboard; identity disclosure shows truncated keys and copy actions.
- **Contacts**: another network's card shows its error; a valid card shows "Wallet card verified…" and saves.
- **Relay settings**: save wss, reset, invalid URL, ws URL (mobile copy), each toast checked.
- **Shared accounts**: empty state; create with one pasted wallet-card participant, 2-of-2; Fund shows the
  fixture-predicted address; Deploy disabled with the mobile copy; row reads "2 of 2 signers"; resume shows
  "Complete multisig setup". Add: stubbed `available` saves, `unsupported-class` shows its error.
- **Intents**: a stub relay with one trusted package shows the held copy; an empty one "No new co-signer
  updates". **Reachability**: "Shared accounts" and "Multisigs" both open the list.

### Opt-in live checks (skipped by default, refused when `CI` is set)

`BRAMBLE_MOBILE_LIVE_RELAY=wss://…` enables one Swift test that runs a read-only coordination sync
against that relay with the **public** parity phrase (publishes nothing, since publish is unexported).
`BRAMBLE_MOBILE_LIVE_SEPOLIA=1` enables an authority read of a known deployed Sepolia Argent multisig. No
mainnet broadcast, no funds.

## 11. Implementation status (2026-09-24)

### Delivered

- **Core** (`mobile/core/src`): `nostr.rs`, `contact_card.rs`, `contacts.rs`, `argent_multisig.rs`,
  `multisig_rpc.rs`, `class_declared.rs`, `multisig_store.rs`, `nostr_relay.rs`, `coordination.rs`,
  `public_store.rs`, `multisig_constants.rs`, and the FFI files `ffi_nostr_multisig.rs` and
  `ffi_coordination.rs`. The additive edits are the `mod`/`pub use` lines and `CoreError::Coordination` in
  `lib.rs`, `with_phrase`/`data_dir` plus metadata removal on delete in `wallet.rs`, and
  `NetworkId::catalog_id` made `pub(crate)` in `networks.rs`. All four must-fix items are implemented and
  tested as §3.4, §4 and §5 describe.
- **Generated constants**: `mobile/core/generated/multisig.json` (`scripts/mobile-assets/multisig.ts`,
  byte-checked by `tests/conformance/mobile-generated.test.ts`). The constants that were module-private
  are now exported, additively, from `multisig-coordination-ops.ts`, `nostr-relay-socket.ts`,
  `coordination.ts` and `repository.ts`. The file also carries `cardNetworkIds`, so that mobile can tell
  "another network" apart from "unknown".
- **Parity**: `nostr-multisig-parity.json` (`scripts/mobile-nostr-multisig-parity.ts`, written by
  `bun run mobile:parity`; a committed wrap is kept while it still opens), `rust-gift-wrap.json` and
  `ui-coordination.json` (written by Rust tests under `BRAMBLE_WRITE_FIXTURES=1`, and verified on every
  run). They are checked on three sides: `tests/nostr_multisig_parity.rs`, `NostrMultisigBridgeTests.swift`,
  and `tests/conformance/mobile-nostr-parity.test.ts`. The last one checks the join records with
  `isArgentMultisigRecord`, which are built through the extension's real `discoverArgentSigners`. Two
  additive tests in `tests/background/multisig/nostr-relay.test.ts` pin the extension's own rules for
  ignoring bad frames and for ending early.
- **iOS**: `CoordinationStore`, `ChainReads`, `RelayTransport` (DEBUG-only stubs behind
  `-BrambleStubNetwork` and `-BrambleStubRelay`), and the Receive card and identity
  (`ReceiveAddressView`). There are also screens for the address book, shared accounts, the Ready Multisig
  gateway, add, create (Participants, Approval, Fund, Deploy), the shared-account home with co-signer
  updates, the multisig Receive, and relay settings. The shared controls are in
  `DesignSystem/CoordinationControls.swift`. The shared-file edits are one lazy property plus `reset()` in
  `WalletStore`, one `Flow` case with an environment navigator in `WalletShell`, three rows plus the relay
  disclosure in `SettingsViews`, and two resource lines in `project.yml`.
- **Android** (uncompiled): `coordination/CoordinationStore.kt` and `coordination/CoordinationScreens.kt`,
  hooked into `WalletStore.kt` and `ui/Screens.kt`. The only new dependency is `okhttp` `4.12.0`, pinned
  exactly: API 28 has no platform WebSocket client.

### Differences from the text above, found while implementing

- **Relay URL grammar.** Mobile accepts a strict ASCII subset of WHATWG `wss:` URLs. The parity vectors
  list the extension-valid spellings that mobile refuses (`ws://` loopback, IDN hosts, a bare `@`, and an
  empty `#`), each flagged as a deliberate difference.
- **Lone UTF-16 surrogates.** A relay frame that contains a lone-surrogate escape fails `serde_json` and is
  ignored as a whole frame. The extension still counts it toward the 50-frame cap, and Krusty then rejects
  it. The only effect is on that count.
- **Class-declared check.** Only a JSON-RPC 28 answer means "not declared". Unlike the extension, mobile
  does not re-hash the CASM against the pinned compiled class hash. The check only gates the create flow's
  warning, because deployment is deferred.
- **UI tests** still reach live RPC for the home screen's STRK/ETH balances. That existing `RpcClient`
  path is shared with other workstreams, so it was not changed. The multisig reads and every relay socket
  are stubbed.
- **The pasteboard** cannot be read by the XCUITest runner (`PBErrorDomain` 13). The test asserts the
  control's "Copied" state instead.
- **Host hardening found in review.** Each `RpcRequest` carries the core's `max_response_bytes`; the
  iOS and Android transports stop reading past it. Deleting a wallet removes the public metadata before
  the vault, and installing a wallet clears any metadata left without one. The coordination stores bump a
  generation on lock, so a core call still running then cannot write public state back. The UI test
  launches with the DEBUG-only `-BrambleResetData` and no longer needs a manual uninstall.

### Not delivered (deferred, as §1 and §10 list)

Deploy (DEPLOY_ACCOUNT), intent import, prepare, sign, share and submit, the Signers screen and config
changes, `SignerLinked` discovery (so no `unsupported-signers`), the "Address" participant method, fee
quotes and "Fund from this wallet", camera scanning, and the opt-in live relay and Sepolia checks (not
written). No Swift unit test covers "the transport closes when the store locks", because `BrambleTests`
links only the core. On Android, the create flow is a single simplified card (public keys or cards, the
default salt, and the current account as the deployer), and there is no participant picker, stepper or
resume.
