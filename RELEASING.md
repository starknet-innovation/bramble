# Releasing MC Wallet

This runbook takes MC Wallet from a version bump to a published Chrome Web Store
listing. Two paths exist and share the same packaged bytes:

- **Automated** — pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`,
  which builds, packages, and creates a GitHub Release. An **optional, currently
  disabled** job can publish to the Chrome Web Store (see
  [Chrome Web Store publish](#chrome-web-store-publish)).
- **Manual** — the same steps done by hand. This is the fallback when automation
  is unavailable or a credential is missing, and it is the source of truth for
  the human prerequisites (store account, listing assets, review, rollback) that
  the automation cannot create.

> Scope note: automation is issue #58; this document is issue #61. The Chrome
> Web Store publish is **wired but disabled** because there is no store account
> yet. Nothing below embeds a secret value — only secret **names** and the
> people/roles who hold access.

## 1. Versioning and bump

The extension version is hand-duplicated in two files and kept in lockstep by a
guard test:

- `package.json` → `version`
- `public/manifest.json` → `version`
- Guard: `tests/conformance/version-single-source.test.ts` (also enforced by
  `scripts/check-config-standards.ts`, which fails the build if the two versions
  differ or are not `x.y.z`).

To bump, edit **both** files to the same new semver, then run the guard:

```sh
bun test tests/conformance/version-single-source.test.ts
```

Chrome Web Store rejects re-publishing the same or a lower version, so the new
version **must be strictly greater** than the currently published one. Single-
sourcing the version is tracked in issue #59; until it lands, bump both fields.

## 2. Build, package, and verify locally

```sh
bun install --frozen-lockfile
bun run vendor:krusty      # checks out the pinned Krusty KMS commit and builds wasm
bun run vendor:multisig    # vendors the multisig contract class
bun run build              # writes dist/
bun run package:extension  # writes artifacts/mc-wallet-<version>.zip (+ .sha256)
```

`scripts/package-extension.ts` produces a **reproducible** zip (normalized
mtimes, pinned file set) plus a matching `.sha256`. The bytes on the Release
page, in the Chrome Web Store, and in the CI `mc-wallet-extension` artifact are
therefore identical for a given commit.

Verify the checksum before trusting a zip:

```sh
cd artifacts && sha256sum -c ./*.zip.sha256
```

### Offline quality-gate subset

Run before tagging (these need no network/Rust/Scarb):

```sh
bun run check:types
bun run check:lint       # bun run format to autofix
bun run check:files
bun run check:extension
bun test
```

The full `bun run check` (plus `vendor:krusty`, `vendor:multisig`, `build`,
`test:e2e`) runs in CI, which needs network + the Rust/Scarb toolchain.

## 3. Cutting a release (automated)

1. Ensure `main` is green in CI and the version is bumped (step 1).
2. Create and push the version tag:

   ```sh
   git tag v0.2.0      # must match the version in package.json / manifest
   git push origin v0.2.0
   ```

3. `.github/workflows/release.yml` (`build-release` job) then:
   - installs the toolchain exactly as CI does, runs `vendor:krusty`,
     `vendor:multisig`, `bun run build`, `bun run package:extension`;
   - asserts the version single-source guard before publishing;
   - verifies the `.zip` matches its `.sha256`;
   - uploads the zip + checksum as the `mc-wallet-release` workflow artifact;
   - creates a **GitHub Release** for the tag with the zip + `.sha256` attached.

   Release notes come from the matching `CHANGELOG.md` section when it exists
   (issue #60); until then the workflow falls back to GitHub's auto-generated
   notes (the commit range since the previous tag).

A tag that does not match `v*` triggers nothing.

### Cutting a release (manual fallback)

Run steps 1-2 locally, then create the Release by hand (Releases → Draft a new
release), attaching `artifacts/mc-wallet-<version>.zip` and its `.sha256`.

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
- **Promo images (optional):** small tile 440×280; marquee 1400×560.
- **Text:** name, short description (≤132 chars), detailed description,
  category, primary language.

### Privacy practices and permissions

Required before review will pass:

- **Single-purpose** declaration.
- **Data-usage** disclosures (what is collected, how it is used/shared).
- **Permissions justification** for every requested permission and host
  permission. For this MV3 Starknet wallet, expect to justify the RPC/host
  permissions in `public/manifest.json` (Cartridge/CoinGecko endpoints and the
  local devnet hosts) and side-panel/storage usage. Vague or missing
  justifications are the most common rejection reason.
- A **privacy policy** URL if any user data is handled.

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

The `chrome-web-store` environment scopes these secrets so PR/fork runs can
never read them. Until all four exist, the publish job **skips cleanly**
(`scripts/publish-chrome-web-store.ts` logs "publish skipped — not configured"
and exits 0).

## 6. Triggering the optional Chrome Web Store publish

The store publish **never** runs on a tag push. It runs only via manual
dispatch:

1. Actions → **Release** → *Run workflow*.
2. Set inputs:
   - `publish: true` — required to reach the publish job at all.
   - `publish_target: trustedTesters | default` — see below.
   - `deploy_percentage` — optional staged rollout (see below).
   - `dry_run: true` — validate the package and request plan without publishing.

The job downloads the `mc-wallet-release` artifact built by `build-release`,
then runs `bun run release:publish`, which:

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

- `.github/workflows/release.yml` — tag-driven Release + optional CWS publish.
- `scripts/package-extension.ts` — the single source of the packaged artifact.
- `scripts/publish-chrome-web-store.ts` — the CWS publish client (skips when
  unconfigured, fails closed on real errors).
- Follow-ups: single-source the version (#59); adopt `CHANGELOG.md` for release
  notes (#60).

## References

- [Chrome Web Store Publish API — reference](https://developer.chrome.com/docs/webstore/api)
- [Using the Publish API (OAuth2, upload, publish, status)](https://developer.chrome.com/docs/webstore/using-api)
- [Publishing your extension / review](https://developer.chrome.com/docs/webstore/publish)
- [Developer registration](https://developer.chrome.com/docs/webstore/register)
