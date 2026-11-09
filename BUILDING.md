# Building Bramble from source

`addons.mozilla.org` (AMO) requires a source-code submission for any add-on whose
reviewable code is bundled or minified. Bramble qualifies: `apps/extension/build.ts`
passes `minify: true` to every `Bun.build` call, and the package ships a pre-minified
vendored Privacy SDK bundle and a wasm binary. This document is the recipe a reviewer
follows to rebuild the submitted Firefox archive (`bramble-firefox-<version>.zip`) from
its source archive.

## Toolchain

The build is pinned to one Bun release: the `packageManager` field in `package.json`,
the version CI installs (`oven-sh/setup-bun` in `.github/workflows/`), and the version
named below all agree, and a `bun run check` guard fails if they drift. The packaged
bytes depend on that exact release, so the archive submitted to AMO must be the one CI
built for the source revision; a zip built elsewhere with a different Bun does not
reproduce, which is the pin mismatch recorded in
[#352](https://github.com/starknet-innovation/bramble/issues/352).

- **Bun 1.3.3** (<https://bun.sh>)
- **Node.js 24** with the **npm** it ships (`bun run vendor:privacy` runs `npm ci`)
- `git` and `zip`
- Network access: `bun install`, `vendor:argent` and `vendor:privacy` fetch pinned
  upstream sources.

Mozilla reviews source builds on Ubuntu; the steps below need nothing beyond the tools
above. They were verified on the `v0.10.5` source with Bun 1.3.3 (macOS arm64): two
independent rebuilds from the same source archive produced byte-identical
`bramble-firefox-0.10.5.zip` files. Releases built before the Bun pin (for example
`v0.10.3`, built with Bun 1.4.2) do not reproduce with this recipe. Before submitting,
confirm that a rebuild on Ubuntu matches the submitted archive's checksum, which is the
check the reviewer will perform.

## The submitted archive

The file submitted to AMO is the CI-built Gecko package for the release revision: the
`bramble-firefox-<version>.zip` inside the `bramble-extension` artifact uploaded by the
`release-validation` job of `.github/workflows/ci.yml` on the release's promotion pull
request into `main`. The same artifact carries `bramble-firefox-<version>.zip.sha256`;
that checksum is the one to give the reviewer. Do not submit a locally built zip.

## Steps

```sh
# 1. Unpack the source archive into a fresh git repository.
mkdir bramble-src && tar -xzf bramble-source-<version>.tar.gz -C bramble-src
cd bramble-src
git init -b main .
git add -A
git -c user.email=reviewer@example.invalid -c user.name=reviewer commit -m source

# 2. Install the exact dependency graph and the pinned vendor outputs.
bun install --frozen-lockfile
bun run vendor:argent
bun run vendor:privacy

# 3. Build and package the Gecko target.
bun run package:extension:firefox

# 4. Compare the rebuild with the submitted archive's checksum (from the CI artifact).
cd artifacts
echo "<sha256 of the submitted zip>  bramble-firefox-<version>.zip" | sha256sum -c
```

`bun run package:extension:firefox` runs the Gecko build and writes
`artifacts/bramble-firefox-<version>.zip` plus a `.sha256` computed from that same file.
That generated checksum only describes the rebuild itself, so checking the zip against it
proves nothing; step 4 compares against the checksum of the archive that was submitted.

The source archive is the shipped tag's tracked tree. It holds no vendored or built
output, so step 2 rebuilds those rather than shipping them:

```sh
git archive --format=tar.gz -o bramble-source-<version>.tar.gz <tag>
```

## Why step 1 is not optional

Two build-time guards make a plain "extract and build" fail, or produce an archive that
does not match the submitted add-on. Both are deliberate, and neither is weakened for a
source submission.

- **`vendor:privacy` refuses to run outside a git repository.** It snapshots
  `git status --porcelain` either side of the pinned upstream SDK build, so a
  third-party build script cannot silently edit wallet source. A source archive has no
  `.git`, so the guard throws *cannot snapshot the wallet checkout; refusing to run the
  upstream build*. `git init` supplies the repository it requires.
- **The checkout's branch must be `main`.** `apps/extension/build.ts` reads the branch
  and writes any value other than `main` or a detached `HEAD` into the extension name, so
  a plain `git init` (which creates `master`) yields `Bramble: Starknet Wallet · master`,
  a visible mismatch against the submitted add-on. `git init -b main` avoids it.
