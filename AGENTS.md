# Agent Guide — MC Wallet

Browser-extension wallet for Starknet. Bun + strict TypeScript, no framework. This file is the
operational guide for coding agents; `CONTRIBUTING.md` holds the binding architecture/security
rules and `README.md` the feature-level docs. Treat every change as security-sensitive.

## Setup and commands

```bash
bun install --frozen-lockfile
bun run vendor:krusty        # required once before check/build (clones + wasm-pack builds Krusty KMS)
bun run vendor:multisig      # required once before check/build (scarb-builds contracts/multisig)
bun run vendor:privacy       # required once before check/build (builds pinned official privacy SDK)
bun run check                # types + lint + standards + manifest + vendored pins + tests
bun run test:e2e:install     # Playwright Chromium browser (once per machine/CI image)
bun run build                # writes dist/ (loadable as an unpacked Chrome extension)
bun run test:e2e             # Playwright extension E2E (requires dist/)
bun run package:extension    # writes artifacts/*.zip + .sha256
```

- `bun run vendor:krusty` needs network + `wasm-pack 0.13.1` + a Rust toolchain;
  `bun run vendor:multisig` needs `scarb 2.18.0` exactly (the multisig class hash pin in
  `packages/features/multisig/src/deploy.ts` is only reproducible on that version); and
  `bun run vendor:privacy` needs Node.js 24 + npm. Without the vendored outputs,
  `check:krusty`/`check:multisig`/`check:privacy` and `build` fail — that is expected in offline
  sandboxes; run the rest of the gates and say so.
- Narrower loops while iterating: `bun test tests/<module>/<name>.test.ts`, `bun run check:types`,
  `bun run check:lint`, `bun run test:e2e:build` (build + extension E2E). Always finish with the
  full `bun run check`.
- `bun run format` (Biome) fixes formatting/lint; Biome owns style, don't hand-format.
- CI (`.github/workflows/ci.yml`) runs exactly the gates above plus `test:e2e` and
  `package:extension`. Do not merge around a failing gate.

## Layout

- `apps/extension` — MV3 static pages, entrypoints, browser storage adapter, privileged background
  orchestration, and extension build. This is the only extension composition root.
- `packages/foundation` — environment-independent values, validators, and provider/runtime protocol.
- `packages/platform` — storage, encrypted vault, Krusty, Starknet RPC, and Ledger adapters.
- `packages/features` — permissions, portfolio, transactions, multisig, privacy, and settings.
- `packages/presentation` — UI Kit and the production wallet UI used by the extension and UI Lab.
- `packages/testing/testkit` — shared deterministic test doubles; never a production dependency.
- `scripts/` — packaging, vendoring, and custom standards checks.
- Package unit tests live beside their owner in `packages/**/tests`. Cross-cutting `tests/`
  contains background/integration, conformance, browser E2E, and shared support suites.

## Hard rules (enforced by `bun run check` and review)

- **Never** add fallback signing, key derivation, or mnemonic validation — Krusty KMS owns wallet
  crypto; if it is unavailable, fail closed. The Krusty commit pin lives in
  `scripts/vendor-krusty.ts`; don't bump it casually.
- Never log or persist secrets outside the encrypted vault. Secret-material field names are only
  allowed in the boundary modules whitelisted in `scripts/check-file-standards.ts`.
- Clock/randomness calls live only in explicit boundary modules (inject `clock`/`fetch`/RNG into
  pure code). `Date.now()`/`crypto.getRandomValues()` in pure modules will fail the check.
- Files stay under 500 lines; split by behavior when you approach it.
- No suppressing TypeScript or Biome rules, no weakening `tsconfig.json`.
- Dynamic text renders via `textContent` or `escapeHtml`; string-HTML sinks only in audited files.
- Extension messages are untrusted: validate type, origin, and capability in the background.
- UI reads state only through permissioned stores, never raw browser storage; styling only through
  skin/scale tokens (`packages/presentation/ui-kit/src/theme/skin.ts` and `tokens.ts`), no hard-coded
  colors.
