# Releasing Bramble

This runbook takes Bramble from a version bump on `main` to a published Chrome
Web Store listing. Releases are cut from `main` (trunk-based development; see
**[DEVELOPMENT.md](DEVELOPMENT.md)**). Two paths exist and share the same
packaged bytes:

- **Tag-driven (normal)** — merge a version-bump PR into `main`, then push a
  `vX.Y.Z` tag on that commit. `.github/workflows/release.yml` calls the
  reusable `release-build.yml` to build, package, generate the changelog notes,
  and create the GitHub Release. It refuses a tag whose commit is not on `main`.
- **Manual** — the same steps done by hand. This is the fallback when automation
  is unavailable or a credential is missing, and it is the source of truth for
  the human prerequisites (store account, listing assets, review, rollback) that
  the automation cannot create.

The release build has one **single-source version gate**: the tag must equal
the `package.json` / `apps/extension/public/manifest.json` version, or the
release fails before any artifact is built (`bun run check:release-version`).
Source and dependencies execute on the self-hosted builder with read-only
repository permission; a fresh hosted job receives the narrow write permission
needed to publish inert release artifacts.
An **optional, currently disabled** job can publish to the Chrome Web Store (see
[Chrome Web Store publish](#6-triggering-the-optional-chrome-web-store-publish)).

> Scope note: automation is issue #58; this document is issue #61. The Chrome
> Web Store publish is **wired but disabled** because there is no store account
> yet. Nothing below embeds a secret value — only secret **names** and the
> people/roles who hold access.

## 0. Release checklist

There are no release branches: a release is a tag on a `main` commit. Sections
1–9 are the mechanics each step relies on.

1. **Ready to ship.** Issues planned for the `vX.Y.Z` milestone (if one exists)
   are merged or moved to a later milestone, and nothing unfinished is reachable
   by users (DEVELOPMENT.md, "Keeping unfinished work away from users"). No
   release-blocking regression is open (check the
   `Nightly: main — failing checks` tracking issue, if any).
2. **Bump PR.** Open `chore/release-vX.Y.Z` from the latest `main`: bump
   `package.json` **and** `apps/extension/public/manifest.json` to `X.Y.Z` in
   lockstep (section 1), fill the `CHANGELOG.md` `[X.Y.Z]` section
   (`bun run changelog`), and run the single-source gate.
3. **Gates green.** The PR's required checks (`pr-guards`, `fast-checks`,
   `release-validation`) are green, and the nightly suite (E2E, live Sepolia
   import paths, sends and deploys, dependency audit, build —
   `.github/workflows/nightly.yml`) is green on `main`.
4. **Pre-release validation (when appropriate).** Before tagging, validate the
   `main` commit you intend to release: build + package + `sha256sum -c`
   (section 2), load the unpacked build, confirm E2E. Dispatch the nightly and
   check its Sepolia import-path verdicts in the job summary (it uploads
   nothing). Then run `verify-sepolia.ts` locally with
   `BRAMBLE_SEPOLIA_LEDGER=1` and the test Ledger for TA-32…TA-37, check TA-38 by
   hand, and commit that local run's scorecard as
   `tools/vendor-dataset/verification-sepolia-<date>.json`
   (`tools/vendor-dataset/README.md`) through a normal PR.
   The physical test Ledger check stays: import and blind-sign on the real
   device (TA-32…TA-38). The Speculos suite (`bun run test:e2e:ledger`) answers
   the dashboard steps with canned replies and fakes WebHID, so it does not
   replace real firmware. Its CI run is `.github/workflows/ledger-e2e.yml`,
   which fails by design while a Ledger app hash is unrecorded. They are
   re-recorded only when the pinned app commit or builder image changes: one
   maintainer records them with the workflow's `record_hashes` mode and a
   second independent build (another record run or a local build), and a
   second maintainer reviews that pull request
   (`tests/e2e/ledger/README.md`, "Recording the app hashes").
   `release.yml` ignores hyphenated tags, so an RC tag (`vX.Y.Z-rc.N`) builds
   nothing; validate the commit directly.
5. **Merge** the bump PR (squash).
6. **Tag.** A maintainer tags the bump's merge commit on `main` and pushes the
   tag (section 3). The release build runs and creates the GitHub Release.
7. **Publish.** Confirm the GitHub Release; run the optional, gated Chrome Web
   Store publish via manual dispatch (sections 5–7) when a store account exists.
8. **Close the `vX.Y.Z` milestone**, if there is one.

**Hotfixes:** there is no hotfix branch. Fix the bug on `main` through a normal
PR, then release a patch `vX.Y.Z+1` with the same checklist. Fix forward; never
re-tag or re-publish an older version (section 8). See DEVELOPMENT.md →
"Hotfixes".

## 1. Versioning and bump

The release version has **one source of truth**: `package.json` → `version`.
`apps/extension/public/manifest.json` → `version` mirrors it, and three gates forbid drift
(issue #59):

- `scripts/check-config-standards.ts` and `scripts/check-extension-manifest.ts`
  fail the build if the two versions differ or are not `x.y.z` (offline, every PR).
- `scripts/release-version.ts` (`bun run check:release-version`) is the **release
  gate**: it asserts the tag equals `v<version>` — the check that was missing
  when `v0.4.0` shipped as `mc-wallet-0.3.0.zip`. Its pure logic is unit-tested in
  `tests/conformance/release-version-single-source.test.ts`.

To bump, edit **both** files to the same new semver in the `chore/release-vX.Y.Z`
PR, then run the gates:

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
bun run package:extension           # writes artifacts/bramble-<version>.zip (+ .sha256)
bun run package:extension:firefox   # writes artifacts/bramble-firefox-<version>.zip (+ .sha256)
bun run check:firefox               # AMO's validator over dist-firefox/
```

`scripts/package-extension.ts` produces a **reproducible** zip (normalized
mtimes, pinned file set) plus a matching `.sha256`, so a rebuild of the same
commit on the same toolchain should give the same bytes. No workflow compares
the Release zip with the CI `bramble-extension` artifact: the release build's
checksum step only checks the zip against the `.sha256` it wrote itself.

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

## 3. Cutting a release (tag on `main`)

After the `chore/release-vX.Y.Z` PR is merged, a maintainer tags its merge
commit and pushes the tag. Agents never push tags unless the user explicitly
asks.

```sh
git fetch origin
git tag -s vX.Y.Z <merge-commit-sha>   # must match the version in package.json / manifest
git push origin vX.Y.Z
```

The tag push runs `.github/workflows/release.yml`, which:

1. resolves the tag to its commit and **refuses** it unless that commit is on
   `main`;
2. calls the reusable `release-build.yml`, which installs the toolchain exactly
   as CI does, runs `vendor:argent`, builds and packages both browser targets,
   runs AMO's validator (`check:firefox`) over the Gecko build, re-asserts the
   tag ↔ version gate, verifies each `.zip` matches its `.sha256`, and uploads
   the `bramble-release` artifact. A separate hosted job that never checks out
   wallet source creates the **GitHub Release** with both zips and their
   `.sha256` files attached: `bramble-<version>.zip` for Chromium and
   `bramble-firefox-<version>.zip` for addons.mozilla.org.

Release notes come from the matching `CHANGELOG.md` section (issue #60) — filled
in the bump PR via `bun run changelog` — falling back to a deterministic section
generated from the commit range since the previous tag.

Only `vX.Y.Z` tags trigger a build; hyphenated tags (`vX.Y.Z-rc.N`) and anything
not matching `v*` trigger nothing.

### Cutting a release (manual fallback)

Run steps 1-2 locally, then create the Release by hand (Releases → Draft a new
release), attaching `artifacts/bramble-<version>.zip`,
`artifacts/bramble-firefox-<version>.zip`, and their `.sha256` files.

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
- **Who holds access:** Tarek owns the Chrome Web Store developer account and
  the Bramble listing. A maintainer who needs dashboard access, or a change to
  the `chrome-web-store` environment secrets below, asks Tarek.

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

Reviewed listing copy, permission justifications, and asset requirements live in
`docs/chrome-web-store/`. The privacy policy is <https://bramble.fi/privacy>. Chrome's August
2026 disclosure policy requires every data collection to be disclosed before collection, including
local-only diagnostic collection; keep the dashboard, listing, privacy policy, and in-product
opt-in copy aligned.

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

### Never roll back; roll forward

Upgrades are one-way. Once a user unlocks a new version, the wallet migrates
their vault and preferences, and an older build can't open them: v0.10.5, for
example, refuses a v0.10.6 vault as an unsupported schema. The vault and
preferences stay intact while it is refused, and installing the current version
again over the old one reopens them; removing the extension deletes them.
Activity is not protected the same way: an older build drops activity rows it
can't parse, and its next activity write (status reconciliation runs without an
unlock) stores the list without them.

v0.10.9 is one of these: it moves the vault to schema v13 (#827), so v0.10.8
must not be republished after it.

So never republish, re-tag or attach an older version, on any channel. To pull
a bad release, ship a patch with a higher version (vX.Y.Z+1) that contains the
fix or the last good code. The Chrome Web Store refuses a lower version, but
AMO and self-hosted zips don't, so this rule is the only guard there. User-facing
recovery steps are in the README ("Upgrading") and on the website support page.

## 9. Where automation hooks in

- `.github/workflows/release.yml` — tag-driven Release (tag must be on `main`)
  + optional CWS publish.
- `.github/workflows/release-build.yml` — the reusable heavy build `release.yml`
  calls (read-only self-hosted build/package/tag ↔ version gate/notes, followed
  by hosted Release publication).
- `scripts/release-version.ts` — the single-source version gate (#59).
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
