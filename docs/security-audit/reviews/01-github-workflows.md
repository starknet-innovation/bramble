---
layout: default
title: "Review 01: GitHub workflows"
permalink: /security-audit/reviews/01-github-workflows/
---

# Review 01 — GitHub workflows and repository controls

| Field | Value |
| --- | --- |
| Status | Complete |
| Pre-remediation baseline | `218bfae5eb9262a6632c69e2de3ec42506827a0b` (`main`) |
| Reviewed | 2026-07-24 |
| Product fund-loss or wallet bypass found | No |
| Workflow/repository findings | 6 resolved |

## Scope

- Every workflow under `.github/workflows/`.
- Workflow events, untrusted expressions, source checkout, runner selection, token scopes, action
  pins, artifacts, release inputs, and secret-bearing jobs.
- `CODEOWNERS`, pull-request templates, dependency automation, and repository security settings.
- Live branch rulesets, Actions permissions, environments, and secret-scanning configuration.

The review followed code from each trigger to any self-hosted runner, repository write, issue write,
project token, release publication, or Chrome Web Store credential. It treated branch names,
workflow-dispatch inputs, repository variables, pull-request workflow revisions, checked-out source,
dependencies, and downloaded artifacts as untrusted until explicitly constrained.

## Confirmed controls after remediation

- `release-validation` requires a same-repository `release/**` or `hotfix/**` PR into `main`; a fork
  cannot allocate the self-hosted release runner by choosing a trusted-looking branch name.
- Self-hosted build/test jobs have read-only repository permission. Repository/issue writes happen
  in hosted jobs that do not check out or execute the source they consume.
- Manual store publishing can be dispatched from `main` only, derives the package version from
  protected `main`, requires the matching release tag to exist, rebuilds that immutable tag, and
  verifies the downloaded checksum before publication.
- The Chrome Web Store client executes from protected `main` on a fresh hosted runner. CWS secrets
  are scoped to the `chrome-web-store` environment; no CWS secrets were configured at review time.
- The roadmap-token verification uses `pull_request_target`, no checkout, no pull-request
  expressions in executable code, and read-only API operations.
- Nightly source selection accepts only `release/vX.Y` and requires an exact branch in the base
  repository before allocating a self-hosted runner. Issue upsert runs separately on a hosted
  runner.
- Every third-party action uses a full commit SHA, the repository enforces SHA pinning, and the Rust
  action additionally selects compiler `1.96.1`.
- The live `main` ruleset requires `fast-checks`, `pr-guards`, and `release-validation`, one
  approving review, Code Owner review, and resolved review threads.
- The live `release/*` ruleset requires `fast-checks`, `pr-guards`, one approving review, Code Owner
  review, and resolved review threads.
- Secret scanning and push protection are enabled. Default workflow permission remains read-only,
  and Actions cannot approve pull requests.
- `bun run check:files` loads a dedicated workflow-security policy. Its tests mutate the critical
  controls and verify that the gate fails on regression.

## Findings

### MCW-CI-001 — Fork branch name could authorize the self-hosted release runner

**Severity/status:** High / resolved.

**Evidence.** The release-validation condition checked the base and the attacker-controlled head
branch prefix, but not that the PR head belonged to this repository.

**Impact.** A fork could name its branch `release/...` or `hotfix/...` and execute changed source,
dependency installation, build, and test commands on the self-hosted release runner. No wallet
fund-loss path or observed exploitation was found.

**Resolution/retest.** The condition now requires
`github.event.pull_request.head.repo.full_name == github.repository` before runner allocation. The
workflow policy and a mutation test reject removal of that guard.

### MCW-CI-002 — Privileged release jobs executed selected source

**Severity/status:** High / resolved.

**Evidence.** Manual dispatch built the UI-selected ref, the self-hosted release build held
`contents: write`, GitHub Release creation ran in the source-executing job, and the CWS job executed
checked-out release source while holding store credentials.

**Impact.** A privileged dispatcher could accidentally select mutable branch code, and compromised
release source or dependencies had unnecessarily direct access to release/store authority.

**Resolution/retest.** Manual publishing is `main`-only and rebuilds an existing immutable tag.
Self-hosted builds are read-only. GitHub Release creation is a hosted, no-checkout artifact consumer.
CWS publication is hosted, re-verifies the checksum, and invokes the audited client from protected
`main`. Policy tests reject rejoining source execution and write authority.

### MCW-CI-003 — Roadmap token verification used the PR workflow revision

**Severity/status:** Medium / resolved.

**Evidence.** A secret-bearing verification job was triggered by `pull_request` when that workflow
file changed.

**Impact.** A same-repository contributor able to alter the workflow could change the executable
workflow revision and attempt to disclose or misuse the organization project token.

**Resolution/retest.** Verification now uses the trusted base workflow through
`pull_request_target`, performs no checkout, and contains no untrusted executable expression. The
policy forbids a PR-revision trigger or checkout in that job.

### MCW-CI-004 — Nightly accepted unbounded configured refs with write authority

**Severity/status:** Medium / resolved.

**Evidence.** A manual input or `ACTIVE_RELEASE_BRANCH` value flowed directly into checkout on a
self-hosted runner, while that workflow held `issues: write`.

**Impact.** Misconfiguration could execute an arbitrary repository ref with an unnecessary write
token on the privileged runner.

**Resolution/retest.** Inputs must match `release/vX.Y` and exactly exist in the base repository.
The source-executing job is read-only; a hosted, no-checkout reporter alone receives issue write.
Mutation tests cover both branch constraints and the permission split.

### MCW-CI-005 — Server-side repository rules did not match the documented model

**Severity/status:** Medium / resolved.

**Evidence.** `main` did not require `release-validation`; the release ruleset required zero
approvals and no Code Owner review; Actions did not enforce SHA pins; secret scanning and push
protection were disabled.

**Impact.** Correct workflow code remained partly process-enforced and could be bypassed by a merge
or later action-reference drift.

**Resolution/retest.** Live settings now require the checks/reviews listed above, enforce full-SHA
actions, and enable secret scanning plus push protection. GitHub reports skipped job-level
conditional jobs as successful, so requiring `release-validation` does not block ordinary PRs.
The rulesets and Actions/security settings were read back after mutation.

### MCW-CI-006 — Rust action followed a moving toolchain channel

**Severity/status:** Low / resolved.

**Evidence.** The action implementation was pinned to a commit, but its default `stable` compiler
selection moved over time.

**Impact.** Identical workflow source could compile vendored cryptographic code with a different
compiler, weakening reproducibility and making toolchain regressions time-dependent.

**Resolution/retest.** All four Rust-using workflows select `1.96.1`. The workflow policy requires
both the action SHA and exact compiler selection.

## Residual operational condition

The `chrome-web-store` environment is restricted to protected branches, but this private
repository's current GitHub plan rejected required-reviewer protection. No CWS secrets are present.
Do not add them until the plan supports the control or a second eligible maintainer and equivalent
approval mechanism are available. The workflow's independent `main`-only dispatch guard remains
enforced.

## Validation

- Workflow YAML parsed successfully.
- Dedicated workflow-security policy tests: 8 passed, 0 failed.
- `bun run scripts/check-config-standards.ts`: passed.
- Full isolated `bun run check`: 2,161 tests, 0 failures, 5,839 expectations across 264 files,
  plus types, lint, file/config standards, import layers, cycle detection, manifest, Krusty adapter,
  and multisig artifact checks.
- Isolated extension build, package, and Playwright E2E: 8 browser tests passed.
- Live rulesets, Actions SHA enforcement, environment branch policy, secret scanning, and push
  protection were queried after update.