- Exported APIs need doc comments explaining trust boundaries and failure behavior (checked).
- New dependencies: pinned exact, justified in the PR, used immediately. Prefer zero.
- Never expose an STRK20 viewing key. Software-account viewing keys remain derived on demand and
  unpersisted. A Ledger viewing key may be retained only in encrypted v4 `accountSecrets` through
  the background-only vault service, bound to its exact account, chain, pool, and derivation scheme;
  it must never enter account metadata, preferences, activity, logs, session storage, messages, or
  UI state. Privacy-service responses are untrusted, and only the configured pool's `apply_actions`
  call may carry a prepared proof into submission.

## Schema migrations

Vault schema is versioned (`CURRENT_SCHEMA_VERSION` in `packages/platform/vault/src/schema/schema.ts`). To
change stored shape: bump the version, add exactly one adjacent step to `VAULT_MIGRATIONS` in
`packages/platform/vault/src/schema/migrations.ts`, update validators, and add tests for old, current, and
invalid data.
Migrations must be deterministic. See README "Migration Workflow".

## Conventions

- Pure functions by default; classes only where state/browser resources demand them. Avoid
  single-caller speculative abstractions. Explicit return types at exported boundaries.
- Tests document invariants — when changing storage, permissions, signing paths, or migrations,
  the corresponding test file must change too (e.g.
  `tests/background/routing/key-boundary.test.ts` sanctions every path that may expose secret material).
- Commit style follows the existing history: imperative summary line, optional scope prefix like
  `ci:`, body explains the why.

## Reuse before writing (anti-drift)

This repo has been built by multiple agents in sequence, and every real consistency bug so far
came from one agent re-deriving something another agent had already written. Before writing a
helper, a constant, a validator, or a test stub, **grep for it first** — if something close
exists, use or extend it in place rather than adding a sibling.

- Felt helpers live in `packages/foundation/wallet-model/src/networks/networks.ts` (`sameFelt`, `canonicalFelt`,
  `isStarkFieldElement`, …). Never re-implement numeric felt comparison or `0x` canonicalization
  locally — three drifted copies of `sameFelt` once shipped.
- Cross-layer limits are single-sourced (e.g. `MULTISIG_LIMITS` in
  `packages/features/multisig/src/chain.ts`,
  consumed by inputs, storage, and deploy code). A limit that appears in two files as separate
  literals will eventually desynchronize.
- Background message tests use the shared harness factories in `tests/support/` (e.g.
  `makeMultisigHarness`) instead of re-declaring wallet/RPC stubs per file, and
  `createMessageHandler` takes named options — wire collaborators by key, never positionally.
- Two lists are enforced-derived and will fail tests if you bypass them: the dapp-reachable
  message allowlist (`DAPP_MESSAGES` in `apps/extension/src/background/routing/senders.ts`, checked against the
  provider-bridge sources) and the key-boundary scan catalog
  (`tests/support/key-boundary-messages.ts`, checked against every handled `wallet.*` type). A
  new message type must be added to the catalog (and to `DAPP_MESSAGES` only if deliberately
  dapp-facing).
- Activity summaries are load-bearing: dedup guards match on them (see
  `apps/extension/src/background/multisig/multisig-tx-ops.ts`). Record deterministic, specific summaries, and never
  change one without checking what greps for it.

## Cursor Cloud specific instructions

The VM snapshot already has `bun`, `wasm-pack 0.13.1`, and a Rust toolchain on `PATH`, and the
Krusty KMS WASM package is already vendored — so `bun run check`, `bun run build`, and
`bun run package:extension` run out of the box. The startup update script only runs
`bun install --frozen-lockfile`; everything else below is background context, not steps to re-run.

- Rust default toolchain must be **stable** (currently 1.96+); an `edition2024` transitive dep
  fails to build under the older pinned 1.83 that some base images ship. If `bun run vendor:krusty`
  ever fails with an `edition2024`/`feature not stabilized` error, run `rustup default stable`.
- `vendor/krusty-kms/` persists in the snapshot (git-ignored). If it is missing (e.g. a clean
  checkout), regenerate it with `bun run vendor:krusty` (needs network + `wasm-pack` + Rust). This
  is the only build-like setup step and is intentionally kept out of the update script.
- There is **no dev server / watch mode**: this is a Chrome MV3 extension. To run/verify it,
  `bun run build` then load the `dist/` folder as an unpacked extension at `chrome://extensions`
  (Developer mode on), and open the side panel from the toolbar action. Re-run `bun run build` and
  reload the extension in Chrome to pick up source changes.
