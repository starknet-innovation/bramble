# Mobile STRK20 privacy: design

Status: implemented on branch `mobile/privacy` (2026-09-24, iOS verified; Android uncompiled),
built on `mobile/transactions`, with the review's six must-fix items resolved (§10), and merged
into `feature/mobile-wallet`. The §1.1 exemption is **decided: approved by the owner**
(2026-09-24). It covers SCOPE.md Phase 2 "STRK20 privacy" for the
pieces Krusty 0.11.0 can support. The transactions workstream's `TransferPlan`, RPC bodies,
judges and activity store are reused; nothing in `send/` is copied. Since 2026-09-30 every entry
point reads "Shield" and opens the journey (§2.1).

## 1. Ground truth, and the honest boundary

The extension splits privacy into three parts:

| Part | Extension implementation | Can the mobile core own it on `krusty-kms =0.11.0`? |
| --- | --- | --- |
| Viewing key | `deriveScopedStrk20ViewingKey` (Krusty WASM), from the account key, scoped to `"<chainId>:<pool>"`, derived lazily behind a live-session check, never persisted | **Yes.** `krusty_kms::derive_scoped_strk20_viewing_key(&Felt, chain_id, pool)`; same release as the WASM |
| Reads | The official SDK's `IndexerDiscoveryProvider` (`/v1/sync/preflight_check`, `/v1/sync/incoming_state`), judged by `official-sdk-values.ts` `balancesFrom`; pool `get_fee_amount` over `starknet_call` | **Yes**, as sans-IO request bodies plus judges. JSON and felt handling only; no new cryptography |
| Writes | SDK `ActionCompiler` + `PoolSimulator` + tagged Poseidon hashes + ECDH note/channel encryption + `compile_actions` ABI serialisation + CallSet (SNIP-12) signature + `starknet_proveTransaction` + `ServerAction` decoding into `apply_actions` | **No.** Krusty 0.11.0 ships only the primitives (Poseidon, curve multiplication, RNG, `compute_invoke_v3_hash_with_proof_facts`). Porting the SDK would create a second, unaudited implementation of the protocol, and the rules forbid that |

Consequences: in v1, activation (registration), shield, private transfer and unshield **do not
submit on mobile**; §2 shows where each flow stops. Unlocking them needs a pinned, sans-IO Rust
privacy client (§9); proving stays remote, as in the extension. The extension ships routing for
Starknet Mainnet only (`DEFAULT_STRK20_NETWORKS`), so Sepolia always shows the "network" blocker.

### 1.1 Where the viewing key goes (decided: exemption approved)

**Decision (2026-09-24, the owner approved the exemption).** The STRK20 viewing key may travel
inside the discovery request body that the Swift/Kotlin host carries, in a buffer the host wipes
after the exchange, over HTTPS only, to the configured discovery service only; it is never
persisted and never shown, and this matches what the extension sends. The conditions below are
the terms of that approval and are enforced as listed; mobile/SCOPE.md records the exemption.

"Never exposed" in the extension means that the key never enters a message, preferences,
activity, session storage, UI state or logs (`tests/background/routing/key-boundary.test.ts`).
The protocol itself still sends it off-device: to the discovery service in the POST body
(`viewing_key: toHex(vk)`), and to the prover inside the `compile_actions` calldata.

A sans-IO core that builds a discovery body hands those bytes to Swift/Kotlin to send, so the key
crosses FFI inside an **opaque request body**. The alternatives are worse: HTTP inside Rust breaks
the fixed sans-IO architecture and adds TLS to the core; OHTTP in the core needs HPKE code that
Krusty does not provide.

**Approved SCOPE.md exemption:** a privacy request body may carry the viewing key across FFI as
`Vec<u8>`, under all of the following conditions:

1. Only the core builds it, and only for the configured discovery URL of the account's own network.
2. No exported type has a field that holds the key alone.
3. The host sends the bytes unread and unlogged, refuses redirects, and zeroes the buffer it was
   handed as soon as the exchange ends (Swift `PrivacyDriver.wipe`, Kotlin `body.fill(0)`). That
   wipe is best effort: URLSession, `HttpsURLConnection` and the TLS stacks keep
   internal copies the host cannot reach. **This is a deviation from the brief's "never crossing
   FFI"**, not a way around it: it cannot be closed without HTTP in the core or an upstream client.
4. **OHTTP is off for that network.** The extension sends discovery through OHTTP as soon as its
   config sets `ohttpEnabled: true` or any `ohttpRelayUrl` (`official-sdk-transfers.ts`), so the
   operator never sees the key beside the client's network identity. Mobile has no OHTTP client,
   so such a network must not be routed at all: `scripts/mobile-assets.ts` renders it as
   `{ "id", "ohttp": true }` with no URL or pool, and the core's loader independently treats
   `ohttp: true` (or a missing URL/pool) as not configured, so `prepare_privacy_read` returns
   `NotConfigured` and the key is never put in a plaintext body (§6 fixture 2, conformance test).

