# Development workflow

This is the canonical guide to how work flows through Bramble: where you
branch from, where pull requests target, how changes reach a release, and what
CI runs at each stage. If you read only one document before opening a PR, read
this one.

It complements — does not replace — the other docs:

- **`CONTRIBUTING.md`** — the binding architecture, security, and code-style rules.
- **`AGENTS.md`** — the operational guide for coding agents (setup, gates, layout).
- **`RELEASING.md`** — the runbook that takes a finished release to a published build.

> Current release: **`v0.7.0`**. The release-branch model began with **`v0.4`**;
> each later milestone maps 1:1 to its matching `release/vX.Y` branch.

---

## TL;DR

- `main` is always the latest **stable, releasable** version. You never push work directly to it.
- Each release is a small, shippable **slice of one roadmap phase**, tracked as one **milestone** (`v0.4`, `v0.5`, …) mapped **1:1** to one temporary **`release/vX.Y`** branch cut from `main`.
- You do your work on a **`feature/` / `fix/` / `chore/`** branch cut from the **active release branch**, and you open your PR **against that release branch — never against `main`.**
- When the release's scope and gates are met, the release branch is merged into `main` and tagged **`vX.Y.0`**.
- Only **one** active release branch exists at a time. Keep it **short-lived**.

---

## Phases and releases are not the same thing

This is the most important idea in this document; the rest follows from it.

The GTM roadmap (codename *Pharaoh*) is organized into **8 large, phase-gated
phases** plus an out-of-GTM terminal track. A phase is a big body of work with
its own exit criteria — far too large to live on a single short-lived branch.

So we separate the two concerns:

| Concept | What it is | Tracked by | Lifetime |
| --- | --- | --- | --- |
| **Phase** | The roadmap "what / why" — a large capability area with phase-gate exit criteria | `phase:N` label + roadmap tracking issue (#79–#87) | Long-lived; spans many releases |
| **Release** | A small, shippable **slice** of one phase | A GitHub **milestone** (`v0.4`, …) mapped **1:1** to one **`release/vX.Y`** branch | Short-lived; cut, shipped, archived |

**A release branch is a slice of a phase, not the whole phase. One phase yields
several short releases.** The mapping is always explicit:

```
phase  (phase:N label + roadmap issue #79–#87)
  └── release  (milestone vX.Y  ⇄  branch release/vX.Y)
        └── work  (feature/… , fix/… , chore/… → PR into release/vX.Y)
```

### The roadmap phases

| Phase | Roadmap issue | Theme | Gate note |
| --- | --- | --- | --- |
| 1 | [#79](https://github.com/starknet-innovation/bramble/issues/79) | Core / shell build | |
| 2 | [#80](https://github.com/starknet-innovation/bramble/issues/80) | MVP single-sig wallet | |
| 3 | [#81](https://github.com/starknet-innovation/bramble/issues/81) | Table-stakes parity | |
| 4 | [#82](https://github.com/starknet-innovation/bramble/issues/82) | Wallet recovery | |
| 5 | [#83](https://github.com/starknet-innovation/bramble/issues/83) | Hardening, audit & public release | **Public-release gate** (external security audit) |
| 6 | [#84](https://github.com/starknet-innovation/bramble/issues/84) | Treasury multisig | |
| 7 | [#85](https://github.com/starknet-innovation/bramble/issues/85) | Migration off Braavos/Ready | |
| 8 | [#86](https://github.com/starknet-innovation/bramble/issues/86) | Later / optional | Post-GTM |
| — | [#87](https://github.com/starknet-innovation/bramble/issues/87) | Terminal track (test harness) | Out-of-GTM, in-scope |

A milestone's description should name the phase it slices (e.g. "`v0.4` — first
slice of Phase 3, Table-stakes parity, #81"). An issue carries **both** its
`phase:N` label (which phase) **and** its milestone (which release ships it).

---

## The branch model

```
main ──●───────────────────────────────●──────────────▶  (stable; tags vX.Y.0)
        \                              /
         \   release/v0.4             /  merge + tag v0.4.0
          ●───●────●────●────●───────●
              \   /\   /\   /
               \ /  \ /  \ /   feature/… fix/… chore/…  (PRs target release/v0.4)
                ●    ●    ●
```

- **`main`** — always releasable. Protected. Reached only by merging a
  `release/**` branch (a release promotion) or a `hotfix/**` branch. Tagged
  `vX.Y.0` at each release.
- **`release/vX.Y`** — the single active release branch. Cut from `main` when a
  release opens; deleted after it merges back. Exactly one at a time.
- **`feature/<issue>-<desc>` / `fix/<issue>-<desc>` / `chore/<issue>-<desc>`** —
  your working branches. Cut **from** the active release branch and merged
  **back into** it via PR.
- **`hotfix/<desc>`** — an urgent fix to production; branch from `main` (or the
  affected release tag). See [Hotfixes & backports](#hotfixes--backports).
- **`docs/<desc>`** — documentation-only changes.

### Where you branch from and where PRs target

| You are doing… | Branch from | Branch name | PR targets |
| --- | --- | --- | --- |
| Feature work for the active release | `release/vX.Y` | `feature/<issue>-<desc>` | `release/vX.Y` |
| A bug fix within the active release | `release/vX.Y` | `fix/<issue>-<desc>` | `release/vX.Y` |
| Chore / tooling within the release | `release/vX.Y` | `chore/<issue>-<desc>` | `release/vX.Y` |
| Shipping the release | — | `release/vX.Y` | `main` (merge commit; then tag) |
| Urgent production fix | `main` or release tag | `hotfix/<desc>` | `main` (then forward-apply) |
| Docs-only | `release/vX.Y` or `main` | `docs/<desc>` | matching base |

**`feature/` and `fix/` PRs must never target `main`** — they are release work
and belong on the active `release/vX.Y` branch. CI **hard-blocks** them from
`main` (see [Scope & naming enforcement](#scope--naming-enforcement)).
`release/**` and `hotfix/**` are the normal promotion and hotfix paths into
`main`. `chore/` and `docs/` PRs normally target the release branch too, but the
guard **permits** them into `main` for repo plumbing and docs that aren't part
of a release slice (this workflow-adoption PR is one such `chore/`).

### Naming conventions

- `feature/<issue>-<short-desc>` — e.g. `feature/28-external-allowances`
- `fix/<issue>-<short-desc>` — e.g. `fix/27-price-host-fallback`
- `chore/<issue>-<short-desc>` — e.g. `chore/94-roadmap-release-workflow`
- `release/vX.Y` — e.g. `release/v0.4` (no patch component; the branch covers the whole `vX.Y` line)
- `hotfix/<short-desc>` — e.g. `hotfix/vault-decrypt-panic`
- `docs/<short-desc>` — e.g. `docs/clarify-migration`

`<issue>` is the GitHub issue number the branch addresses. `<short-desc>` is a
few kebab-case words.

---

## Every PR into a release branch

A PR that targets `release/vX.Y` must:

1. **Reference its roadmap issue** — `#N`, or `Closes/Fixes/Resolves #N` when it
   fully closes it. (Blocking — CI fails without a reference.)
2. **Name its target release** — the base branch (`release/vX.Y`) and its milestone.
3. **State the release acceptance criterion it satisfies** — which milestone/roadmap
   criterion this advances.
4. **Include tests** for the behavior it changes. Storage, permissions, signing,
   and migration changes always require tests (see `CONTRIBUTING.md`).
5. **Stay in scope.** If the work reveals new scope, it goes to the milestone /
   roadmap as a new issue — never silently into an unrelated PR. Scope changes
   are a planning decision, made on the milestone, not in a diff.

The pull-request template captures items 1–4 as fields and item 5 as a checkbox.

---

## Layered CI

Three tiers, each with a different speed/breadth trade-off. Files:
`.github/workflows/ci.yml`, `release-integration.yml`, `nightly.yml`.

### 1. PR CI — fast gates + a gated full validation (`ci.yml`)

Trigger: **`pull_request` targeting `main` or `release/**`** (plus `push` to
`main`). Three jobs make the fast/heavy split real:

- **`pr-guards`** — the scope & naming guards (below), on a hosted
  `ubuntu-latest` runner. Fast.
- **`fast-checks`** — the fast, offline-capable gates that run on **every PR**:
  Biome lint (`check:lint`), typecheck (`check:types`), the `check:files`
  standards gate (which runs **both** file- and config-standards — there is no
  separate `check:config` script) and the extension-manifest check
  (`check:extension`), import-layer + cycle checks (`check:imports`,
  `check:cycles`), unit + conformance tests (`bun test tests`), and the coverage
  floor (`check:coverage`). Runs on `ubuntu-latest` — **no** crypto/contract
  toolchain, **no** build, **no** E2E — so PR feedback is fast. It deliberately
  does **not** run the aggregate `bun run check` (which chains the vendored
  `check:argent`/`check:privacy`) or any heavy step.
- **`release-validation`** — the **full heavy pipeline**:
  `vendor:argent`, `vendor:privacy`, `bun run check`, coverage floor, `build`,
  `test:e2e`, `package:extension`, the `apps/terminal` typecheck+build, and the
  `bun audit` dependency gate (`check:audit`), on the self-hosted CodeBuild
  runner. It is **gated by a job-level `if:`** so it runs **only on same-repository
  `release/**` and `hotfix/**` PRs into `main`** — the complete
  release-validation suite before code reaches the stable branch. A fork branch
  cannot opt into the self-hosted runner by choosing a trusted-looking name.

So an everyday `feature/`/`fix/`/`chore/` PR into a release branch — and a
`chore/`/`docs/` PR into `main` — runs **only `pr-guards` + `fast-checks`** and
never pays for the heavy pipeline. The heavy pipeline runs when a release is
promoted (`release/vX.Y` → `main`) or a hotfix lands (`hotfix/*` → `main`), and
again post-merge and nightly (below).

> Note: because the `apps/terminal` build now lives in `release-validation`, the
> terminal app is validated on release/hotfix→main promotion, not on every
> release-branch PR or the extension-only post-merge/nightly jobs. If per-PR
> terminal coverage is wanted, add a lightweight terminal typecheck to
> `fast-checks`.

### 2. Release-branch integration — broader, post-merge (`release-integration.yml`)

Trigger: **`push` to `release/**`** (i.e. after a PR merges into the release branch).

Runs the heavier steps: verifies the published Krusty KMS package and the pinned
Argent account-contract and Privacy SDK releases, builds the extension, and produces the
reproducible package + checksum. The vendor steps need network access and their contract
toolchains, so they
run on the same self-hosted CodeBuild runner CI uses. If a vendor step can't
complete (missing private-repo access or toolchain drift) it writes a clear
explanation to the run summary and **fails honestly** — it never fakes success.
The self-hosted job has read-only repository permission, and Rust is pinned to
`1.96.1` rather than the moving `stable` channel.

### 3. Nightly — full suite (`nightly.yml`)

Trigger: **scheduled** (`cron: 0 3 * * *`) + manual `workflow_dispatch`, against
the **active release branch**.

Active-branch resolution: use repo variable **`vars.ACTIVE_RELEASE_BRANCH`** if
set; otherwise the highest-semver `release/vX.Y` or patch release branch
`release/vX.Y.Z`; if none exists, exit cleanly with a note. Manual runs must be
dispatched from `main`. Any configured branch must match one of those exact
forms and must already exist in this repository before a self-hosted runner is
allocated. Release promotion branches remain `release/vX.Y`; the patch form is
accepted here only so the audit suite can keep testing a shipped hotfix line.

Runs the full **E2E (Playwright)** suite, the **dependency audit** (`bun audit`,
via `bun run check:audit` — also run in the PR CI `release-validation` job;
nightly re-runs it against the live advisory database so a newly-published
advisory is caught even without a code change), the extension **build**, and a
clearly-labeled **placeholder**
for perf / regression suites (none exist in-repo yet — the step is an explicit
no-op and must not be read as a passing gate).

It writes a **categorized summary** to the run summary with sections: *newly
failing*, *known failures*, *flaky*, *regressions*, *release-blocking*, and
*recommended next work*. Only what a single run can prove is filled in
automatically: pass/fail is derived from job results; **flaky** and
**regressions** need run history / a baseline and are explicitly marked as not
auto-classified.

On failure it creates-or-updates **one** tracking issue titled
`Nightly: release/vX.Y — failing checks`, labeled `ci-cd` + `release`, assigned
to the matching milestone when one exists. Source and dependencies execute in a
read-only self-hosted job; a separate hosted job receives the narrow
`issues: write` capability and never checks out release-branch code.

### What runs where

"PR CI" is `ci.yml`; its `fast-checks` job runs on every PR, while
`release-validation` runs only on `release/**`/`hotfix/**` → `main` PRs.

| Check | PR CI · fast-checks (every PR) | PR CI · release-validation (release/hotfix→main) | Release integration (push release/**) | Nightly |
| --- | :---: | :---: | :---: | :---: |
| Lint, typecheck, file/config + manifest standards, import/cycle, unit/conformance tests, coverage | ✅ | ✅ | | |
| Scope & naming guards (`pr-guards`) | ✅ | | | |
| Verify Krusty package, vendor Argent/Privacy, extension build, reproducible package | | ✅ | ✅ | ✅ (build) |
| Full E2E (Playwright) | | ✅ | | ✅ |
| Dependency audit (`bun audit`) | | ✅ | | ✅ (live DB) |
| Perf / regression | | | | ⚠️ placeholder (no suite exists yet) |

---

## Scope & naming enforcement

The `pr-guards` job in `ci.yml` (using `actions/github-script`) enforces the
model. Two guards are **blocking** (they fail the check); one is **advisory**
(annotation only).

- **PR-target guard — BLOCKING (fail-closed).** Only an explicit allowlist of
  head-branch categories may target `main`: `release/**` and `hotfix/**`
  (promotion / hotfix paths), `chore/**` / `docs/**` (repo plumbing and docs
  that aren't part of a release slice), and authenticated Dependabot PRs whose
  head starts with `dependabot/`. A branch prefix alone never grants an
  exception: head names are contributor-controlled, so `cursor/`, `codex/`,
  `ai-findings-autofix/`, and `qa/` branches must still use one of the allowed
  target categories.
  **Everything else** — `feat/`, `feature/`, `fix/`, or any unknown/typo prefix
  — is treated as feature-like release work: if it targets `main` the check
  **fails** and tells you to retarget to the active `release/vX.Y` branch.
  Feature work does not go straight to `main`; it is promoted via a release
  branch so it passes through `release-validation`. (This is deliberately an
  allowlist, not a blocklist of known feature prefixes, so a new or misspelled
  prefix cannot slip past the guard and skip release-validation.)
- **Linked-issue guard — BLOCKING.** If the base matches `release/**`, the PR
  title or body must reference an issue (`#N` or `Closes/Fixes/Resolves #N`);
  otherwise the check **fails**. Best-effort: it fetches the referenced issue's
  milestone and, if it doesn't match the base branch's version, adds a **warning**
  (it does not fail — to avoid false blocks).
- **Branch-name guard — ADVISORY.** The head should match `feature/<n>-*`,
  `fix/<n>-*`, `chore/<n>-*`, `release/vX.Y`, `hotfix/*`, or `docs/*`; otherwise
  a non-blocking annotation is added. Known automation prefixes are skipped
  here only; except for authenticated Dependabot, they do not bypass the
  blocking target guard.

> **Blocking in CI is merge-blocking only through the live ruleset.** The active
> `main` and `release/*` rulesets require the guards described below. Those
> server-side settings are still mutable by repository administrators, so each
> release audit reads them back rather than inferring enforcement from YAML.

---

## What blocks a release

A `release/vX.Y` branch may **not** be promoted to `main` until:

- Every roadmap issue in the milestone is **closed or explicitly deferred** (moved to a later milestone).
- The release's **acceptance criteria are met**.
- **Required PR CI is green** on the tip of the release branch.
- The **nightly / full suite is green** on the release branch (E2E, audit, build).
- There are **no unresolved release-blocking regressions** (see the nightly tracking issue).
- **Release notes and version metadata are complete** — `package.json` and
  `apps/extension/public/manifest.json` bumped in lockstep to `X.Y.0`, and the `CHANGELOG.md`
  `[X.Y.0]` section is filled in (`bun run changelog`). The single-source gate
  (`bun run check:release-version`) must pass: if the version does not match the
  `release/vX.Y` branch, the auto-release **fails** rather than shipping a
  mislabeled artifact (issue #59).

---

## Release completion sequence

The full checklist, from a scope-complete release branch to a published build.
See `RELEASING.md` for the Chrome Web Store specifics.

1. **Confirm scope.** All milestone issues closed or deferred; acceptance
   criteria met; no open release-blocking regressions.
2. **Version metadata.** Bump `package.json` **and** `apps/extension/public/manifest.json` to
   `X.Y.0` in lockstep; run `bun run check:files` and
   `bun test tests/conformance/release-version-single-source.test.ts`.
3. **Gates green.** Required PR CI green on the branch tip; nightly/full suite green.
4. **Changelog.** Fill in the `CHANGELOG.md` `[X.Y.0]` section (`bun run changelog`);
   it becomes the GitHub Release notes (#60).
5. **RC tag (when appropriate).** Tag `vX.Y.0-rc.1` on the release branch for a
   final validation pass (loads/installs cleanly, E2E green, package checksum
   verified). Iterate `-rc.2`, … if needed.
6. **Full validation.** Confirm the RC build against the acceptance criteria.
7. **Promote.** Merge `release/vX.Y` → `main` as a **merge commit** (not squash —
   preserve the release history). This is done explicitly by a maintainer.
8. **Automatic release.** The merge triggers `auto-release.yml`: it derives the
   version from the merged branch, runs the single-source gate, tags `vX.Y.0` on
   the merge commit, and cuts the GitHub Release (build, package, checksum,
   notes) via the reusable `release-build.yml`. **No manual tag push** — push
   `vX.Y.0` by hand only to backfill a release the automation missed.
9. **Release notes / publish.** Confirm the GitHub Release notes; the optional
   Chrome Web Store publish is a separate, gated manual dispatch (see `RELEASING.md`).
10. **Close / archive the milestone.**
11. **Cut the next release** branch from the updated `main` and set
    `vars.ACTIVE_RELEASE_BRANCH` to it.

---

## Hotfixes & backports

For an urgent production issue that can't wait for the normal release cadence:

1. Branch **`hotfix/<desc>`** from `main` (or from the affected release tag if
   the bug is specific to a shipped version).
2. Fix + test on the hotfix branch; open a PR into `main`.
3. Merge into `main` and tag the patched version (`vX.Y.Z`).
4. **Forward-apply** the same fix to any active `release/vX.Y` branch that lacks
   it (cherry-pick or merge). **Never leave a fix only on an older release
   branch** — a fix that lands on `main` or an old release but not the active
   release will regress the moment the active release ships.

---

## Branch protection & repository security settings

The rules above are enforced in-repo by CI guards, CODEOWNERS, templates, and the
workflow-security policy in `bun run check:files`. The GitHub rulesets must keep
the following server-side baseline so a red guard is actually merge-blocking.

### `main` — branch protection / ruleset

- **Require a pull request before merging.**
- **Require status checks to pass** and **require branches to be up to date**.
  Required checks: **`fast-checks`**, **`pr-guards`**, and
  **`release-validation`**. GitHub documents that a job skipped by a
  [job-level conditional reports success and does not block merging][skipped-job],
  so ordinary `chore/`/`docs/` PRs remain mergeable while a release/hotfix
  promotion cannot bypass the heavy gate.
- **Require ≥ 1 approving review** (and "Require review from Code Owners" — see `.github/CODEOWNERS`).
- **Dismiss stale approvals on push** and require approval from someone other
  than the author of the most recent push.
- **Require all review threads to be resolved.**
- **Restrict direct pushes and configure no ruleset bypass actor.**
- **Block force-pushes and deletions** of `main`.
- **Require signed commits** — recommended if it is the org norm (this repo already
  values verified signatures; `CONTRIBUTING.md` requires GPG-signed commits).

The current owners are existing push-authorized maintainers other than the
repository's primary author, so a PR author cannot be the only eligible code
owner.

### `release/*` — branch protection / ruleset

- **Require a pull request before merging.**
- **Require status checks to pass:** **`fast-checks`** **and** **`pr-guards`**
  (so the linked-issue guard is enforced). `release-validation` does not run on
  release-branch PRs, so it is not a required check here.
- **Require ≥ 1 approving review**, Code Owner review, and resolution of every
  review thread.
- **Dismiss stale approvals on push**, require approval of the latest push, and
  configure no ruleset bypass actor.
- **Block force-pushes and deletions** by non-maintainers.
- Once a release branch is integrated into `main`, it is **immutable**. The
  `pr-guards` check rejects attempts to reopen it (a merged promotion PR from
  that branch into `main` is the signal), and the local hooks
  (`git config core.hooksPath .githooks`) reject the commit and the push before
  it reaches GitHub (a `main` merge commit with the branch tip as a parent is
  theirs) — both fail closed when integration cannot be resolved. A freshly cut
  branch is reachable from `main` but not integrated, so its first PR is fine. Create
  the next patch release branch (`release/vX.Y.Z`) for follow-up work; it cuts
  its own `X.Y.Z` release on promotion exactly as a minor branch does.

### Repository settings

- Keep default workflow token permissions **read-only** and prevent Actions from
  approving pull requests.
- Require every third-party action to use a **full commit SHA**.
- Keep **secret scanning** and **push protection** enabled.
- Keep the `chrome-web-store` environment restricted to protected branches.
  The current private-repository plan does not support required-reviewer
  protection; do not add CWS credentials until the plan supports it or a second
  eligible maintainer can be configured. The release workflow independently
  rejects publish dispatches not run from `main`.
- Keep **automatically delete head branches** enabled so short-lived working
  branches do not accumulate after merge.
- **Default merge strategy:** set **squash** for day-to-day working-branch PRs
  (one tidy commit per change on the release branch). **Exception:** promoting
  `release/vX.Y` → `main` should be a **merge commit**, done explicitly, to
  preserve release history. GitHub **cannot enforce a per-target merge strategy**,
  so this is a documented convention, not an automated rule — the person doing
  the promotion picks "Create a merge commit".
- **Repo variable `ACTIVE_RELEASE_BRANCH`** — optionally set it to the current
  `release/vX.Y` so the nightly workflow targets it explicitly instead of
  auto-resolving the highest-semver branch.

> **What CI can and cannot enforce.** The scope/naming guards, CODEOWNERS, and
> templates live in the repo and take effect immediately. Required-check
> enforcement, required reviews, push restrictions, signed-commit requirements,
> auto-delete, and merge-strategy defaults are **admin-only repo settings** — the
> repository security model depends on administrators keeping them aligned with
> this baseline.

[skipped-job]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
