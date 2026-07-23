---
layout: default
title: Audit findings
permalink: /security-audit/findings/
---

# Sanitized findings ledger

This public ledger omits reproduction payloads and exploit mechanics for unremediated
medium-or-higher findings. The consolidated source report records the affected trust boundary,
impact, remediation, and retest condition.

| ID | Severity | Status | Area | Summary |
| --- | --- | --- | --- | --- |
| MCW-AUD-001 | Low | Resolved | Root tooling | Biome analyzes the repository without the prior internal panics |
| [MCW-SRC-001](../src-package-audit/#mcw-src-001) | High | Resolved | Swap execution | Execution uses a one-time call bundle frozen before confirmation |
| [MCW-SRC-002](../src-package-audit/#mcw-src-002) | High | Resolved | STRK20 execution | Execution uses the exact prover call frozen before approval |
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
| MCW-DOC-001 | Informational | Resolved | Architecture docs | Raw-key import documentation now matches the shipped boundary |

## MCW-AUD-001 — Biome internal panics do not fail the lint gate

**Evidence.** `bun run check:lint` with pinned Biome `2.5.3` reports
`internalError/panic` while processing `scripts/check-krusty-adapter.ts` and
`tests/background-multisig-ops-guards.test.ts`. The command exits successfully, so the subsequent
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