With these conditions this is the same exposure as the extension's background `fetch`. The owner
signed this off on 2026-09-24, so the read plan (§3) ships. The endpoint override
(`BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL` for the Rust suites, `-BramblePrivacyDiscoveryURL` for
DEBUG iOS builds) passes the same URL rules, and an OHTTP network is still refused (condition 4).
The read is keyed by the account record id (`prepare_privacy_read(account_id)`), and the key is
derived only from that record, never from an account index.

## 2. User-visible behaviour, screen by screen

All copy is the extension's, byte for byte. It is generated into `PrivacyCopy.generated.{swift,kt}`
from a fixture captured from the rendered extension (§6), the same way `SendCopy.generated.*` is.
Layout reuses `mobile/ios/Bramble/DesignSystem` and follows
`packages/presentation/wallet-ui/src/sidepanel/styles/privacy/styles-privacy.ts`; the visual
reference is the UI Lab stories under "Wallet journeys/04 Private balances". "Unsupported" marks
the only two non-extension strings (§2.7), kept in a `mobileOnly` section of the copy generator so
the drift test enumerates them.

**Gates are computed in the core.** The UI never re-derives them: it passes in public facts it
already has (deployment state from the transactions workstream, the public balances) and renders
the returned enum. Each gate first computes the extension's own outcome (pinned by fixture 5),
then the core applies `PrivacyCapabilities { can_register: false, can_shield: false,
can_send_privately: false, can_unshield: false }` to it. When §9 lands, the flags flip and no
screen logic changes.

The reading the gates take mirrors the extension's `PrivacyDisclosureState`: `Idle` (not read
yet), `Loading`, `Failed` (service), `Unconfigured` (the extension's `network` blocker, which it
also reports as an error), and `Settled { registration }`. `deploymentKnownFromPrivacy` is
honoured everywhere: a `Registered` reading implies deployed. "Funded" means the loaded public
STRK balance is above zero; `None` means it has not loaded (`strkAvailableForFees`).

### 2.1 Home: Shield tile and hero

Mirrors `wallet-shell.ts` `shieldTile(strkTokenId, privateReady, deploymentKnownFromPrivacy(...),
fundedForFees)`. `HomeView.swift` currently has `ActionTile("Shield").disabled(true)`; this design
replaces that with one additive line.

| Core `ShieldTile` | Label | Accessibility label | Tap on mobile | Extension tap |
| --- | --- | --- | --- | --- |
| `NoStrkToken` | Shield (disabled) | "Shield unavailable until a token is tracked" | none | none |
| `FundFirst` (undeployed, loaded STRK = 0) | "Shield" | "Shield — add STRK to this account first" | journey → `fund` blocker | privacy screen |
| `DeployFirst` (undeployed, STRK funded or not loaded) | "Shield" | "Shield — deploy this account first" | journey → `deploy` blocker, **action suppressed** | privacy screen |
| `Activate` (deployed or unknown, not registered) | "Shield" | "Activate private balances" | journey (§2.5) | activation |
| `Ready` (registered) | "Shield" | "Shield public value into your private balance" | journey → `Unsupported` blocker (§2.7) | Send in Shield mode |

Every enabled tile reads "Shield" and opens the journey, which names what stands in the way; the
reason is in the accessible name. The hero shows "Includes shielded balances" when a visible
private balance is non-zero (`visiblePrivateHomeBalances`), and its total is computed from the
unified list (§2.2), so it includes private value exactly as the extension's
`portfolioTotal(unifiedHomeBalances(...))` does. Mobile has no price source on this branch, so the
total still reads "—"; the unified list is the hook the portfolio workstream's total consumes.

**Why the deploy action is suppressed.** The extension's fix #402 ("stop offering a deployment
privacy cannot use") establishes that a deploy the user cannot follow with registration must not
be offered from privacy surfaces. Plain deployment stays available from Settings › This account
› Deploy account (transactions.md §2.7).

### 2.2 Token rows: unified amounts and the private line

The core's `unified_home_balances` mirrors `home-tabs.ts` `unifiedHomeBalances` and
`visiblePrivateHomeBalances` over the portfolio's Home model: it takes `HomeRows.visible` (the
portfolio's `TokenBalance` rows) and adds each private balance by token id, keeping public order,
appending tokens that hold only a private balance, then moving STRK first (`compareStrkFirst`);
tokens hidden from Home are excluded. Private amounts count only while the reading is
`Settled { Registered }`; otherwise the list equals the public one. Each `UnifiedBalance` is the
portfolio's `TokenBalance` with the summed balance and `formatted`, plus the public half's
`public_compact` and `private_only`; hosts render the rows and compute the hero total from them,
and the amount column uses the portfolio's one `compactAmount`.

The row expands to the extension's breakdown: "Public balance" and the private line from
`token-row.ts` `privateBreakdownLine`, driven by `privateBreakdownFor`, in this precedence:

