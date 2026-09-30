# Mobile transactions: verification

Continues [transactions.md](transactions.md): how the send path is pinned to the extension and
tested, the files it adds, what Krusty 0.11.0 lacks, and how each review must-fix was resolved.

## 6. Parity fixtures (pin behaviour to the extension)

New committed fixture `mobile/core/tests/fixtures/extension-transactions-{wire,rules,presentation,
status,copy}.json` (five files to respect the 500-line limit, separate from the shared
`extension-parity.json` to avoid merge conflicts; wire exchanges are one JSON string per line), written by a new
`scripts/generate-mobile-transaction-vectors.ts` that `bun run mobile:parity` invokes (two-line
additive edit), and byte-compared by the existing drift gate in `bun run check` (one more path in
`tests/conformance/mobile-generated.test.ts`). Every value comes from the extension's production
path, never from Krusty. Accounts: the published E2E phrase, indices 0 and 1, SN_MAIN and SN_SEPOLIA.

1. **Wire capture (strongest pin).** Run the extension's real `submitErc20Transfer` /
   `submitInvokeTransaction` against a recording fake transport with canned node replies (chain
   id, class hash or error 20, nonce, estimate, status), for a deployed and an undeployed
   account. Record every request body in order (nonce, single and bulk estimate, deploy-only
   estimate, re-estimate, `addDeployAccountTransaction`, `addInvokeTransaction`) and the replies
   it accepted. The Rust test drives `TransferPlan::advance` with the same replies and asserts
   JSON-equal bodies (canonical key order) in the same order.
2. **Hash and signature.** starknet.js 10.8.0 `hash.calculateInvokeTransactionHash` /
   `calculateDeployAccountTransactionHash` for the captured transactions, the signature from
   Krusty WASM `signStarkHash` through the vault signer, and WASM
   `computeInvokeTransactionHashV3` as a third corroborating value. Rust must match with
   `compute_invoke_v3_hash`, `compute_deploy_account_v3_hash` and `sign_stark_hash`. Krusty has
   no known-answer vectors against starknet.js, so this is the proof.
3. **Fee bounds.** Estimate replies (including 2^53, u64::MAX and above) → starknet.js
   `toOverheadResourceBounds`, `feeBoundsMaxSpend`, and `fee-bounds.ts` ceiling verdicts at
   exactly 1.5×, one over, unit mismatch and missing unit.
4. **Amounts and calls.** `parseTokenAmount` cases (ok, too many decimals, zero, whitespace,
   ≥2^128, grammar rejects), `buildErc20TransferCall` calldata, the `transfer` selector, and the
   Cairo-1 execute calldata.
5. **Presentation rules.** `shortAddress`; `normalizeFeltInput` + `isStarkFieldElement`;
   `explorerTransactionUrl` (mainnet, Sepolia, malformed, zero); `formatFri` /
   `formatFeeEstimate`; `formatTokenAmount`; the `verifyCalls` summary per bundled token and
   "Deploy account contract"; `address-poisoning` / `self-transfer` cases.
6. **Status judgement.** `classifyStatus` over every finality × execution combination, code 29 and
   the "transaction hash not found" message; `monotonicActivityStatus`; the not-found threshold.
