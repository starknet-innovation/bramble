---
layout: default
title: Source package security audit
permalink: /security-audit/src-package-audit/
---

# Source package security audit

| Field | Value |
| --- | --- |
| Status | Remediated and validated |
| Baseline | `8d91d78521deaada2b914b993b08c3c9d577b81e` (`v0.5.0`) |
| Reviewed | 2026-07-23 |
| Remediated | 2026-07-23 |

## Executive summary

This review followed untrusted page, storage, RPC, swap, prover, metadata, and phishing-feed inputs
through every immediate package under `src/`. The baseline review covered 186 TypeScript files and
33,163 lines across 12 packages.

All nine confirmed findings are resolved without removing a wallet feature. Remote-produced swap
calls are frozen and committed before confirmation; STRK20 intent and fee plans are frozen before
approval and proved afterward with a call-set-bound signer; approvals have one-time, context-bound
semantics; write RPC failover stops before submission; plain stores serialize mutations; and
hostile payloads are bounded before expensive work.

| Severity | Identified | Resolved | Open |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 3 | 3 | 0 |
| Low | 4 | 4 | 0 |

The controls documented here are implemented and regression-tested in the remediation derived
from the baseline above. A source-branch remediation is not by itself a claim that a published
extension release contains the fixes.

## Resolution checklist