1. `Unconfigured` → "Unavailable";
2. undeployed → "Shield", funded or not (opens the journey, which names the deploy or fund
   blocker);
3. `Failed` → "Unavailable";
4. `Idle` or `Loading` → "Discovering…";
5. unregistered → "Register to start shielding" (opens the journey);
6. registered → `compactAmount(formatted, 2)` + " " + symbol, `0.00 <symbol>` when no note.

If the read failed (including `Unconfigured`, which the extension also reports as an error), the
list also shows "Private balances · Try again", which re-runs the read plan. The status line
(`network-status.ts` `privacyDataIssue`) reads "Private balances are temporarily unavailable." or
"Private balances are still refreshing."; mobile puts it in the header's accessibility value.

### 2.3 Token detail

The core's `token_detail_privacy(network, deployment, reading, token_address, state)`
mirrors `token-flows.ts` `tokenDetailFlow` + `privacyActions`, including the #402/`3a8a2d81`
rules, and returns a summary and an action:

| Summary (`DetailSummary`) | When | Mobile rendering |
| --- | --- | --- |
| `Retry` | reading `Failed`/`Unconfigured` and deployment ≠ `Undeployed` | muted row "Private balance · Try again"; re-runs the read |
| `Amount { text }` | not known-undeployed and `Registered` | "Private balance" + `compactAmount(formatted)` + symbol |
| `RegisterToStart` | any other settled reading | muted row "Private balance · Register to start shielding" |
| `None` | otherwise | nothing |

| Action (`DetailAction`) | When | Mobile rendering |
| --- | --- | --- |
| `None` | ineligible network, or a failed read | nothing |
| `Shield` | known undeployed, funded or not | "Shield" → journey → deploy or fund blocker, deploy suppressed as on the tile |
| `ShieldUnshield` | registered | "Shield" and "Unshield" shown, disabled, with the Unsupported note |
| `GoPrivate` | otherwise | "Go private" → journey |

Both are pinned in fixture 5 through the extension's `tokenDetailFlow`. Mobile has no token-detail
screen on this branch (the portfolio workstream owns it), so the section ships as
`TokenPrivacySection.swift`, covered by unit tests, for that screen to embed.

### 2.4 (removed)

The earlier "Private balance view" was not an extension screen and is gone. Private balances
appear only where the extension shows them: the unified Home rows (§2.2) and the token-detail
summary (§2.3).

### 2.5 Privacy journey (disclosure and activation screens)

`privacy-ui.ts` `startJourney` / `continueJourney`, evaluated by the core's `privacy_entry`. Each
outcome in order:

1. **Ineligible network.** Blocked `network`: "Not available on this network", with "Choose a
   network", which opens the existing network picker.
2. **Unknown deployment.** `CheckDeployment`: the host shows the preparing screen and reads it with
   the transactions workstream's `deployment_status_request`. On failure: blocked `service`,
   "Private balances unavailable", detail "Account deployment could not be checked. Try again.",
   with "Try again".
3. **Undeployed.** If the reading is still `Idle`/`Loading`: "Checking private balances" (the
   preparing screen, `discovering` step) until it settles; then blocked `fund` when the loaded
   STRK balance is zero (`strk_funded == Some(false)`): "Initialize your account" with "Deposit
   some STRK, then come back"; else (funded, or not loaded yet) blocked `deploy`: "Deploy this
   account first" with "Deploy this account before enabling private balances". **Neither
   blocker's action is rendered** (`can_register = false`).
4. **Reading not settled.** `Discovering` until it settles.
5. **Read failed.** Blocked `service` with "Try again". The detail is the fixed fallback "Private
   balances unavailable" (service text is never surfaced; the extension shows its sanitised text).
6. **Registered** (extension: Send in Shield mode) and **unregistered** (extension: activation):
   blocked `unsupported` (§2.7). It has no action button, so it is laid out like `ledger`.

Preparing screen (`discovering` only): "Checking private balances" with no body, hint "Keep the
wallet open.", task list Check registration / Build registration proof / Review and confirm /
Broadcast to Starknet (only the first active), button "Back to wallet".

The `proving` step, the activation review, working, success and failure screens (stories
`02 Activation/*`) are **not built in v1**. Their copy is still captured in the fixture, so
adding them later is rendering work only. Every asynchronous result is scope-guarded by
`(account index, network, generation)`, as the extension does; a result from an older scope is
dropped.

### 2.6 Receive: "Public transfers only"

`receive-view.ts` `privacyPoolNotice`, shown only when a settled reading says `unregistered`, with
the action from `flows.ts` `poolNoticeAction` (unknown balances count as unfunded). Title "Public
transfers only" and one of three variants:

- **fund-first:** "Deploy this account and add STRK before enabling private balances.";
- **deploy-first:** "Enabling private balances takes two transactions: deploy, then register.
  Each has a network fee."; the deploy action is suppressed;
