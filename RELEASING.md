# Releasing Bramble

This runbook takes Bramble from a version bump to a published Chrome Web Store
listing. Two paths exist and share the same packaged bytes:

- **Automatic (release-on-merge)** — merging a `release/*` (or `hotfix/*`) branch
  into `main` runs `.github/workflows/auto-release.yml`, which derives the
  version from the merged branch, creates the `vX.Y.Z` tag on the merge commit,
  and calls the reusable `release-build.yml` to build, package, generate the
  changelog notes, and create the GitHub Release. **No manual tag push.**
- **Tag-driven** — pushing a `vX.Y.Z` tag by hand runs
  `.github/workflows/release.yml`, which calls the same reusable build. Use this
  only for a one-off or backfilled release; the normal path is the automatic one.
- **Manual** — the same steps done by hand. This is the fallback when automation
  is unavailable or a credential is missing, and it is the source of truth for
  the human prerequisites (store account, listing assets, review, rollback) that
  the automation cannot create.

Both automated paths share one heavy pipeline (`release-build.yml`) and one
**single-source version gate**: the tag must equal the `package.json` /
`apps/extension/public/manifest.json` version, or the release fails before any artifact is
built (`bun run check:release-version`). Source and dependencies execute on the
self-hosted builder with read-only repository permission; a fresh hosted job
receives the narrow write permission needed to publish inert release artifacts.
An **optional, currently disabled** job can publish to the Chrome Web Store (see
[Chrome Web Store publish](#6-triggering-the-optional-chrome-web-store-publish)).

> Scope note: automation is issue #58; this document is issue #61. The Chrome
> Web Store publish is **wired but disabled** because there is no store account
> yet. Nothing below embeds a secret value — only secret **names** and the
> people/roles who hold access.

## 0. Release-branch completion checklist (roadmap-driven model)

Under the release-branch model (see **[DEVELOPMENT.md](DEVELOPMENT.md)**), a
release is a milestone (`vX.Y`) on a `release/vX.Y` branch cut from `main`. The
steps below take a scope-complete release branch through a release candidate to
a tagged, published `vX.Y.0` on `main`. Sections 1–9 remain the mechanics each
step relies on.

1. **Scope complete.** Every roadmap issue in the `vX.Y` milestone is closed or
   explicitly deferred to a later milestone; the release's acceptance criteria
   are met; no unresolved release-blocking regressions remain (check the
   `Nightly: release/vX.Y — failing checks` tracking issue, if any).
2. **Version metadata.** Bump `package.json` **and** `apps/extension/public/manifest.json` to
   `X.Y.0` in lockstep (section 1) and run the single-source guard.
3. **Gates green.** Required PR CI is green on the release-branch tip; the
   nightly / full suite (E2E, dependency audit, build — `.github/workflows/nightly.yml`)
   is green on `release/vX.Y`.
4. **Release notes.** Draft the notes (CHANGELOG section once #60 lands;
   otherwise the tag's auto-generated notes).
5. **Release candidate (when appropriate).** Tag `vX.Y.0-rc.1` on the release
   branch and run a final validation pass — build + package + `sha256sum -c`
   (section 2), load the unpacked build, confirm E2E. Iterate `-rc.2`, … if the
   RC turns up blockers. RC tags are validation only; they do not publish.
6. **Full validation.** Confirm the RC against the acceptance criteria.
7. **Promote to `main`.** Merge `release/vX.Y` → `main` as a **merge commit**
   (not squash — preserve release history), done explicitly by a maintainer.
8. **Automatic release.** The merge triggers `auto-release.yml`: it derives the
   version from the merged branch, cross-checks it against
   `package.json`/`manifest` (the single-source gate — a promotion that skipped
   step 2 fails here), tags `vX.Y.0` on the merge commit, and cuts the GitHub
   Release with the artifact + changelog notes. No manual tag push is needed;
   push `vX.Y.0` by hand only to backfill a release the automation missed.
9. **Publish.** Confirm the GitHub Release; run the optional, gated Chrome Web
   Store publish via manual dispatch (sections 5–7) when a store account exists.
10. **Close / archive the `vX.Y` milestone.**
11. **Cut the next release** branch from the updated `main` and point
    `vars.ACTIVE_RELEASE_BRANCH` at it (used by the nightly workflow).

**Hotfixes:** branch `hotfix/<desc>` from `main` (or the affected release tag),
merge into `main`, tag the patch `vX.Y.Z`, then **forward-apply** the same fix to
any active `release/vX.Y` branch that lacks it. Never leave a fix only on an
older release branch. See DEVELOPMENT.md → "Hotfixes & backports".

## 1. Versioning and bump

The release version has **one source of truth**: `package.json` → `version`.
`apps/extension/public/manifest.json` → `version` mirrors it, and three gates forbid drift
(issue #59):

- `scripts/check-config-standards.ts` and `scripts/check-extension-manifest.ts`
  fail the build if the two versions differ or are not `x.y.z` (offline, every PR).
- `scripts/release-version.ts` (`bun run check:release-version`) is the **release
  gate**: it asserts the tag equals `v<version>` and, on an auto-release, that the
  `release/vX.Y` (or `release/vX.Y.Z`) branch implies exactly that version — the check that was missing
  when `v0.4.0` shipped as `mc-wallet-0.3.0.zip`. Its pure logic is unit-tested in
  `tests/conformance/release-version-single-source.test.ts`.

To bump, edit **both** files to the same new semver (a `release/vX.Y` branch
ships `X.Y.0`, a `release/vX.Y.Z` branch ships `X.Y.Z`), then run the gates:

```sh
bun test tests/conformance/release-version-single-source.test.ts
bun run check:files
```

Chrome Web Store rejects re-publishing the same or a lower version, so the new
version **must be strictly greater** than the currently published one.

## 2. Build, package, and verify locally

```sh
bun install --frozen-lockfile
bun run vendor:argent      # verifies the pinned official Argent release
bun run build              # writes dist/
bun run package:extension  # writes artifacts/bramble-<version>.zip (+ .sha256)
```

`scripts/package-extension.ts` produces a **reproducible** zip (normalized
mtimes, pinned file set) plus a matching `.sha256`. The bytes on the Release
page, in the Chrome Web Store, and in the CI `bramble-extension` artifact are
therefore identical for a given commit.

Verify the checksum before trusting a zip:

```sh
cd artifacts && sha256sum -c ./*.zip.sha256
```

### Offline quality-gate subset

Run before tagging (these need no network/Rust):

```sh
bun run check:types
bun run check:lint       # bun run format to autofix
bun run check:files
bun run check:extension
bun test
```

The full `bun run check` (plus `vendor:argent`, `build`, `test:e2e`) runs in CI.

## 3. Cutting a release (automatic on merge)

The normal path needs **no tag push**. When `release/vX.Y` (or a `hotfix/*`
branch) is merged into `main`, `.github/workflows/auto-release.yml`:

1. resolves the merged head branch from the PR on the merge commit; a chore/docs
   merge resolves to no release and the workflow exits cleanly;
2. runs the single-source gate — derives `X.Y.0` from `release/vX.Y`, `X.Y.Z`
   from a `release/vX.Y.Z` patch branch (or the package version for a hotfix) and **fails** if `package.json`/`manifest` do
   not match, so a promotion that skipped the version bump cannot ship;
3. creates the `vX.Y.0` tag on the merge commit (skipped if it already exists —
   idempotent, so a re-run never double-cuts);
4. calls the reusable `release-build.yml`, which installs the toolchain exactly
   as CI does, runs `vendor:argent`/`build`/`package:extension`, re-asserts the
   tag ↔ version gate, verifies the `.zip` matches its `.sha256`, and uploads the
   `bramble-release` artifact. A separate hosted job that never checks out
   wallet source creates the **GitHub Release** with the zip + `.sha256`
   attached.

Release notes come from the matching `CHANGELOG.md` section (issue #60) — kept
current on the release branch via `bun run changelog` — falling back to a
deterministic section generated from the commit range since the previous tag.

### Backfill / one-off (tag-driven)

To cut a release the automation missed, push the tag by hand; it drives the same
reusable build via `.github/workflows/release.yml`:

```sh
git tag v0.2.0      # must match the version in package.json / manifest
git push origin v0.2.0
```

A tag that does not match `v*` triggers nothing.

### Cutting a release (manual fallback)

Run steps 1-2 locally, then create the Release by hand (Releases → Draft a new
release), attaching `artifacts/bramble-<version>.zip` and its `.sha256`.

Creating the release via the GitHub UI is also supported: the release step is
create-or-upload, so it attaches the built assets to an existing (UI-created)
release rather than failing on the duplicate tag — either a tag push or a UI
release works.

## 4. Chrome Web Store — one-time prerequisites

These are **maintainer/manual** steps the automation cannot perform. They must
be true before any publish (automated or manual) can succeed.

### Developer account

- A Chrome Web Store **developer account** owns the listing. Register at the
  [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and pay
  the one-time registration fee.
- The owning Google account must be a **verified publisher** in good standing
  with **2-Step Verification** enabled (required to publish/update via the API).
- **Who holds access:** record the owning account and how a new maintainer
  requests it here. _TODO: no store account exists yet — fill in the owner
  role/contact when the account is created._

### Create the item / listing

Create the item once (via the dashboard) and note its **item/extension ID**
(this becomes `CWS_EXTENSION_ID`). Complete the Store Listing:

- **Icons:** 128×128 PNG store icon (the manifest also ships action icons).
- **Screenshots:** at least one, 1280×800 or 640×400 PNG/JPEG.
- **Promo images:** required small tile 440×280; optional marquee 1400×560.
- **Text:** name, short description (≤132 chars), detailed description,
  category, primary language.

### Privacy practices and permissions

Required before review will pass:

- **Single-purpose** declaration.
- **Data-usage** disclosures (what is collected, how it is used/shared).
- **Permissions justification** for every requested permission and host
  permission. For this MV3 Starknet wallet, expect to justify the RPC/host
  permissions in `apps/extension/public/manifest.json` (Starknet Foundation RPC, CoinGecko,
  and the local devnet hosts), the `alarms` permission that schedules background
  transaction reconciliation, and side-panel/storage usage. Vague or missing
  justifications are the most common rejection reason.
- A **privacy policy** URL if any user data is handled.

Reviewed listing copy, privacy policy, permission justifications, and asset requirements live in
`docs/chrome-web-store/`. Chrome's August 2026 disclosure policy requires every data collection to
be disclosed before collection, including local-only diagnostic collection; keep the dashboard,
listing, privacy policy, and in-product opt-in copy aligned.

## 5. Chrome Web Store — API credentials and secrets

The publish job uses the Chrome Web Store Publish API. Generate credentials once
(see Google's guide, linked below):

1. In the Google Cloud console, enable the Chrome Web Store API and create an
   **OAuth client** of type *Desktop app*. This yields a **client ID** and
   **client secret**.
2. With that client, run Google's OAuth consent flow **once** (scope
   `https://www.googleapis.com/auth/chromewebstore`) to obtain a long-lived
   **refresh token** for the item-owning Google account.

Store the four values as **encrypted secrets in the `chrome-web-store` GitHub
Actions environment** (Settings → Environments). Names only — never commit
values:

| Secret | Meaning |
| --- | --- |
| `CWS_CLIENT_ID` | OAuth2 client ID (Desktop-app client) |
| `CWS_CLIENT_SECRET` | OAuth2 client secret |
| `CWS_REFRESH_TOKEN` | Long-lived refresh token for the item-owning account |
| `CWS_EXTENSION_ID` | The Chrome Web Store item/extension ID to update |

The `chrome-web-store` environment is restricted to protected branches, and the
workflow independently accepts a publish dispatch from `main` only. Before
adding credentials, configure a required environment reviewer who is not the
person initiating the publish. GitHub does not expose required-reviewer
protection for private repositories on every plan; on a plan without it, leave
the credentials absent until the plan or access model is upgraded.

Until all four secrets exist, the publish job **skips cleanly**
(`scripts/publish-chrome-web-store.ts` logs "publish skipped — not configured"
and exits 0).

## 6. Triggering the optional Chrome Web Store publish

The store publish **never** runs on a tag push. It runs only via a manual
dispatch from protected `main`:

1. Actions → **Release** → *Run workflow*.
2. Select **`main`** in “Use workflow from.” Any other selected ref cannot reach
   the publish job.
3. The workflow reads the version from trusted `main`, requires the matching
   `vX.Y.Z` tag to already exist, and rebuilds that immutable tag. It never
   publishes arbitrary branch bytes.
4. Set inputs:
   - `publish: true` — required to reach the publish job at all.
   - `publish_target: trustedTesters | default` — see below.
   - `deploy_percentage` — optional staged rollout (see below).
   - `dry_run: true` — validate the package and request plan without publishing.

The job downloads the `bramble-release` artifact built by `build-release`,
verifies its SHA-256 checksum, checks out the reviewed publish client from
protected `main` on a fresh hosted runner, and invokes it. The client:

1. exchanges `CWS_REFRESH_TOKEN` (+ client id/secret) for a short-lived access
   token;
2. `PUT`s the zip to `/upload/chromewebstore/v1.1/items/$CWS_EXTENSION_ID` and
   waits for `uploadState = SUCCESS`;
3. `POST`s `/chromewebstore/v1.1/items/$CWS_EXTENSION_ID/publish` with the chosen
   `publishTarget`.

On success the API returns `OK` / `ITEM_PENDING_REVIEW`. A missing secret makes
the job skip cleanly; a **real** API rejection fails the job (non-zero exit) with
the error surfaced and no secret value logged.

### Publish targets

- `trustedTesters` — publishes to your configured testers only. Use this for a
  staged/internal check first. **Default** for this workflow.
- `default` — publishes to the public store.

### Staged / partial rollout

`deploy_percentage` (0-100) requests a partial rollout. It is **opt-in**: leave
it blank for a full rollout. Partial rollout depends on the account's
partial-rollout capability / API version, so only set it once that is confirmed —
never assume it.

### Dry run

`dry_run: true` validates configuration and the packaged zip and logs the request
plan (target, rollout, zip path/size) **without** any network call. Use it to
confirm wiring before a real publish.

## 7. Review latency — "submitted for review" is terminal

After upload + publish the item enters Chrome Web Store **review**. There is no
SLA; review can take hours to days. The pipeline's terminal success state is
**"submitted for review"** (`ITEM_PENDING_REVIEW`) — it does **not** wait for or
assert that the item is live. Track the outcome in the Developer Dashboard.

Deferred publishing (submit now, manually publish later within the ~30-day
window) is a dashboard-only option and is intentionally not automated.

## 8. Rollback / what if review rejects

- **Review rejects the submission:** read the rejection reason in the dashboard
  (usually a permissions justification or privacy disclosure gap), fix it, bump
  the version (step 1), and resubmit.
- **A published version regresses:** in the dashboard you can **halt a staged
  rollout**, or **unpublish** the item to remove it from the store (existing
  installs keep the bad version until they update).
- **Ship a corrected version:** the store cannot "roll back" to prior bytes —
  bump to a **new, higher** version containing the fix (or the prior known-good
  code re-tagged at a higher version) and republish. A re-published fix also
  goes through review, so expect the same latency.
- **User impact:** users on the bad version keep it until the corrected version
  passes review and their browser auto-updates the extension.

## 9. Where automation hooks in

- `.github/workflows/auto-release.yml` — automatic release-on-merge: derive the
  version from the merged branch, tag, and cut the Release.
- `.github/workflows/release.yml` — tag-driven backfill Release + optional CWS
  publish.
- `.github/workflows/release-build.yml` — the reusable heavy build both paths
  call (read-only self-hosted build/package/tag ↔ version gate/notes, followed
  by hosted Release publication).
- `scripts/release-version.ts` — the single-source version gate and
  branch → version derivation (#59).
- `scripts/generate-changelog.ts` — deterministic `CHANGELOG.md` section
  generation and release-notes extraction (#60).
- `scripts/package-extension.ts` — the single source of the packaged artifact.
- `scripts/publish-chrome-web-store.ts` — the CWS publish client (skips when
  unconfigured, fails closed on real errors).

## References

- [Chrome Web Store Publish API — reference](https://developer.chrome.com/docs/webstore/api)
- [Using the Publish API (OAuth2, upload, publish, status)](https://developer.chrome.com/docs/webstore/using-api)
- [Publishing your extension / review](https://developer.chrome.com/docs/webstore/publish)
- [Developer registration](https://developer.chrome.com/docs/webstore/register)
