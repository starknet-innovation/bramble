# Development workflow

This is the canonical guide to how work flows through Bramble: where you
branch from, where pull requests go, how changes reach a release, and what
CI runs at each stage. If you read only one document before opening a PR, read
this one.

It complements — does not replace — the other docs:

- **`CONTRIBUTING.md`** — the binding architecture, security, and code-style rules.
- **`AGENTS.md`** — the operational guide for coding agents (setup, gates, layout).
- **`RELEASING.md`** — the runbook that takes a tagged commit on `main` to a published build.

---

## TL;DR

- Bramble uses **trunk-based development**. `main` is the only long-lived
  branch, and it is **always releasable**.
- Do your work on a **short-lived branch** cut from the latest `main` and open a
  PR **straight into `main`**. Keep it small; merge it within a day or two.
- PRs are **squash-merged**. Any developer with write access may merge their own
  PR as soon as the required checks are green. No approval is required, but ask
  for review on risky changes (see [Review](#review)).
- Unfinished user-facing work must not be reachable by users: leave it unwired
  or put it behind a feature flag.
- A release is a **version-bump PR merged into `main`, then a `vX.Y.Z` tag** on
  that commit. Hotfixes are ordinary PRs into `main` followed by a patch release.
  There are no `release/` or `hotfix/` branches.

---

## Phases and milestones

The GTM roadmap (codename *Pharaoh*) is organized into **8 large, phase-gated
phases** plus an out-of-GTM terminal track. A phase is a big body of work with
its own exit criteria and spans several releases.

| Concept | What it is | Tracked by |
| --- | --- | --- |
| **Phase** | The roadmap "what / why" — a large capability area with phase-gate exit criteria | `phase:N` label + roadmap tracking issue (#79–#87) |
| **Milestone** | A planned release version (`v0.11.0`, …) — a planning bucket for the issues expected to ship in it | GitHub **milestone**; shipped as the matching `vX.Y.Z` tag on `main` |

Milestones are for planning only. They have no branch: work for every milestone
lands on `main`, and the release ships whatever `main` holds when it is tagged.
An issue carries its `phase:N` label (which phase) and, optionally, its
milestone (which release is expected to ship it).

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

---

## The branch model

```
          feat/… fix/… chore/… docs/…   (short-lived, squash-merged)
            ●──●       ●          ●──●──●
           /    \     / \        /       \
main ──●──●──────●───●───●──●───●─────────●──●──▶  (always releasable)
                             ▲                 ▲
                        tag v0.11.0       tag v0.11.1
                 (after chore/release-v0.11.0 PR merges)
```

- **`main`** — the trunk. Protected; reached only through pull requests.
  Every release is a tag on a `main` commit.
- **Working branches** — cut from the latest `main`, merged back into `main`
  through a squash-merged PR, then deleted. Recommended names:

  | Kind | Name | Example |
  | --- | --- | --- |
  | Feature | `feat/<issue>-<desc>` | `feat/28-external-allowances` |
  | Bug fix | `fix/<issue>-<desc>` | `fix/27-price-host-fallback` |
  | Chore / tooling | `chore/<issue>-<desc>` | `chore/94-ci-cache` |
  | Docs only | `docs/<desc>` | `docs/clarify-migration` |
  | Release bump | `chore/release-vX.Y.Z` | `chore/release-v0.11.0` |

  `<issue>` is the GitHub issue number; `<desc>` is a few kebab-case words.
  Naming is advisory: `pr-guards` warns about an unusual name but never fails
  on it.

Do not create `release/` or `hotfix/` branches, and do not keep a branch alive
for weeks. Rebase on (or merge) `main` often — at least daily while a branch is
open — so conflicts stay small.

### Keeping unfinished work away from users

Because every merge to `main` is releasable, a change that is not ready for
users must still be safe to ship. Either:

- **leave it unwired** — land the building blocks with tests, and connect them
  to a screen, message route, or dapp-facing API in a later PR; or
- **put it behind a feature flag** — declare the flag in
  `packages/features/flags/src/catalog.ts` with `enabled: false`. Bundled flags
  stay off until a release deliberately turns them on; a remote document may
  only kill a flag unless it is declared `toggle`, and only flags marked
  `localOverride` appear under Settings › Experimental features. Flags toggle
  code that ships; they never gate signing, key derivation, RPC endpoints,
  contract addresses, fee ceilings, permission checks, or privacy-pool
  parameters (`tests/conformance/feature-flag-isolation.test.ts`).

Storage migrations, permission changes, and anything a user's vault depends on
cannot hide behind a flag: once released they are one-way (RELEASING.md,
section 8). Land them only when they are ready to ship.

---

## Every PR into `main`

A PR should:

1. **Link its issue** — `#N`, or `Closes/Fixes/Resolves #N` when it fully
   closes it. `pr-guards` warns when no issue is linked; docs and small chores
   may go without one.
2. **Be small and focused.** One behavior change per PR. Split large work into
   a series of PRs that are each safe to release.
3. **Include tests** for the behavior it changes. Storage, permissions, signing,
   and migration changes always require tests (see `CONTRIBUTING.md`).
4. **Stay in scope.** New scope found along the way becomes a new issue, not an
   addition to an unrelated PR.
5. **Not expose unfinished work** (see above).

The pull-request template captures these as fields and checkboxes.

### Review

No approval is required to merge. CODEOWNERS still auto-requests reviewers, and
you should **wait for a review before merging** a change to a security-sensitive
area: signing and key handling, the vault and storage migrations, the
background, content script and provider, value-moving features (transactions,
multisig, privacy), and `.github/workflows` or `scripts/`. This is team
guidance, not a merge gate — the author decides, and owns the result.

### Merging

- Merge with **squash** once `pr-guards`, `fast-checks`, and
  `release-validation` are green and the branch is up to date with `main`.
- Any developer with write access may merge their own PR. Coding agents never
  merge (see `AGENTS.md`).
- Delete the head branch after merging (automatic when the repository setting
  is on).
- If a merge breaks `main`, fix forward with a new PR or revert it at once;
  `main` must stay releasable.

---

## Layered CI

Files: `.github/workflows/ci.yml`, `nightly.yml`, `ledger-e2e.yml`,
`mainnet-e2e.yml`. Only the `ci.yml` jobs are merge gates.

### 1. PR CI (`ci.yml`)

Trigger: every **`pull_request` into `main`**, and every **`push` to `main`**
(after a merge).

- **`pr-guards`** — advisory checks on a hosted runner: warns when the branch
  name does not follow the recommended pattern or no issue is linked. It never
  fails on naming.
- **`fast-checks`** — the fast, offline-capable gates on a hosted
  `ubuntu-latest` runner: Biome lint (`check:lint`), typecheck (`check:types`),
  the `check:files` standards gate (file and config standards together) and the
  extension-manifest check (`check:extension`), import-layer and cycle checks
  (`check:imports`, `check:cycles`), unit + conformance tests (`bun test tests`),
  and the coverage floor (`check:coverage`). No vendor toolchain, build or E2E,
  so feedback is fast.
- **`release-validation`** — the **full heavy pipeline** on the self-hosted
  CodeBuild runner: `vendor:argent`, `vendor:privacy`, `bun run check`, coverage
  floor, `build`, `test:e2e`, `package:extension`, the Firefox package and AMO
  validation (`check:firefox`), the `apps/terminal` typecheck and build, and the
  dependency audit (`check:audit`). It runs on every **same-repository** PR into
  `main` and again on every **push to `main`**, so the merged commit is
  validated too. **Fork PRs skip it** before merge — a fork cannot reach the
  self-hosted runner — and are covered by the post-merge run.

If a vendor step cannot complete (missing access or toolchain drift) it writes
the reason to the run summary and **fails** — it never fakes success. The
self-hosted job has read-only repository permission.

### 2. Nightly — full suite (`nightly.yml`)

Trigger: **scheduled** (`cron: 0 3 * * *`, 03:00 UTC) plus manual
`workflow_dispatch`, against the **current `main` commit**.

Runs the full **E2E (Playwright)** suite, the **dependency audit**
(`bun run check:audit`, re-run against the live advisory database so a new
advisory is caught without a code change), the extension **build**, and the live
**Sepolia** runs: the import-path scorecard (`tools/vendor-dataset/verify-sepolia.ts`,
issue 821; seeds from the `BRAMBLE_SEPOLIA_SEEDS` secret, scoped to that step)
and the sends and first deploys (issue 976; `BRAMBLE_SEPOLIA_TXN_SEED`). Each
Sepolia step is skipped and reported as "Not run" while its secret is unset, and
records and uploads nothing. When E2E fails, the run uploads `test-results/`
(traces, screenshots, video) as `nightly-e2e-debug` for 7 days.

The report job's summary lists **new failures**, **still failing**, **fixed
since last run**, **flaky** (passed on a Playwright retry) and **not run**. The
baseline is the open tracking issue, which keeps a hidden `nightly-state` line.
On failure it creates or updates **one** issue, `Nightly: main — failing checks`,
and closes it on the first green run. Source and dependencies
run in a read-only self-hosted job; a separate hosted job holds the narrow
`issues: write` permission and never checks out wallet code.

### 3. Ledger E2E (`ledger-e2e.yml`)

Runs the Speculos Ledger suite on PRs into `main` that touch Ledger code, on a
nightly schedule against `main`, and on manual dispatch. See
[tests/e2e/ledger/README.md](tests/e2e/ledger/README.md).

### 4. Mainnet E2E — live wallet (`mainnet-e2e.yml`)

Trigger: **scheduled** daily at 06:00 UTC (after nightly) and manual
`workflow_dispatch`, against the **current `main` commit**, once
`vars.MAINNET_E2E_CONFIGURED` is `true`. It runs the live mainnet suites with
spend caps checked before each signature and after the run. A failure upserts
the issue `Mainnet E2E: main — failing checks`, and every run — pass or fail —
posts a short result to Slack when the `SLACK_MAINNET_E2E_WEBHOOK_URL` secret is
set. It is not a merge gate. Setup is in
[docs/MAINNET_E2E_CI.md](docs/MAINNET_E2E_CI.md).

### What runs where

| Check | `fast-checks` (every PR) | `release-validation` (same-repo PRs + push to `main`) | Nightly (`main`) |
| --- | :---: | :---: | :---: |
| Lint, typecheck, file/config + manifest standards, import/cycle, unit/conformance tests, coverage | ✅ | ✅ | |
| Branch-name / linked-issue warnings (`pr-guards`) | ✅ (advisory) | | |
| Verify Krusty package, vendor Argent/Privacy, extension build, package | | ✅ | ✅ (build) |
| Firefox package + AMO validation | | ✅ | |
| Full E2E (Playwright) | | ✅ | ✅ |
| Dependency audit (`bun audit`) | | ✅ | ✅ (live DB) |
| Live Sepolia import, sends, deploys | | | ✅ |
| Perf / regression | | | ⚠️ placeholder (no suite exists yet) |

---

## Releasing

Releases are cut from `main`. `RELEASING.md` is the runbook; in short:

1. **Bump.** Open a `chore/release-vX.Y.Z` PR that bumps `package.json` and
   `apps/extension/public/manifest.json` to `X.Y.Z` in lockstep and fills the
   `CHANGELOG.md` `[X.Y.Z]` section (`bun run changelog`). Run
   `bun run check:release-version` and
   `bun test tests/conformance/release-version-single-source.test.ts`.
2. **Merge** it once its checks are green, and confirm nightly is green on `main`
   (no open `Nightly: main — failing checks` issue that blocks the release).
3. **Tag.** A maintainer tags that merge commit and pushes the tag:

   ```sh
   git tag -s vX.Y.Z <sha>
   git push origin vX.Y.Z
   ```

   `release.yml` calls `release-build.yml`, which re-checks the tag against the
   version, builds and packages both browser targets, writes checksums, and
   creates the GitHub Release. It refuses a tag whose commit is not on `main`.
4. **Publish (optional).** The Chrome Web Store publish is a separate, gated
   manual dispatch (RELEASING.md, sections 5–7).
5. Close the matching milestone, if there is one.

Release-candidate tags (`vX.Y.Z-rc.N`) are not built by `release.yml`: it
ignores hyphenated tags. Validate a candidate by running the checks in
RELEASING.md section 0 against the `main` commit you intend to tag.

### Hotfixes

There is no hotfix branch. Fix the bug on `main` through a normal PR
(`fix/<issue>-<desc>`), then cut a patch release (`vX.Y.Z+1`) the same way.
Always fix forward: never re-tag, re-publish or roll back to an older version
(RELEASING.md, section 8).

---

## Branch protection & repository security settings

CI, CODEOWNERS, templates, and the workflow-security policy in
`bun run check:files` live in the repository. Merge enforcement lives in the
GitHub ruleset for `main`, which repository administrators must keep aligned
with this baseline. **When this model was adopted, admins had to update the
live ruleset to match** (drop the required approvals and Code Owner review, drop
any `release/*` ruleset, and delete the `ACTIVE_RELEASE_BRANCH` repository
variable, which nothing reads any more).

### `main` — ruleset

- **Require a pull request before merging.**
- **Require status checks to pass:** `pr-guards`, `fast-checks`, and
  `release-validation`, and **require branches to be up to date**. A job
  skipped by a [job-level conditional reports success][skipped-job], so a fork
  PR that skips `release-validation` stays mergeable.
- **Required approvals: 0.** Do **not** require Code Owner review.
- **Block force-pushes and deletions** of `main`, and configure **no bypass
  actors**.
- **Require signed commits** if it is the org norm (`CONTRIBUTING.md` asks for
  signed commits).

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
- Keep **automatically delete head branches** enabled.
- **Default merge strategy: squash.**

> **What CI can and cannot enforce.** The guards, CODEOWNERS, and templates take
> effect from the repository. Required checks, push restrictions, signed
> commits, auto-delete, and the merge strategy are **admin-only settings**; each
> release audit reads them back rather than inferring them from YAML.

[skipped-job]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