7. **Copy.** Every string in §2, read from the extension modules that export it (the
   `REVIEWED_FEE_EXCEEDED` message, `transferStageTitle`, `reviewFeeSection`, deploy errors);
   inline-markup strings are extracted by rendering the UI Lab scenario. No mobile wording
   change remains (the working screen's liveness line, the only one, was removed). Swift unit
   tests assert the `SendCopy` table against it. Decided at implementation: the same generator
   renders `SendCopy.generated.swift` and `SendCopy.generated.kt` from this section
   (`scripts/mobile-send-copy.ts`), so no Send string is typed by hand; the drift gate compares
   both files. Failure messages are the extension's real error text, captured by injecting each
   fault into the recorded transport.
8. **Timing constants.** Confirmation checkpoints, deploy poll interval and attempts, 3/2 headroom.

## 7. Test plan

**Rust (`cargo test --locked`, clippy clean).**
- `tests/transactions_parity.rs`: fixture items 1 to 6, both deployment states, both networks.
- Unit tests in each `send/*.rs` module: out-of-order replies, wrong ids, a second `Confirm` and
  a reply after `close` are refused; a ceiling breach reaches no signing call (a counting test
  hook on the signer); bounds overflow; error 20 versus other errors (`Unknown` fails closed);
  bulk estimate missing `result[1]`; hash mismatch; a write transport failure gives
  `SubmissionIndeterminate` with no re-emission; poisoned recipient refused at `Confirm`;
  zero recipient (`0x0`, `0x000…`) refused at prepare; deploy wait gives up after 200 attempts.
- Must-fix regressions: prepare → lock → unlock → Confirm gives `Failed { Locked }` with zero
  signing calls; `close()` between the `AddInvoke` step and its reply, and between the
  auto-deploy `AddDeployAccount` step and its reply, leaves a pending record keyed by the signed
  hash; deployed-between-review-and-confirm and nonce-advanced-between-review-and-confirm (both
  also in the wire-capture fixture); an estimate node error at confirm is `NodeError`, not
  `ReviewedFeeExceeded`.
- Activity store: round-trip, 200-entry cap, hash dedup (`0x0ab` equals `0xab`), forward-only
  status, not-found threshold, corrupt file quarantined, `delete_wallet` removes it.
- The live-send gate lives only in Swift (`MainnetSendTests`): the core has no HTTP client, so a
  Rust test could only restate the environment check.

**Swift unit (`BrambleTests`, "Bramble transactions" simulator).**
- `TransferBridgeTests.swift`: loads the `extension-transactions-*.json` fixture, drives `prepare_transfer` /
  `advance` with canned replies, asserts bodies and final hash match the fixture and that no step
  exposes a key or a bare signature; checks `validate_recipient`, `shortAddress` (the core's `account_label`),
  `explorer_transaction_url` and `parse_token_amount` from Swift; the stage titles (authorizing,
  broadcasting and confirming all read "Sending"; there is no asset stage) and the working
  screen's one title with no body copy.
- `SendFlowModelTests.swift`: stage transitions; Max uses the full balance; an edit drops the
  plan; a row names the recipient and typed text never does; a token screen opens Send on its
  token; lock closes the plan; a fee failure disables Confirm; failure codes map to the
  extension's copy (fixture item 7); the driver never retries an `is_write` step and never sends
  a write to an endpoint other than the proven one.
- `SendReviewCopyTests.swift` (facts, each Cost box state with the combined figure and the
  deployment's share, the risks panel only when there is something to say),
  `SendRecipientsTests.swift` (address book, accounts under folders with empty folders dropped,
  search, the Save offer only for a new address) and `DeployFlowModelTests.swift` (fee quoted on
  open, one Deploy press, a failed quote quoted again before anything is spent, an account
  already on chain, the receipt firming up from submitted to deployed), each against the
  regenerated fixtures.
- `MainnetSendTests.swift`: skipped (`XCTSkip`) unless
  `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_SEND_ACK` equals "I understand this broadcasts a real
  mainnet transaction" and `CI` is unset. Documented in README; never run by agents.

**XCUITest (`BrambleUITests/SendFlowTests.swift`,** on a temporary simulator such as
`Bramble merge-tx`, created with `xcrun simctl create` and deleted afterwards; never the user's
"iPhone 16").
- Imports the published E2E phrase through the shared `UITest` helpers and launches on Sepolia with
  design-mobile's offline seam, `-uiTestOfflineFixtures ready|undeployed|unfunded|feeFailure`.
  Only DEBUG builds read the argument; `RpcTransports.launch` then serves every read (balances,
  deployment state, every plan step) from `RpcFixtures.generated.swift`, whose class-hash, nonce
  and estimate replies are generated from the extension's recorded send path, so the suite never
  touches the network.
- Walks recipient (invalid address error, then a pasted valid one), details (Max, "Too many
  decimal places", zero), Review (the Estimated fee line; one combined figure with the
  deployment's share when undeployed; no "Risk and recovery" panel when nothing needs saying;
  copy button; Back drops the review), the fee-failure fixture (Retry, disabled Confirm) and the
  poisoning fixture.
- Asserts "Confirm and send" exists and is enabled, then **stops**: it never taps it, and asserts
  the transport recorded zero write requests.
- Home shows no deploy chip for the undeployed fixture; Settings › "This account" › "Deploy
  account" shows "Maximum network fee: …" (quoted on open) and an enabled "Deploy", which it
  never taps.

**Extension (`bun run check`).** The generator's own test asserts the capture harness saw the
expected RPC method sequence; the drift gate covers the fixture file.

**Android.** `SendDriver.kt` (host driver, HTTP through `RpcClient.post`, redirects refused on
write steps) and `SendScreen.kt` (routed from Home's Send tile, built on the design components and
the one hardened field with its `ADDRESS` and `AMOUNT` kinds) are checked by reading against the
generated Kotlin bindings. They are **uncompiled** here (no SDK); a JVM parity test mirroring
`TransferBridgeTests` waits for Android CI.

## 8. Files

- **New in the core:** `mobile/core/src/send/{mod,types,u256,calls,fees,rpc_bodies,judge,sign,
  plan,plan_review,plan_submit,plan_deploy,wallet_ext,fixture_tests}.rs`,
  `mobile/core/src/activity/{mod,store}.rs`, and `tests/{transactions_parity,transactions_plan,
  transactions_lifecycle}.rs` with `tests/send_support/`. Each file stays under 500 lines.
- **New generators:** `scripts/{generate-mobile-transaction-vectors,mobile-transactions,
  mobile-transactions-capture,mobile-transactions-copy,mobile-transactions-screens,
  mobile-transactions-fixture,mobile-send-copy}.ts`.
- **New on iOS:** `mobile/ios/Bramble/Send/{SendFlowModel,DeployFlowModel,SendDriver,
  SendFailureText,SendRecipients,SendReviewCopy,SendCopy.generated}.swift` (reached from the tests
  through `@testable import Bramble`); the transport is design-mobile's `App/RpcTransport.swift`
  with its DEBUG `App/FixtureTransport.swift`,
  `mobile/ios/Bramble/Screens/Send/{SendFlowView,SendRecipientView,SendDetailsView,
  SendAssetSheet,SendReviewView,SendProgressView,DeployAccountView}.swift`,
  `App/WalletStore+Send.swift`; tests
  `BrambleTests/{SendTestSupport,TransferBridgeTests,SendFlowModelTests,SendRecipientsTests,
  SendReviewCopyTests,DeployFlowModelTests,MainnetSendTests}.swift`, `BrambleUITests/SendFlowTests.swift`.
- **New on Android (uncompiled):** `app/src/main/java/org/bramble/wallet/send/{SendDriver,
  SendFlowModel,SendScreen,SendCopy.generated}.kt`.
- **Additive edits to shared files:** `lib.rs` (`mod send; mod activity;`, re-exports);
  `wallet.rs` (plan accessors on vault-security's `lock_epoch` and `with_session`, activity-file
  delete; `sign_hash` untouched); `WalletStore.swift` (close plan on lock, deployment state for the
  privacy gates); `WalletShell.swift` (Send route); `HomeView.swift` (enable tile);
  `SettingsViews.swift` (Settings › "This account" › Deploy account); `RpcClient.swift` (refuse
  redirects on write steps via a task delegate).
- **Dependencies.** None new. The `transfer` selector is a constant checked by the existing
  `sha3` dev-dependency Keccak test, as `balanceOf` is. starknet-rust-core stays transitive.

## 9. Out of scope, and what Krusty 0.11.0 lacks

**Out of scope (other workstreams):** swap, privacy/shield, multisig, the explorer activity feed,
Braavos accounts (Ready/Argent sends: `accounts.md` §2.7a), Ledger, fiat prices (review shows "Fiat estimate unavailable" until the
portfolio workstream lands), the address book, a per-send biometric gate, hardware-wrapped keys
and the inactivity lock (vault-security), and a fee-speed control (the extension has none).

**Krusty 0.11.0 gaps.** None blocks this work; none needs fallback crypto.
1. **No query-version (2^128+3) hash.** None is needed: OZ estimates skip validation with an
   empty signature, and Ready estimates carry the extension's fixed query signature
   (`argentQueryAccount`: `[1, 0, public_key, 1, 1]`), which signs no hash.
2. **No sans-IO selector helper or Cairo-1 `__execute__` encoder.** They live only in
   `krusty-kms-client`, which pulls tokio and reqwest and must not be linked. The core writes the
   ~15-line encoder, pinned by fixture item 4. Optional upstream: move `encode_execute_calldata`
   and ERC-20 `populate_transfer` into `krusty-kms-common`.
3. **Fee scaling differs.** `MaxBound::from_estimate` uses f64 × 1.5 and caps the price at u64;
   starknet.js uses integer `addPercent`. The core implements the integer rule (fee policy, not
   crypto), pinned by fixture item 3. krusty's per-dimension `ResourceBoundsCeiling` does not
   model the overall-spend headroom and is not used. Optional upstream: an integer-exact
   `from_estimate_percent`.
4. **`Amount` is u128.** The core splits u256 limbs itself, as `rpc.rs` already does.
5. **Receipt classification in `krusty-kms-wallet-api` is private and async.** The core ports the
   extension's `classifyStatus`, pinned by fixture item 6.
6. **No `tx_hash` known-answer tests against starknet.js upstream.** Fixture item 2 fills this
   locally; contributing the vectors upstream is worthwhile.

## 10. Review must-fix resolutions

| Must-fix | Resolution |
| --- | --- |
| Write in flight when the plan is closed (backgrounding) | Pending activity record persisted, keyed by the signed hash, before every write leaves the core; `close()` never removes it; settled by status reconciliation (§3, §4). Tests cover invoke and auto-deploy. |
| Lock enforced only by the host | Session generation (`lock_epoch`) in `WalletCore`, checked at `Confirm` and at every signing point (§3). Tests: prepare, lock, unlock, Confirm → `Locked`; prepare, idle lock, unlock, Confirm → `Locked`; no signing call. |
| Confirm reused review-time deployment state and nonce | Submit path re-reads `ChainId`, `ClassHashAt` and `Nonce`, rebuilds the estimate, and switches to the deployed path when needed; failure codes follow the extension (§3 step 5). Both cases are in the wire-capture fixture. |
| Close after the write discards the hash | Same resolution as the first row. |
| Zero address accepted | `prepare_transfer` refuses a zero recipient or token with `InvalidRecipient`; fixture item 4 pins `buildErc20TransferCall`'s refusal. |
| Endpoint-binding claim unenforceable | `ChainId` added to `RpcPurpose` and emitted at the start of each plan and submit path; binding to one endpoint is stated as host-enforced and tested in Swift (§3, §5). |
| `sign_hash` withdrawal breaks sibling branches | Kept exported here; withdrawn when accounts merged, which moved every signature to the record gate (transactions.md §3). |