- [x] [MCW-SRC-001](#mcw-src-001) — freeze and re-review the final AVNU call bundle.
- [x] [MCW-SRC-002](#mcw-src-002) — bind approved STRK20 intent to proving and submission.
- [x] [MCW-SRC-003](#mcw-src-003) — prohibit write replay after submission begins.
- [x] [MCW-SRC-004](#mcw-src-004) — bind sensitive approvals to account, network, chain, and digest.
- [x] [MCW-SRC-005](#mcw-src-005) — atomically claim every approval before awaited work.
- [x] [MCW-SRC-006](#mcw-src-006) — recheck the live origin blocklist at execution time.
- [x] [MCW-SRC-007](#mcw-src-007) — serialize plain-store read-modify-write transactions.
- [x] [MCW-SRC-008](#mcw-src-008) — fully validate cached phishing-feed records.
- [x] [MCW-SRC-009](#mcw-src-009) — enforce shared and protocol-specific resource budgets.

## Findings summary

The high- and medium-severity entries are intentionally sanitized for a public documentation
route. Reproduction payloads and exploit mechanics belong in private security advisories until a
fixed release is available.

| ID | Severity | Status | Affected packages | Summary |
| --- | --- | --- | --- | --- |
| [MCW-SRC-001](#mcw-src-001) | High | Resolved | `background`, `sidepanel`, `starknet` | Swap executes only a one-time, reviewed, committed call bundle |
| [MCW-SRC-002](#mcw-src-002) | High | Resolved | `background`, `starknet`, `wallet` | STRK20 proves frozen intent after approval and validates the resulting configured-pool call |
| [MCW-SRC-003](#mcw-src-003) | Medium | Resolved | `background`, `starknet` | State-changing RPC work is never failed over after execution starts |
| [MCW-SRC-004](#mcw-src-004) | Medium | Resolved | `background` | Sensitive approvals carry an immutable execution context |
| [MCW-SRC-005](#mcw-src-005) | Medium | Resolved | `background` | Approval execution atomically claims the pending item |
| [MCW-SRC-006](#mcw-src-006) | Low | Resolved | `background`, `security` | Live blocklist state is rechecked after claim and before execution |
| [MCW-SRC-007](#mcw-src-007) | Low | Resolved | `storage` | Plain-storage mutations are serialized across the full transaction |
| [MCW-SRC-008](#mcw-src-008) | Low | Resolved | `security`, `storage` | Cached phishing records use strict schema, source, time, and domain validation |
| [MCW-SRC-009](#mcw-src-009) | Low | Resolved | `provider`, `shared`, `starknet` | Shared structural and protocol-specific budgets reject oversized payloads |

## Package-by-package review

“No new finding” means this pass did not confirm a source vulnerability in that package at the
audited baseline. It is not a guarantee that the package contains no defect.

### `src/background/`

**Scope:** 40 files, 7,874 lines. Privileged message routing, sender classification, dapp grants,
approval lifecycle, unlock sessions, transaction dispatch, and activity recording.

**Confirmed controls:**

- Runtime senders are classified before dispatch, and dapp-reachable message types are explicitly
  allowlisted.
- Claimed dapp origins are checked against the content-script sender origin.
- Privileged wallet messages fail closed for content-script and foreign-extension senders.
- State-changing dapp requests require an origin grant and are held for an extension-page approval.
- Locked sessions fail closed, and signing selects an explicit account identifier.

**Resolved findings:** MCW-SRC-001 through MCW-SRC-006. The background now freezes remote-produced
execution calls before review, commits sensitive approvals to immutable context, claims decisions
atomically, and rechecks live blocklist state before side effects.

### `src/content/`

**Scope:** 1 file, 97 lines. Isolated-world relay between the page provider and the runtime.

**Confirmed controls:**

- Only same-window messages with the exact provider marker and current page origin are relayed.
- Runtime responses are correlated to the original page request identifier.
- The relay does not expose signing keys, vault operations, or privileged wallet messages.

**Findings:** No new finding.

### `src/crypto/`

**Scope:** 2 files, 230 lines. Krusty KMS WASM loading and validation.

**Confirmed controls:**

- Wallet cryptography has no local fallback.
- Inputs and KMS outputs are checked at the adapter boundary.
- Invalid or unavailable WASM behavior fails closed.
- Private keys are passed only to the KMS signing boundary and are not logged.

**Findings:** No new finding. The upstream Krusty implementation remains outside source-review
scope; its pin and extension integration remain in scope.

### `src/popup/`

**Scope:** 7 files, 973 lines. Popup rendering and privileged response parsing.

**Confirmed controls:**

- Background responses are parsed with exact shape guards before use.
- Dynamic values render through text nodes or escaped templates.
- The popup does not read raw browser storage or perform signing directly.

**Findings:** No new finding.

### `src/provider/`

**Scope:** 9 files, 1,724 lines. Injected Starknet provider, method mapping, request correlation, and
page-facing result conversion.

**Confirmed controls:**

- Provider methods map to a fixed set of wallet messages.
- Request identifiers are generated per call, responses must match source and origin, and pending
  requests are capped at 100.
- Felt-like values and background results are normalized and validated before crossing the page
  boundary.

**Resolved finding:** MCW-SRC-009. Page payload normalization now enforces byte, node, depth,
string, key, and array budgets plus shared invoke call/calldata limits.

### `src/security/`

**Scope:** 2 files, 500 lines. Bundled phishing blocklist, live feed, origin history, and lookalike
heuristics.

**Confirmed controls:**

- The bundled baseline remains active when the live feed is unavailable.
- Fresh feed entries are normalized, de-duplicated, and capped.
- Exact-domain and subdomain matches are blocked, while lookalike, punycode, and suspicious-TLD
  signals are surfaced as warnings.

**Resolved findings:** MCW-SRC-006 and MCW-SRC-008. Approval execution consults the live guard, and
cached feeds require exact keys, schema/source/time validity, normalized unique domains, and the
same maximum count as a fresh feed.

### `src/shared/`

**Scope:** 8 files, 416 lines. JSON guards, HTML escaping, errors, browser types, and URL helpers.

**Confirmed controls:**

- JSON inspection uses own enumerable data properties and rejects accessors, prototype surprises,
  non-finite numbers, and cycles.
- HTML escaping covers the characters needed by the audited string-template sinks.
- Wallet origins normalize to HTTPS origins or explicit localhost development origins.

**Resolved finding:** MCW-SRC-009. The shared JSON boundary now performs cycle-safe,
accessor-safe, prototype-safe normalization under explicit resource budgets.

### `src/sidepanel/`

**Scope:** 66 files, 11,944 lines. Wallet UI, approval cards, secret reveal/import, swaps, NFTs,
multisig, and settings.

**Confirmed controls:**

- Audited dynamic HTML values are escaped; other dynamic text uses `textContent`.
- Secret reveal requires passphrase re-entry, starts obscured, and is cleared on the next render.
- Raw-key import is a privileged extension-page operation and does not expose the key to dapps.
- Remote NFT image URLs are normalized, and unsolicited images are withheld until user action.
- Approval views render decoded summaries and risk flags supplied by the privileged background.

**Resolved finding:** MCW-SRC-001. The side panel prepares the final calls first and displays their
decoded summaries, risk flags, and commitment before enabling the separate confirmation action.

### `src/starknet/`

**Scope:** 28 files, 5,394 lines. Network definitions, RPC access, transaction construction,
verification, tokens, swaps, NFTs, multisig, deployment, declarations, and STRK20.

**Confirmed controls:**

- Addresses, field elements, class hashes, RPC results, token metadata, and protocol responses are
  validated at their boundaries.
- Known calldata is decoded into review summaries and risk flags.
- Account and multisig deployment parameters are checked against pinned class hashes and expected
  addresses.
- NFT indexer results are re-proved against on-chain ownership before persistence.
- Remote scans and selected response lists are bounded.

**Resolved findings:** MCW-SRC-001, MCW-SRC-002, MCW-SRC-003, and MCW-SRC-009. Remote swap calls
and STRK20 public intent are frozen before approval, write endpoints are selected with read-only
probes and invoked once, and opaque remote responses are bounded before mapping.

### `src/storage/`

**Scope:** 15 files, 2,806 lines. Encrypted vault, migrations, schema validation, permissions,
preferences, activity, allowances, multisig records, and origin history.

**Confirmed controls:**

- Vault encryption uses AES-256-GCM with scope-specific additional authenticated data.
- Passphrases use PBKDF2-SHA-256 with 600,000 iterations and random salts; ciphertexts use random
  IVs.
- Vault schemas reject unknown or invalid data, migrations are adjacent and deterministic, and
  encrypted vault mutations are serialized.
- Dapp permission reads go through the encrypted grant store rather than raw browser storage.

**Resolved findings:** MCW-SRC-007 and MCW-SRC-008. Every mutable plain store serializes its full
read-modify-write operation, and malformed phishing cache data is discarded rather than promoted.

### `src/ui/`

**Scope:** 6 files, 448 lines. Skin, scale, motion, and styling primitives.

**Confirmed controls:**

- The package contains no network, storage, message, signing, or secret-handling effects.
- Skin inputs reject missing, extra, accessor, and hidden token properties.
- UI colors and dimensions remain centralized in audited tokens.

**Findings:** No new finding.

### `src/wallet/`

**Scope:** 2 files, 757 lines. Account derivation/import, encrypted vault orchestration, account
selection, grants, and signing-key lookup.

**Confirmed controls:**

- Derived and imported accounts use Krusty KMS only; no fallback key derivation or signing exists.
- Imported private keys must be canonical, non-zero Stark private keys. KMS-derived public data and
  addresses are checked before persistence.
- Imported and derived keys are stored only in the encrypted vault.
- Signing resolves the key for an explicit account identifier and fails if the account/key pair is
  absent or inconsistent.
- Vault writes are serialized and duplicate accounts are rejected.

**Findings:** No new finding. Approval-time selection of the account belongs to `src/background/`
and is covered by MCW-SRC-004.

## Detailed findings

<a id="mcw-src-001"></a>

### MCW-SRC-001 — Swap build output is not proven equivalent to the approved quote

**Severity:** High; **Status:** Resolved

**Control gap.** Quote fields are checked against the requested pair and amount, but execution
later accepts a separately fetched call bundle. The local policy bounds the call count and rejects
a narrow class of unexpected token approvals. The generic call verifier produces review metadata;
it does not reject every unknown contract or operation. The user confirms quote economics rather
than the final executable call bundle.

**Impact.** A compromised or malicious swap build service can cause the wallet to sign a call that
has a valid shape but is not proven to implement the reviewed swap intent.

**Resolution.** Swap is now a two-phase prepare/execute flow. The background sends the account,
network, quote identifier, and slippage to AVNU before confirmation; requires the build response
to identify the expected chain; bounds and verifies the final calls; permits at most one approval,
only on the tracked sell token, for exactly the sell amount; and commits the full calls plus review
metadata to SHA-256. The side panel displays the decoded final-call summaries, risk flags, and
commitment before confirmation. Execute accepts only the preparation id, atomically claims it,
rechecks account/network/chain/digest, and submits the frozen calls without contacting AVNU again.

**Validation.** `tests/starknet/avnu.test.ts` rejects a chain-mismatched build.
`tests/background/swap-ops.test.ts` proves the final calls are built before confirmation, execute only once,
and reject an unexpected approval token or allowance before signing.

<a id="mcw-src-002"></a>
### MCW-SRC-002 — STRK20 prover output is not bound to the approved private actions

**Severity:** High; **Status:** Resolved

**Control gap.** The wallet validates the requested private actions, registration, private balance,
and response shape. At approval execution it asks the configured prover to build a fresh
call-and-proof envelope and submits the returned call. The wallet does not locally establish that
the returned executable call commits to the approved actions, account, network, and expected
STRK20 contracts.

**Impact.** A compromised or malicious configured prover can substitute a structurally valid call
for the private operation the user reviewed.

**Resolution.** The official pinned Privacy SDK now owns discovery, transaction assembly, and proving.
Before approval the wallet validates the actions and balances, freezes the paymaster fee and typed
data, binds those values plus account/network/chain into the approval digest, and produces no proof
or signature. After approval it repeats affordability checks and gives the exact actions plus fee
to the SDK. Its SNIP-12 signer commits the account, chain, and complete call set. The wallet rejects
warnings, non-`apply_actions` output, and unconfigured pool targets, and submits non-empty proofs
only through the configured private paymaster. Prepared proofs are also retained in the digest and
restricted to that pool entry point.

**Validation.** Background tests prove no signing/proving before approval and reuse of the held
intent. Call-set, SDK, paymaster, schema, provider, key-boundary, and vault suites cover the
official hash vector, warning/target rejection, proof retention, fees, commitments, and viewing keys.

<a id="mcw-src-003"></a>
### MCW-SRC-003 — Ambiguous state-changing RPC submissions use general endpoint failover

**Severity:** Medium; **Status:** Resolved

**Control gap.** The common RPC fallback helper retries its callback on transport errors at the next
configured endpoint. Invoke, declare, and account-deployment paths wrap transaction construction
and submission in that helper. A lost response does not distinguish “not accepted” from “accepted
but acknowledgement lost.”

**Impact.** A state-changing intent can be rebuilt, re-signed, or rebroadcast after ambiguous
acceptance. Depending on nonce and node state, this can produce duplicate, conflicting, or
misreported submissions.

**Resolution.** `withRpcFallback` remains read-only. State-changing invoke, declare, and
account-deployment paths use `withRpcWrite`, which probes endpoints with `getChainId`, selects one
matching the expected network, and invokes the write callback exactly once. Any transport failure
after that point is returned as an explicit unknown-submission-status error and is never replayed
through another endpoint.

**Validation.** `tests/starknet/starknet-rpc.test.ts` simulates preflight transport failure followed by a
post-begin connection reset and asserts that only the selected endpoint receives the write.
Declare, invoke, transfer, and deployment operation tests exercise the new write path.

<a id="mcw-src-004"></a>

### MCW-SRC-004 — Pending approvals are not bound to the reviewed account and network

**Severity:** Medium; **Status:** Resolved

**Control gap.** Invoke, typed-data, declaration, and STRK20 approvals retain the requested payload
and origin but not an immutable account, network, chain, and payload digest. Their executors
re-resolve the active account and network when the user eventually approves.

**Impact.** If wallet context changes while a request is pending, the account or chain used for the
signature can differ from the context presented during review.

**Resolution.** Invoke, typed-data, declaration, and STRK20 approvals now record
`{ accountId, networkId, chainId, payloadDigest }` at queue time. The side panel renders the bound
account, network, and review digest. Decision handling rechecks the unlocked session, active
network, chain, origin grant, exact account, and private-payload digest. Each downstream executor
also selects the recorded account rather than re-resolving an arbitrary active account.

**Validation.** `tests/background/approval-security.test.ts` proves network drift and payload substitution are
refused without submission. The invoke, declare, typed-data, and STRK20 approval suites exercise
the bound context on successful execution.

<a id="mcw-src-005"></a>

### MCW-SRC-005 — Approval execution is not claimed atomically before its side effect

**Severity:** Medium; **Status:** Resolved

**Control gap.** Approval handling reads a pending item, awaits the kind-specific executor, and
removes the item only after the side effect finishes. Concurrent decisions can therefore observe
the same approval as pending before either removes it.

**Impact.** Repeated extension-page decisions can execute one reviewed intent more than once,
including a duplicate transaction submission, despite the queue presenting a single pending item.

**Resolution.** The queue exposes an atomic synchronous `claim(id)` operation that removes the
entry and returns a cloned public snapshot plus its private payload. Approve and deny both claim
before any awaited validation or executor work. Every success or failure is terminal and settles
the held request; a second decision receives `approval not found` and cannot reach an executor.

**Validation.** `tests/background/approval-security.test.ts` drives two concurrent approve decisions while the
first executor is paused and observes exactly one side effect.

<a id="mcw-src-006"></a>

### MCW-SRC-006 — Dynamic blocklist state is not rechecked at approval execution

**Severity:** Low; **Status:** Resolved

**Control gap.** Dapp requests are checked before queueing, and pending-list rendering consults the
current origin guard. The approval executor itself does not receive or consult that guard.

**Impact.** An origin added to the dynamic blocklist after queueing can still execute through a
stale approval decision. An explicit extension-page action is still required, which constrains the
impact.

**Resolution.** The live `OriginGuard` is a required approval-decision dependency. Immediately
after the atomic claim and before context checks or executor dispatch, a blocked origin is refused,
the held dapp request is settled with the error, and the claimed item remains terminal.

**Validation.** `tests/background/approval-security.test.ts` queues an allowed request, makes its origin
blocked before decision, and proves the side effect count remains zero.

<a id="mcw-src-007"></a>

### MCW-SRC-007 — Plain-storage read-modify-write operations can lose concurrent updates

**Severity:** Low; **Status:** Resolved

**Control gap.** Encrypted vault mutations use a serialization queue. Activity, allowance,
preferences, multisig, and origin-history stores perform independent read-modify-write sequences
without equivalent serialization, while background handlers can run concurrently.

**Impact.** Concurrent successful operations can overwrite one another's records. Lost activity
and allowance entries reduce transaction auditability and can make local safety views stale.

**Resolution.** Activity, allowance, preferences, multisig, and origin-history stores now wrap
every mutating public method in a shared per-instance promise queue. Each queued mutation owns its
complete asynchronous read-modify-write transaction; read-only methods remain concurrent, and a
failed mutation does not poison later work.

**Validation.** `tests/storage/storage-concurrency.test.ts` uses simultaneous mutations against all five
stores and verifies every non-conflicting update remains in final storage.

<a id="mcw-src-008"></a>

### MCW-SRC-008 — Persisted phishing-feed cache bypasses fresh-feed normalization and bounds

**Severity:** Low; **Status:** Resolved

**Control gap.** Fresh feed data is normalized and capped. The persisted-cache guard checks only
broad field types, then promotes cached domains directly into the active set without enforcing
domain syntax, source identity, key exactness, or the maximum entry count.

**Impact.** Tampered or malformed local storage can over-block unrelated origins or consume
excessive memory. The bundled blocklist remains active, so this does not remove its protection.

**Resolution.** Cache reads now require exact enumerable keys, schema version 1, the configured
source URL, a finite non-negative timestamp no later than the current clock, at most 100,000
domains, and a fully normalized unique domain list. One invalid item rejects the entire cache;
fresh-source failure still preserves only a previously validated snapshot plus the bundled
baseline.

**Validation.** `tests/security/security-phishing-feed.test.ts` rejects unknown keys, schema/source
mismatch, future timestamps, malformed domains, and duplicate domains.

<a id="mcw-src-009"></a>

### MCW-SRC-009 — Dapp and remote payload containers lack a common structural budget

**Severity:** Low; **Status:** Resolved

**Control gap.** JSON, felt, typed-data, declaration, invoke, and STRK20 guards validate types and
selected field counts, but several recursive or opaque containers have no total serialized-byte,
depth, node, string, or inner-array limit before cloning, hashing, storing, or rendering.

**Impact.** A malicious dapp or remote service can force excessive page, content-script, or
background CPU and memory use, potentially making the wallet temporarily unavailable. No secret
disclosure or signing bypass was established.

**Resolution.** Shared JSON normalization now tracks maximum bytes, nodes, depth, string length,
object keys, and array length while rejecting accessors, symbol keys, sparse arrays, cycles,
non-plain prototypes, and throwing proxies. Method-specific budgets distinguish provider payloads,
typed data, and contract classes. Shared invoke call/calldata limits, STRK20 action/proof limits,
AVNU list/call limits, and HTTP response-size checks bound protocol fan-out before expensive use.

**Validation.** `tests/shared/json.test.ts`, `tests/provider/provider-bridge-results-guards.test.ts`, and
`tests/starknet/typed-data.test.ts` cover structural, call/calldata, cycle/accessor, and oversized typed-data
rejection. The full boundary suites verify valid maximum-shape behavior remains accepted.

## Validation evidence

- Manual review of all 12 `src/` packages: 194 TypeScript files and 34,265 remediated source lines.
- `bun run check` completed successfully: strict types, file/import/cycle standards, extension
  manifest, pinned artifacts, and 1,932 unit tests with 0 failures. Biome returned success but
  emitted its pre-existing internal diagnostics for two files plus the provider-tester warning;
  those diagnostics remain a tooling limitation rather than clean lint evidence.
- `bun run build` produced a loadable MV3 extension.
- `bun run test:e2e` passed all 8 Playwright extension scenarios in Chromium.
- Focused regressions cover call binding, approval context, RPC writes, storage, phishing, and budgets.
- The browser suite initially exposed decimal calldata incompatibility in the new invoke budget
  guard. Canonicalizing provider decimal felts fixed it; its unit regression and E2E suite pass.

## Scope limits

This was a source, unit-assurance, build, and browser-E2E review. It did not re-audit the upstream
Krusty KMS or official Privacy SDK implementations, external RPC nodes, AVNU, privacy discovery,
prover, paymaster/relay deployments, browser internals, or generated artifacts. Their pinned
artifact and wallet-facing input/failure boundaries were in scope.

CI/release authority, build and packaging scripts, contracts, and the terminal app remain separate
review stages. The v0.6 Ledger and multisig changes are covered by the
[release follow-up](../releases/v0.6/).

## Residual risk and release guidance

All nine findings are resolved. External services remain untrusted: the new controls constrain
their output but cannot establish that a remote service is honest or available.

This remediation is not a published extension release until it passes CI and packaging gates.
Follow-on changes must be re-audited against the affected trust boundaries before merge.