- **register:** "Enable private balances to receive privately." with "Enable privacy", which opens
  the journey and so reaches the Unsupported blocker.

### 2.7 Mobile-only copy (Unsupported), for product sign-off

- Title: "Not available in the mobile app yet"
- Detail: "Activating, shielding and private sends need the Bramble extension for now. Your
  private balance is safe and visible here."

## 3. UniFFI surface

All code is in new files under `mobile/core/src/privacy/`. Shared files get additive edits only:
`lib.rs` gains `mod privacy;` plus `pub use`; `kms.rs` gains the one Krusty call; `wallet.rs`
gains one crate-private accessor. `delete_wallet` needs nothing, because nothing is persisted.

**The same pattern as `TransferPlan`.** A core-owned read plan relays opaque bodies; the host
cannot pick URLs, reorder steps, or see the key. The core allocates ids and never reads the clock
(`now_ms` arrives on every reply, including `Start` and `WaitElapsed`).

The vocabulary (`privacy/types.rs`): `PrivacyState { network, account_id, registration,
balances: [PrivateBalance], pool_fee_fri, pool_address }`; `PrivacyStep::{Post { id, url, body:
Vec<u8>, purpose }, Rpc { id, body, purpose }, Wait, Finished, Failed}` (a `Post` body MAY CONTAIN
THE VIEWING KEY and its `Debug` prints `[redacted N bytes]`); `PrivacyReply::{Start, Http { id,
status, body, now_ms }, Rpc, TransportFailure, WaitElapsed}`, each with `now_ms`; fixed
`PrivacyFailure` codes (`NotConfigured, WrongChain, RpcUnavailable, ServiceUnavailable,
RateLimited, Reorg, BudgetExceeded, InvalidResponse, PoolReadFailed, Locked`); and the gate enums
`PrivacyReading, ShieldTile, PrivateLine, PoolNotice, PrivacyBlocker (+ Unsupported),
PrivacyEntry, DetailSummary, DetailAction, PrivacyStatus, UnifiedBalance`. `Ledger` and `Pending`
are unreachable on mobile; they keep the copy table complete.

The surface: `WalletCore::prepare_privacy_read(account_id)` (unlocked wallet; an OpenZeppelin
record on its own network, view-only and Ready records are `UnknownAccount`; records the session
generation, `NotConfigured` for Sepolia or an OHTTP network, no I/O) returns a
`PrivacyReadPlan` with `advance(reply)` (wrong id or kind → `OutOfOrder`, closed) and `close()`.
Pure functions: `privacy_configured`, `privacy_capabilities`, `max_privacy_response_bytes`,
`shield_tile`, `private_line`, `receive_pool_notice`, `privacy_entry(network, deployment,
strk_funded, reading, after_read)`, `token_detail_privacy`, `privacy_status`,
`shielded_balances_included`, `unified_home_balances`.

**Plan sequence**, in the extension's `stateResponse` order:

1. `Rpc ChainId`, judged by the existing `send::judge::chain` (mobile-only; see deviations).
2. `Post PreflightCheck`: `{contract_address, sender_address, viewing_key, recipient, token}`,
   recipient the account's own address, token the network's first bundled token
   (`readSetupRequirement`). `sender_registered: false` → `Unregistered`.
3. If registered, repeat `Post IncomingState` until `isApiCursorComplete`. Key order is the
   SDK's: `contract_address, recipient_address, viewing_key, cursor, block_ref`. The first page
   carries `cursor: {}` and no `block_ref`. **`block_ref` is pinned from the first reply**: it must
   be a canonical felt string, a block number (≤ 2^53 − 1) or one of the tags `latest`,
   `pre_confirmed`, `l1_accepted`. Every later page sends it with the reply's cursor (re-serialised
   in the reply's own key order, as `JSON.stringify` does), and every later reply must echo it
   exactly, or the plan fails `InvalidResponse`.
4. `Rpc PoolFee`: `starknet_call` of the pool's `get_fee_amount()`; exactly one felt,
   `fee ≤ UINT128_LIMIT − 1`.
5. `Finished`: balances for every bundled token in catalog order (`0` when no note).

**Retries and budgets: the extension's behaviour, mirrored.** All constants come from the
generated `privacy.json` (`MAX_SERVICE_ATTEMPTS`, `STRK20_WAIT_BUDGETS.discovery`).

- Each read — the preflight, the whole note discovery, the pool fee — is attempted at most 3 times.
- A discovery failure is retried only when the extension's `isRetryableStrk20ServiceError` would
  match the SDK's error: the SDK throws `Indexer API <path> failed (<status>): <body>` (or
  `Block reorged during <path>: <body>` for 409), so a retry happens only when the reply body text
  matches `/rate limit|too many requests|\bHTTP 429\b/i`. A bare 429 is **not** retried.
- The pause is always `attempt × 1 s`: the SDK's plain `Error` carries no headers, so
  `strk20RetryAfterMilliseconds` never sees a `Retry-After`. The host does not report it.
