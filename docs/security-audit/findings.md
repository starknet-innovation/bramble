---
layout: default
title: Audit findings
permalink: /security-audit/findings/
---

# Sanitized findings ledger

This public ledger omits reproduction payloads and exploit mechanics for unremediated
medium-or-higher findings. The consolidated source report records the affected trust boundary,
impact, remediation, and retest condition.

The **Summary** column states each finding as it was found, against the release it was found in;
the **Status** column states where it stands today. A row reading `Resolved` beside a summary
written in the present tense is describing the defect that was fixed, not one that is still live —
follow the link for what shipped.

| ID | Severity | Status | Area | Summary |
| --- | --- | --- | --- | --- |
| MCW-AUD-001 | Low | Resolved | Root tooling | Biome analyzes the repository without the prior internal panics |
| [MCW-CI-001](../reviews/01-github-workflows/#mcw-ci-001--fork-branch-name-could-authorize-the-self-hosted-release-runner) | High | Resolved | PR validation | Fork-controlled branch names cannot authorize the self-hosted runner |
| [MCW-CI-002](../reviews/01-github-workflows/#mcw-ci-002--privileged-release-jobs-executed-selected-source) | High | Resolved | Release pipeline | Source execution is separated from release/store credentials and immutable inputs |
| [MCW-CI-003](../reviews/01-github-workflows/#mcw-ci-003--roadmap-token-verification-used-the-pr-workflow-revision) | Medium | Resolved | Project sync | Token verification runs trusted base workflow code without checkout |
| [MCW-CI-004](../reviews/01-github-workflows/#mcw-ci-004--nightly-accepted-unbounded-configured-refs-with-write-authority) | Medium | Resolved | Nightly | Self-hosted execution accepts only existing canonical release branches and is read-only |
| [MCW-CI-005](../reviews/01-github-workflows/#mcw-ci-005--server-side-repository-rules-did-not-match-the-documented-model) | Medium | Resolved | Repository rules | Required checks, reviews, SHA pins, and secret scanning are enforced server-side |
| [MCW-CI-006](../reviews/01-github-workflows/#mcw-ci-006--rust-action-followed-a-moving-toolchain-channel) | Low | Resolved | Toolchain | Rust action and compiler version are both immutable |
| [MCW-SRC-001](../src-package-audit/#mcw-src-001) | High | Resolved | Swap execution | Execution uses a one-time call bundle frozen before confirmation |
| [MCW-SRC-002](../src-package-audit/#mcw-src-002) | High | Resolved | STRK20 execution | Frozen intent and fee are proved through a call-set-bound signer only after approval |
| [MCW-SRC-003](../src-package-audit/#mcw-src-003) | Medium | Resolved | RPC submission | Write failover stops before submission begins |
| [MCW-SRC-004](../src-package-audit/#mcw-src-004) | Medium | Resolved | Approvals | Sensitive approvals carry immutable account, network, chain, and payload context |
| [MCW-SRC-005](../src-package-audit/#mcw-src-005) | Medium | Resolved | Approvals | Execution atomically claims a pending approval before awaited work |
| [MCW-SRC-006](../src-package-audit/#mcw-src-006) | Low | Resolved | Phishing enforcement | The live blocklist is rechecked before approved execution |
| [MCW-SRC-007](../src-package-audit/#mcw-src-007) | Low | Resolved | Plain storage | Concurrent mutations are serialized across each read-modify-write transaction |
| [MCW-SRC-008](../src-package-audit/#mcw-src-008) | Low | Resolved | Phishing cache | Cached domains receive strict schema, source, time, and normalization checks |
| [MCW-SRC-009](../src-package-audit/#mcw-src-009) | Low | Resolved | Input validation | Shared structural and protocol-specific resource budgets bound hostile inputs |
| [MCW-V06-001](../releases/v0.6/#mcw-v06-001) | Low | Resolved | Ledger onboarding | Partial multi-account creation is recoverable and duplicate state stays current |
| [MCW-V06-002](../releases/v0.6/#mcw-v06-002) | Low | Resolved | Ledger transport | Grant lifecycle, Buffer scope, and multi-device selection are bounded and explicit |
| [MCW-V06-003](../releases/v0.6/#mcw-v06-003) | Medium | Resolved | Multisig submission | Broadcast results survive local-write failure and operations are claimed durably |
| [MCW-V06-004](../releases/v0.6/#mcw-v06-004) | Medium | Resolved | Multisig state | Read failures cannot fabricate settled, empty, or unconfirmed chain state |
| [MCW-V06-005](../releases/v0.6/#mcw-v06-005) | Low | Resolved | Multisig UI | Signer actions and no-account deployment are rejected before doomed requests |
| [MCW-V06-006](../releases/v0.6/#mcw-v06-006) | Informational | Resolved | Assurance/docs | Client guards, UI behavior, recovery scope, and artifact comments are covered |
| [MCW-V09-001](../releases/v0.9/#mcw-v09-001) | Medium | Resolved | STRK20 relay | Private relay quotes cannot add a sender-linked public fee approval |
| [MCW-V09-002](../releases/v0.9/#mcw-v09-002) | High | Resolved | RPC submission | Only an actual add-transaction response loss can retain the duplicate-broadcast guard |
| [MCW-V09-003](../releases/v0.9/#mcw-v09-003) | Medium | Resolved | Store upgrades | Vault migrations and active scope changes are staged, verified, recoverable, and serialized |
| [MCW-V09-004](../releases/v0.9/#mcw-v09-004) | Medium | Resolved | Unified Send | Account-scoped balances, routes, recipients, and pool fees are re-gated before execution |
| [MCW-V09-005](../releases/v0.9/#mcw-v09-005) | High | Resolved | Proof privacy | Post-proof relay errors cannot echo proof material into the wallet surface |
| [MCW-V09-006](../releases/v0.9/#mcw-v09-006) | Medium | Resolved | Ledger transport | Compatibility probing reconnects the exact device and parses bounded model responses |
| MCW-DOC-001 | Informational | Resolved | Architecture docs | Raw-key import documentation now matches the shipped boundary |
| [MCW-V09-101](../releases/v0.9-deep-high/#mcw-v09-101) | High | Resolved | crypto | SNIP-12 revision 0 is accepted with no type-graph validation, so a dapp can forge a t... |
| [MCW-V09-102](../releases/v0.9-deep-high/#mcw-v09-102) | High | Resolved | origin-trust | Multisig proposal id is taken verbatim from one RPC node's hash_transaction answer an... |
| [MCW-V09-103](../releases/v0.9-deep-high/#mcw-v09-103) | Medium | Resolved | origin-trust | The AVNU swap build policy constrains only approve entrypoints, so a hostile aggregat... |
| [MCW-V09-104](../releases/v0.9-deep-high/#mcw-v09-104) | Medium | Resolved | consistency | The sign-request card renders domain and nested-struct values from raw JSON instead o... |
| [MCW-V09-105](../releases/v0.9-deep-high/#mcw-v09-105) | Medium | Resolved | plaintext-lifetime | The inactivity auto-lock can be held open indefinitely by any web page or by the wall... |
| [MCW-V09-106](../releases/v0.9-deep-high/#mcw-v09-106) | Medium | Resolved | validation | One oversized or unrecognised approval blanks the entire consent queue, and the panel... |
| [MCW-V09-107](../releases/v0.9-deep-high/#mcw-v09-107) | Medium | Resolved | vault | importPreferences silently replaces the entire wallet trust configuration — RPC, toke... |
| [MCW-V09-108](../releases/v0.9-deep-high/#mcw-v09-108) | Medium | Resolved | consistency | Every selector that grants spending or collection-wide transfer authority is decoded, flagged, and recorded once... |
| [MCW-V09-109](../releases/v0.9-deep-high/#mcw-v09-109) | Medium | Resolved | consistency | One shared recipient policy now refuses at the enforcement point on every send line — six, not the four originally enumerated... |
| [MCW-V09-110](../releases/v0.9-deep-high/#mcw-v09-110) | Medium | Resolved | consistency | Two spellings of one token address create duplicate token records that permanently di... |
| [MCW-V09-111](../releases/v0.9-deep-high/#mcw-v09-111) | Medium | Resolved | consistency | The enforced key-boundary secret scan executes only 40 of 106 handlers; all twelve ST... |
| [MCW-V09-112](../releases/v0.9-deep-tail/#mcw-v09-112) | Low | Resolved | consistency | The reviewed swap path is unreachable for any quote returning 1000 units or more: the... |
| [MCW-V09-113](../releases/v0.9-deep-tail/#mcw-v09-113) | Low | Resolved | consistency | wallet.lock revokes parked Ledger signs but not in-flight vault-signed transactions, ... |
| [MCW-V09-114](../releases/v0.9-deep-tail/#mcw-v09-114) | Low | Resolved | vault | An explicit user lock can silently fail open: the plaintext session-mirror clear is f... |
| [MCW-V09-115](../releases/v0.9-deep-tail/#mcw-v09-115) | Low | Resolved | memory | Held dapp responses accumulate without bound behind deduplicated approvals, escaping ... |
| [MCW-V09-116](../releases/v0.9-deep-tail/#mcw-v09-116) | Low | Resolved | availability | One unconnected origin can fill the global 50-slot approval queue and deny approvals ... |
| [MCW-V09-117](../releases/v0.9-deep-tail/#mcw-v09-117) | Low | Resolved | origin-trust | requestApprovalSurface opens the wallet UI before any sender, origin, or blocklist ga... |
| [MCW-V09-118](../releases/v0.9-deep-tail/#mcw-v09-118) | Low | Resolved | privacy | STRK20 sub-account commitments are domain-separated by a caller-chosen label, while t... |
| [MCW-V09-119](../releases/v0.9-deep-tail/#mcw-v09-119) | Low | Resolved | origin-trust | The reviewed fee is never bound to the resource bounds actually signed; submission re... |
| [MCW-V09-120](../releases/v0.9-deep-tail/#mcw-v09-120) | Low | Resolved | consistency | An approved dapp declare is the only submitted transaction never recorded in the acti... |
| [MCW-V09-121](../releases/v0.9-deep-tail/#mcw-v09-121) | Low | Resolved | availability | No Starknet RPC call outside the multisig config read carries an abort timeout, so a ... |
| [MCW-V09-122](../releases/v0.9-deep-tail/#mcw-v09-122) | Low | Resolved | availability | Four external HTTP boundaries parse an unbounded response body, and Starkscan's size ... |
| [MCW-V09-123](../releases/v0.9-deep-tail/#mcw-v09-123) | Low | Resolved | validation | Activity CSV export applies no formula-injection neutralization, so an attacker-contr... |
| [MCW-V09-124](../releases/v0.9-deep-tail/#mcw-v09-124) | Low | Resolved | authz | Two privileged message types ship with no caller: an unapproved arbitrary-hash signin... |
| [MCW-V09-125](../releases/v0.9-deep-tail/#mcw-v09-125) | Low | Resolved | memory | The allowance log's 200-entry cap is global rather than per account and network, so o... |
| [MCW-V09-126](../releases/v0.9-deep-tail/#mcw-v09-126) | Low | Resolved | availability | Any wallet.status failure renders the first-run "set up your wallet" screen, indistin... |
| [MCW-V09-127](../releases/v0.9-deep-tail/#mcw-v09-127) | Low | Open (partial) | supply-chain | The vendored Krusty KMS WASM is now pinned to a reviewed source commit and behaviour-checked; its locally compiled bytes still carry no digest a second builder can reproduce... |
| [MCW-V09-128](../releases/v0.9-deep-tail/#mcw-v09-128) | Low | Resolved | vault | createAccount has no first-run or seed-consistency guard, unlike its createLedgerVaul... |
| [MCW-V09-129](../releases/v0.9-deep-tail/#mcw-v09-129) | Low | Resolved | consistency | Balances and history come from the configured RPC first, and the explorer fallback is now opt-in per network — off by default once an RPC override is set... |
| [MCW-V09-130](../releases/v0.9-deep-info/#mcw-v09-130) | Informational | Resolved | consistency | Shared helpers whose own doc comments forbid re-derivation are re-derived across the ... |
| [MCW-V09-131](../releases/v0.9-deep-info/#mcw-v09-131) | Informational | Resolved | supply-chain | Three privileged packaged pages ship undeclared and unchecked, and the Actions SHA-pi... |
| [EXT-H01](../releases/v0.9-external-review/#ext-h01) | High | Resolved | consistency | A SNIP-12 leaf is validated as "any scalar" rather than against its declared type, so a value can hash as a number while the receipt reads it as text |
| [EXT-H02](../releases/v0.9-deep-supply-chain/#ext-h02) | High | Resolved | supply-chain | Privacy-SDK vendoring executes a build tool no pin covers, ahead of every provenance gate |
| [EXT-M01](../releases/v0.9-external-review/#ext-m01) | Medium | Resolved | origin-trust | AVNU route calldata is unbound, so the aggregator chooses the beneficiary and minimum output the confirm card asserts |
| [EXT-M02](../releases/v0.9-external-review/#ext-m02) | Medium | Resolved | availability | A private-relay broadcast whose answer was lost is recorded as a determinate rejection |
| [EXT-M03](../releases/v0.9-external-review/#ext-m03) | Medium | Resolved | consistency | Merkle-tree receipts collapse every distinct root over one leaf multiset into one card |
| [EXT-M04](../releases/v0.9-external-review/#ext-m04) | Medium | Resolved | availability | The proposal-id binding blocks the only non-destructive way to withdraw a confirmation from a poisoned proposal |
| [EXT-M05](../releases/v0.9-external-review/#ext-m05) | Medium | Resolved | consistency | Standard safe and batch NFT transfers bypass the poisoned-recipient refusal |
| [EXT-M06](../releases/v0.9-external-review/#ext-m06) | Medium | Resolved | origin-trust | Wallet-initiated signing lanes accepted node-quoted fee bounds that no review surface displayed |
| [EXT-L01](../releases/v0.9-external-review/#ext-l01) | Low | Resolved | origin-trust | The reviewed fee is re-read at approve time, so a retry can raise the enforced ceiling above the figure on screen |
| [EXT-L02](../releases/v0.9-external-review/#ext-l02) | Low | Resolved | plaintext-lifetime | An explicit lock revokes the signing thunk but not the STRK20 viewing-key thunk |
| [EXT-L03](../releases/v0.9-external-review/#ext-l03) | Low | Resolved | consistency | The unlimited-approval running total starts at zero, so a top-up on a standing allowance crosses the threshold unflagged |
| [EXT-L04](../releases/v0.9-external-review/#ext-l04) | Low | Resolved | consistency | Dapp invokes never re-check the recipient against a trusted-address set that changed after consent |
| [EXT-L05](../releases/v0.9-external-review/#ext-l05) | Low | Resolved | availability | Multisig operation claims omit the multisig contract, so one proposal id blocks itself across two multisigs |
| [EXT-L06](../releases/v0.9-external-review/#ext-l06) | Low | Resolved | consistency | Execute and revoke on one proposal can both broadcast, because claims are separated by kind |
| [EXT-L07](../releases/v0.9-external-review/#ext-l07) | Low | Resolved | availability | A full origin queue is refused only after the typed data has been hashed and the vault read |
| [REV-L-01](../releases/v0.9-pr234-followup/) | Low | Resolved | RPC submission | A malformed successful broadcast result could hide a possibly-live transaction behind a retryable-looking failure |
| [REV-L-02](../releases/v0.9-pr234-followup/) | Low | Resolved | privacy availability | A retained STRK20 submission guard did not tell the user how to recover |
| [REV-L-03](../releases/v0.9-pr234-followup/) | Low | Resolved | swap consent | A late preparation could reopen confirmation beside a newer live quote |
| [REV-L-04](../releases/v0.9-pr234-followup/) | Low | Resolved | fee consent | A declaration remained approvable after its fee estimate failed |
| [REV-L-05](../releases/v0.9-pr234-followup/) | Low | Resolved | multisig availability | An accepted local confirmation claim could survive an external revoke forever |
| [REV-L-06](../releases/v0.9-pr234-followup/) | Low | Resolved | multisig submission | Two wallet surfaces could broadcast the identical proposal concurrently |
| [REV-L-07](../releases/v0.9-pr234-followup/) | Low | Resolved | CI secrets | The Chromatic token was available to earlier PR-controlled job steps |
| [REV-L-08](../releases/v0.9-pr234-followup/) | Low | Resolved | multisig review | Valid camel-case Cairo entrypoints fell back to id-only review |
| [REV-L-09](../releases/v0.9-pr234-followup/) | Low | Closed after reproduction | typed-data availability | A machine-specific worst-case timing claim did not reproduce; admission remains enforced before hashing |
| [MCW-PR234-001](../releases/v0.9-pr234-followup/#additional-adversarial-finding) | Low | Resolved | multisig submission | Indeterminate broadcasts released their durable claim and reopened blind retry |
| [MCW-PR234-002](../releases/v0.9-pr234-followup/#additional-adversarial-finding) | Low | Resolved | declare fee consent | An undeployed-account card displayed a combined total but echoed only one component |

## v0.9.1 external security review

An independent reviewer audited the `v0.9` remediation branch before promotion and returned
**DO NOT MERGE**, substantiating [fifteen findings](../releases/v0.9-external-review/): two High,
six Medium, and seven Low. All fifteen are Resolved. Two were regressions introduced by the v0.9
remediation itself (`EXT-M03`, `EXT-M04`) and two more were incomplete remediations of v0.9
findings (`EXT-H01`, `EXT-L04`); the rest pre-dated the branch. The High findings were delivered
privately — their entries record the defect and the remediation, and the reviewer's reproduction
material is not published.

## v0.9 deep adversarial audit

The [v0.9 deep adversarial audit](../releases/v0.9-deep/) records 31 findings
(`MCW-V09-101`..`131`) against the `v0.9.0` baseline: two High, nine Medium, eighteen Low, and two
Informational. Thirty are Resolved. The remaining entry, `MCW-V09-127` (Low), is partially
remediated — the vendored Krusty KMS WASM is pinned to a reviewed source commit and
behaviour-checked, but its locally compiled bytes still carry no digest a second builder can
reproduce, and the gate records that residual in its own header.

Because no High or Medium entry is open, the disclosure gate in that document is satisfied and its
reproduction detail is publishable. Each finding's entry carries the remediation that shipped and
names the tests that pin it; statuses here were re-verified against the working tree by a final
integration review rather than carried over from the rounds that wrote the fixes.

## MCW-AUD-001 — Biome internal panics do not fail the lint gate

**Evidence.** `bun run check:lint` with pinned Biome `2.5.3` reports
`internalError/panic` while processing `scripts/check-krusty-adapter.ts` and
`tests/background/multisig/background-multisig-ops-guards.test.ts`. The command exits successfully, so the subsequent
`&&` stages in `bun run check` execute.

**Impact.** A security-sensitive file can receive incomplete lint analysis while the required gate
continues. Type checks and tests still run, and no runtime exploit was demonstrated, so this is an
audit-assurance weakness rather than a product vulnerability.

**Resolution.** The repository now pins Biome `2.5.5` and carries the regenerated lockfile. The
previously affected files complete analysis without `internalError/panic` diagnostics.

**Retest.** On the v0.6 release branch, `bun run check:lint` checked 532 files without an internal
error. One pre-existing provider-tester warning and one informational style suggestion remain; both
are emitted normally and do not indicate skipped analysis.

## MCW-DOC-001 — Raw-key import is shipped but documented as absent

**Evidence.** At the start of the baseline review, `docs/ARCHITECTURE.md` said raw private-key
import was “not shipped.” The baseline contained the privileged import parser and handler,
side-panel import UI, vault integration, and dedicated import tests.

**Impact.** Reviewers relying on the architecture document can omit a secret-input and key-storage
boundary from their threat model.

**Resolution.** The complete import path was audited during the source-package review.
`docs/ARCHITECTURE.md` now names the privileged message boundary, lock requirement, KMS-only public
key/address derivation, strict private-key validation, encrypted persistence, duplicate rejection,
and fail-closed behavior.

**Retest.** Architecture documentation names the shipped import flow, its privilege boundary,
validation, storage behavior, and failure modes.

## Source findings

See the [consolidated source package audit](../src-package-audit/) for the sanitized evidence,
impact, resolution, and validation results for MCW-SRC-001 through MCW-SRC-009.
See the [v0.6 release audit](../releases/v0.6/) for MCW-V06-001 through MCW-V06-006.
See the [v0.9 release assurance](../releases/v0.9/) for MCW-V09-001 through MCW-V09-006.