- A discovery retry restarts pagination from the first page (`cursor: {}`), as re-running
  `discoverNotes` does, with the accumulated totals and pinned `block_ref` dropped.
- The 60 s `STRK20_WAIT_BUDGETS.discovery` budget applies to **each indexer read attempt**
  (the preflight attempt, and each whole-discovery attempt), measured on host `now_ms`; a lapse is
  `BudgetExceeded` and is not retried (it is a `WalletError` in the extension). Pauses are outside it.
- The pool fee is retried on JSON-RPC `-32005`, or when the error's code, message and string
  revert data match the same pattern; the pause is `attempt × 1 s`.
- After the last attempt a throttled read fails `RateLimited`; 409 fails `Reorg`; any other
  non-2xx or transport failure fails `ServiceUnavailable`.

**Deviations from the extension** (each pinned by a fixture-4 or `privacy_plan.rs` case):

1. The chain-id proof before any privacy read (the extension trusts `rpcUrls[0]`).
2. `block_ref` must be echoed by every later page (the SDK overwrites it with each reply's). Honest
   replies echo it, so fixture 3's bodies stay byte-identical.
3. A mobile-only cap of 256 pages (the SDK has none).
4. Shapes are strict: numbers in the cursor must be safe integers, booleans must be booleans,
   duplicate keys are refused, and big integers use a fixed grammar. A reply that JS coercion would
   accept but this grammar refuses is `InvalidResponse`; the extension would show a balance.
5. A reply larger than `max_privacy_response_bytes()` (2 MiB) is refused; the SDK reads any size.
6. A pool-fee reply over HTTP 429 is a transport failure on mobile (the host RPC transport reports
   only 200 bodies), so it is not retried; starknet.js may retry it when its text matches.

**Viewing-key handling inside the core** (`privacy/plan_steps.rs`, via `wallet.rs` and `kms.rs`):

- `WalletCore::plan_viewing_key(generation, index, chain_id, pool)` checks the generation under the
  session lock, derives the per-call `SecretFelt` account key, and calls
  `derive_scoped_strk20_viewing_key(key, felt::canonical(chain_id), felt::canonical(pool))`.
- It re-validates the result (non-zero, below the curve order: the adapter's `isStarkPrivateKey`).
  The lock is held for the whole derivation, so the extension's before-and-after
  `requireLiveSession` check collapses into one.
- The key serialises one `Post` body into a `Zeroizing` buffer sized exactly up front (public
  parts built first, key hex pushed without a serde temporary), so no reallocation frees an
  unwiped copy; it is re-derived per page and never stored on the plan, in state, errors or `Debug` (`Post` prints
  `body: [redacted N bytes]`).

**What never crosses FFI:** the viewing key as a value, field or string; the account private key;
the recovery phrase (beyond SCOPE.md's existing exemptions); per-note data (ids, salts, channel
keys, senders, block numbers); the discovery cursor and `block_ref`; raw service text. **What does
cross:** opaque `Post.body` bytes (§1.1), per-token totals, the registration flag, the pool fee
and address, and fixed failure codes.

## 4. Storage and migration

- **Vault:** unchanged, so no migration. The software viewing key is derived on demand and never
  persisted (AGENTS.md). Mobile has no Ledger, so the v4 `accountSecrets` retained-key path does
  not apply, and the mobile payload (`bramble.mobile.vault.v1`) gains no field.
- **Private balances and discovery cursors:** in memory only (the plan holds the cursor;
  `WalletStore` the last `PrivacyState`). Nothing goes to disk. The extension persists no cursor.
- **Lock and backgrounding:** close every `PrivacyReadPlan` and clear privacy state, via additive
  lines in iOS `WalletStore.lock()` and Android `WalletStore.kt` `lock()`. A generation change
  fails any in-flight plan `Locked` at its next derivation.
- **Activity:** nothing is written, because nothing is submitted. The extension's `pending`
  registration state depends on a local activity entry whose summary is exactly `Activate private
  balances`; mobile never writes one, so **v1 has no pending state** (documented deviation). A
  registration submitted from the extension on the same phrase shows as `unregistered` until the
  indexer catches up. The transactions activity store and its summaries are untouched.
- **Routing config:** a new generated file, `mobile/core/generated/privacy.json`, embedded with
  `include_str!` like `networks.json`, rendered by `bun run mobile:assets` from
  `DEFAULT_STRK20_NETWORKS` (OHTTP networks rendered as not routed, §1.1), `STRK20_LIMITS`,
  `STRK20_WAIT_BUDGETS.discovery`, `MAX_SERVICE_ATTEMPTS` and `STRK20_MAX_POOL_FEE`, and
  byte-compared in `tests/conformance/mobile-generated.test.ts`. A separate file, not a
  `networks.json` field, so sibling branches do not conflict.

## 5. Threat model

| Threat | Mitigation |
| --- | --- |
| Viewing key leaks to UI, logs, storage or crash reports | Derived only inside `plan_viewing_key` and never returned across FFI. No record field holds it. `Post` Debug is redacted. Hosts never log step bodies (a Swift test asserts the store's observable state never contains the fixture key). Nothing about privacy is persisted. |
| Host or attacker redirects the key to another server | The URL comes from the embedded generated routing, not the host, and is `https` (re-checked in Rust at load). The one exception is the DEBUG discovery override (README "Pointing at your own privacy service"): it passes the same URL rules, only replaces an already-routed non-OHTTP network's URL, and a release core refuses it. The host transport for `Post` refuses every redirect, uses an ephemeral session without cache or cookies, and is HTTPS-only under ATS and `usesCleartextTraffic=false`. |
| Key sent in plaintext once upstream enables OHTTP | The generator renders an OHTTP network with no URL; the core loader refuses `ohttp: true` independently; `prepare_privacy_read` returns `NotConfigured`. Conformance and Rust tests pin both. |
| Key persists in memory | Krusty 0.11.0 returns a plain `Felt` (Copy, cannot be zeroized). The core holds it for one body build and serialises into an exactly sized `Zeroizing` buffer. The FFI copy is zeroed by the host after the send, but the HTTP/TLS stack's internal copies cannot be. Both **residual**; the upstream fix is in §9. |
| Key for the wrong network or pool, or reused across scopes | The scope string is built from the plan's `NetworkId` chain id and that network's generated pool. The endpoint must prove `starknet_chainId` first. No unscoped `derive_strk20_viewing_key` call exists; a grep test enforces this. |
| A reading from the previous network or account shows under the new one | Hosts reset privacy synchronously on network and account switch and at the start of every balance refresh whose scope changed (`retain`); the core ignores a `PrivacyState` whose network differs from the requested one (`in_scope`; ETH and STRK share addresses across networks). |
| Use after lock | The generation is checked under the session lock at every derivation; plans close on lock and backgrounding; stored state is cleared. |
| Hostile or faulty discovery service returns fake balances | Responses are untrusted. Each is bounded (2 MiB) and parsed into fixed shapes. The `balancesFrom` rules apply: at most 64 tokens and 4,096 notes, `0 < token < P`, `0 ≤ amount < P`, every per-token total `< P`. A note whose sender has no channel key fails, as in the SDK. Any violation gives `InvalidResponse`, and the UI shows "Unavailable", never a partial balance. **Residual:** without the privacy hashes (§9) the core cannot recompute `note_id`, so a service that lies within the bounds can show a wrong total. The extension has the same exposure. Balances are display-only in v1. |
| Service switches blocks mid-pagination (stale, replayed or hostile page) | `block_ref` pinned from the first reply and required on every later reply; a change is `InvalidResponse`, so notes from two chain states are never summed. Stricter than the SDK. |
| Service loops or stalls pagination | The 60 s budget per read attempt on host time, the 256-page cap, and 3 attempts with 1 s / 2 s pauses. |
| Hostile service injects content through error text | Errors are fixed `PrivacyFailure` codes; service text is never surfaced. It is read only to match the retry pattern. |
| Hostile node misreports the pool fee | Exactly one felt, `< 2^128`, otherwise `PoolReadFailed`. In v1 the fee is display-only. |
| A proof reaches submission through some other call | No proof path exists in v1. When §9 lands, only the configured pool's `apply_actions` may carry a prepared proof, checked in the core before signing. |
| User deploys for a feature they cannot use | Deploy actions are suppressed on privacy surfaces (§2.1, the #402 principle). |
| Discovery reveals which addresses are this wallet's to the operator | Inherent to the protocol and the same as the extension **while OHTTP is off**, which is now a condition of the §1.1 exemption. Once upstream enables OHTTP, mobile stops routing that network rather than exposing more than the extension. The read runs only for the unlocked active account on a configured network, as the extension's auto-discovery does. |
| Tests leak the key or hit live services | Fixtures use the published parity phrase, so every key is public. The live test is opt-in and refused under CI (§7). |

## 6. Parity fixtures (pin behaviour to the extension)

`scripts/mobile-privacy-fixture.ts`, run by `bun run mobile:parity`, writes
`mobile/core/tests/fixtures/extension-privacy-{wire,rules,copy}.json`; `bun run check` recomputes
and compares them. Everything comes from the extension's real code, driven with a recording
`fetch` stub that has no network.

1. **Viewing keys.** The real Krusty WASM through the extension adapter
   (`packages/platform/kms-krusty/src/adapter.ts`) for parity-phrase accounts 0 and 1 on `SN_MAIN`
   + `STRK20_MAINNET_POOL`; the three Krusty crate vectors to prove WASM and crate agree; refusals
   (pool `0x01`, uppercase hex, zero pool). All values are public by construction.
2. **Routing.** The `privacy.json` payload from `DEFAULT_STRK20_NETWORKS`, the absence of Sepolia,
   and two synthetic configs (`ohttpEnabled: true`, and an `ohttpRelayUrl`) that must render no
   URL (also asserted in the conformance test and in Rust).
3. **Request bodies.** The extension's `createOfficialStrk20Service` over the vendored SDK bundle,
   against the recording stub with parity key 0: the exact bytes and URLs of the preflight body and
   of the first, second and third `incoming_state` bodies (honest replies echoing `block_ref`,
   with a nested subchannel cursor). The Rust core must produce **byte-identical** bodies. The pool
   `get_fee_amount` `starknet_call` params come from `readStrk20PoolFee`.
4. **Response judging.** Recorded and synthesised replies with the outcome of the real
   `privateBalances` → `balancesFrom` path (balances, or error): empty; one token; several tokens;
   three-page pagination; a nested incomplete subchannel cursor; 64/65 tokens; 4,096/4,097 notes;
   amount P − 1 and P; per-token overflow; token `0x0`; sender without a channel key; 409; a bare
   429 (not retried); a 429 whose body says "Too Many Requests" (retried, then succeeds); 500;
   malformed JSON; preflight `sender_registered` true/false; fee `2^128 − 1`, `2^128`, a two-felt
   reply; and a later page whose `block_ref` changes (the extension's balance, recorded beside
   mobile's `InvalidResponse`). The retry cases record the extension's pause arguments.
5. **Gates.** A truth table over (network configured, deployment ∈ {deployed, undeployed,
   unknown}, STRK ∈ {unknown, 0, >0}, reading ∈ {idle, loading, failed, unregistered,
   registered}) giving `shieldTile` (label, aria, action), `privateBreakdownLine`,
   `privacyPoolNotice`, the `tokenDetailFlow` summary and `privacyActions`, the `startJourney`
   outcome (driven through `bindPrivacy` in a DOM), `privacyDataIssue`, and
   `unifiedHomeBalances` + `compactAmount` for several public/private mixes (including a
   private-only token and STRK ordering). Rust asserts the enum mapping; Swift the strings.
6. **Copy.** Every string in §2, read from the rendered extension templates. These generate
   `PrivacyCopy.generated.{swift,kt}` (`scripts/mobile-privacy-copy.ts`). The two mobile-only
   strings sit in a separate `mobileOnly` section.

## 7. Test plan (as built)

**Rust** (`cargo test --locked`): unit tests beside each `privacy/` module, plus
`tests/privacy_parity.rs` (fixture 1 keys through `#[doc(hidden)] testing::strk20_viewing_key`,
never FFI; fixture 2 routing incl. the OHTTP configs; fixture 3 byte-identical bodies and fee
params; every fixture-4 outcome, request count and pause; every fixture-5 gate, journey, unified
row and compact amount), `tests/privacy_plan.rs` (ordering, lock after re-unlock, per-attempt
budget, restart from page one, classification, changed `block_ref`, page cap, unregistered) and
`tests/privacy_key_boundary.rs` (the key's hex appears only inside `Post` bodies; no unscoped
`derive_strk20_viewing_key` anywhere in `src`). The core has no HTTP client; the opt-in live read
`tests/privacy_mainnet.rs` moves its bytes with the system `curl` (README).

**Swift unit** (`BrambleTests`): `PrivacyBridgeTests` (fixture-3 bytes through the Swift model,
fixture-5 strings, the mobile-only pair), `PrivacyModelTests` (Sepolia makes no plan, failure and
reset, a locked core never posts, Swift state never holds the key, cleartext refused), and
`MainnetPrivacyTests`: skipped unless `TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_LIVE_ACK` is the exact
acknowledgement and no CI marker is set; read-only; sends that wallet's viewing key to the Mainnet
discovery service, as the extension would. Run only with the wallet owner's authorisation.

**XCUITest** (`BrambleUITests/PrivacyFlowTests.swift`), with the DEBUG-only
`-BramblePrivacyFixture <scenario>` beside the offline node `-uiTestOfflineFixtures <state>` (which
also answers the portfolio's balance reads): registered (unified ETH row, "Includes shielded
balances", token detail's "Private balance" with Shield and Unshield disabled, tile → Unsupported),
unregistered (token detail's "Register to start shielding" and "Go private", Receive notice,
"Enable privacy" → Unsupported), service-failed (retry row, service blocker), undeployed-funded
(token detail's "Shield" and the tile → deploy blocker, **no** deploy button), undeployed-unfunded
(tile → fund blocker, "Deposit some STRK, then come back"), Sepolia (network blocker). A launch
with only `-uiTestOfflineFixtures` (Send's suite) gets an `offline` privacy fixture, and the live
onboarding suite passes `offline`, so no UI test sends a viewing key anywhere.

## 8. Files

- **Rust:** `mobile/core/src/privacy/{mod, types, config, json, bodies, judge, notes, plan,
  plan_steps, gates, home, wallet_ext}.rs`, `generated/privacy.json`; additive `lib.rs`, `kms.rs`,
  `wallet.rs`; tests `privacy_{parity, plan, key_boundary}.rs` and `privacy_support/`.
- **Scripts:** `scripts/mobile-assets/privacy.ts`, `scripts/mobile-privacy-{cases, wire, gates,
  copy, fixture}.ts`, `scripts/generate-mobile-privacy-vectors.ts`; additive lines in
  `scripts/mobile-assets.ts`, `scripts/generate-mobile-parity-vectors.ts` and the conformance test.
- **iOS:** `Bramble/Privacy/{PrivacyModel, PrivacyTransport, PrivacyPresentation,
  FixturePrivacyTransport, PrivacyCopy.generated}.swift`, `App/WalletStore+Privacy.swift`,
  `Screens/Privacy/{PrivacyViews, PrivacyJourneyView}.swift` (incl. the unrouted
  `TokenPrivacySection`); additive `WalletStore`, `HomeView`, `ReceiveView`, `WalletShell`,
  `project.yml`, and the onboarding UI test's launch arguments.
- **Android (uncompiled):** `org/bramble/wallet/privacy/{PrivacyDriver, PrivacyModel,
  PrivacyViews, PrivacyCopy.generated}.kt`; additive `WalletStore.kt`, `ui/Screens.kt`. The
  Android app reads no deployment yet, so its gates get `Unknown` and its journey shows only the
  blocked screen.

## 9. Out of scope, and what Krusty 0.11.0 lacks

- **Out of scope:** swap, multisig, dapp privacy flows (stories 05), guided walkthroughs (06),
  user-edited routing, gateway analytics headers, OHTTP (and therefore any OHTTP-routed network),
  Ledger, incremental discovery cursors (`last_known_block`), and the `pending` registration state.
- **Blocked on an upstream sans-IO Rust privacy client**, pinned exactly (in krusty-kms or a
  published starknet-privacy crate): activation (registration), shield, private transfer and
  unshield. The client would need: (1) the tagged Poseidon hashes (identity and channel keys,
  channel and subchannel markers, `note_id`, nullifier, `enc_*`) and ECDH channel and note
  encryption; (2) the client-action compiler and pool simulator, with `compile_actions(user,
  viewing_key, actions)` serialised against the pool ABI; (3) the CallSet SNIP-12 signer and a
  proof-invocation plus proof-facts builder; (4) `ServerAction` decoding into `apply_actions`.
  Proving stays remote. Krusty 0.11.0 already provides `compute_invoke_v3_hash_with_proof_facts`
  and signing. With that client, submission becomes a new `Kind` on the transactions workstream's
  `TransferPlan`, not a second submission path, carrying the extension's gates: registration
  re-checked before proving, pool fee equal to the reviewed fee, `assertNoPrivacyLeak`, warnings
  judging (`USER_LINKAGE` fails), and only the configured pool's `apply_actions` carries a proof.
  The privacy repo's `crates/discovery-core` is the natural source, but it is unpublished, takes
  its `starknet-rust` dependencies from git, and is async, so it cannot be pinned as it stands.
- **OHTTP:** supporting an OHTTP network on mobile needs an HPKE/OHTTP client (upstream, pinned)
  or a host-side one reviewed as a new SCOPE.md decision. Until then such a network is not routed.
- **Useful upstream, not blocking:** a `derive_scoped_strk20_viewing_key` variant that takes and
  returns `SecretFelt`, so the key can be zeroized. v1 documents that residual (§5).
- **Rejected alternative:** running the vendored TS SDK in an on-device JS engine. It would enable
  submission, but it breaks "all protocol logic in the Rust core" and would need its own SCOPE.md
  decision.

## 10. Review resolutions

1. **OHTTP silently bypassed** → §1.1 condition 4, generator and loader rules, §5 rows, fixture 2.
2. **`block_ref` could change mid-pagination** → §3 step 3, deviation 2, §5 row, fixture 4 and
   `privacy_plan.rs` cases; stricter than the SDK, honest bodies unchanged.
3. **Home totals omitted private value** → §2.1, §2.2 `unified_home_balances`, compact private
   line, fixture 5 unified cases.
4. **Invented "Private balance view"** → §2.4 removed; Ready tile → Unsupported blocker.
5. **Token-detail rules missing** → §2.3 `token_detail_privacy` table, fixture 5.
6. **Retry rules mislabelled as parity** → §3 now mirrors the extension exactly (text-matched
   retries, `attempt × 1 s`, restart from page one, 60 s per read attempt) and lists every
   remaining difference under "Deviations", each with a fixture case.
7. **Viewing key in host memory (round 2)** → hosts wipe the body after the send, comments no longer
   claim the key never reaches Swift/Kotlin, and §1.1 states the deviation; signed off 2026-09-24.
8. **Unwiped key copies in the core** → `bodies.rs` builds into one exactly sized buffer.
9. **Stale scope after a switch** → `retain`/`reset` in the hosts and `in_scope` in the core (§5).
