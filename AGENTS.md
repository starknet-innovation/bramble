# Agent Guide — MC Wallet

Browser-extension wallet for Starknet. Bun + strict TypeScript, no framework. This file is the
operational guide for coding agents; `CONTRIBUTING.md` holds the binding architecture/security
rules and `README.md` the feature-level docs. Treat every change as security-sensitive.

## Setup and commands

```bash
bun install --frozen-lockfile
bun run vendor:krusty        # required once before check/build (clones + wasm-pack builds Krusty KMS)
bun run check                # types + lint + file/config standards + manifest + krusty adapter + tests
bun run build                # writes dist/ (loadable as an unpacked Chrome extension)
bun run package:extension    # writes artifacts/*.zip + .sha256
```

- `bun run vendor:krusty` needs network + `wasm-pack 0.13.1` + a Rust toolchain. Without the
  vendored `vendor/krusty-kms/crates/wasm/pkg`, `check:krusty` and `build` fail — that is
  expected in offline sandboxes; run the rest of the gates and say so.
- Narrower loops while iterating: `bun test tests/<name>.test.ts`, `bun run check:types`,
  `bun run check:lint`. Always finish with the full `bun run check`.
- `bun run format` (Biome) fixes formatting/lint; Biome owns style, don't hand-format.
- CI (`.github/workflows/ci.yml`) runs exactly the gates above plus `package:extension`. Do not
  merge around a failing gate.

## Layout

- `src/background` — privileged state, approvals, unlock sessions, message handlers, vault wiring.
- `src/content` + `src/provider` — page ↔ background bridge; injected `window.starknet_mcWallet`.
- `src/storage` — encrypted persistence, permission checks, schema validation, migrations.
- `src/crypto` — Krusty KMS WASM adapter; validates all inputs/outputs at the boundary.
- `src/starknet` — RPC, token registry, prices, deployment/derivation config.
- `src/security` — phishing blocklist and lookalike heuristics.
- `src/sidepanel` + `src/ui` — side-panel UI; pure view templates + skin/scale tokens.
- `scripts/` — build, packaging, vendoring, and the custom standards checks.
- `tests/` — flat `*.test.ts` files (bun test); `tests/fake-kms.ts` is the KMS test double.

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
  skin/scale tokens (`src/ui/skin.ts`, `src/ui/tokens.ts`), no hard-coded colors.
- Exported APIs need doc comments explaining trust boundaries and failure behavior (checked).
- New dependencies: pinned exact, justified in the PR, used immediately. Prefer zero.

## Schema migrations

Vault schema is versioned (`CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`). To change
stored shape: bump the version, add exactly one adjacent step to `VAULT_MIGRATIONS` in
`src/storage/migrations.ts`, update validators, and add tests for old, current, and invalid data.
Migrations must be deterministic. See README "Migration Workflow".

## Conventions

- Pure functions by default; classes only where state/browser resources demand them. Avoid
  single-caller speculative abstractions. Explicit return types at exported boundaries.
- Tests document invariants — when changing storage, permissions, signing paths, or migrations,
  the corresponding test file must change too (e.g. `tests/key-boundary.test.ts` sanctions every
  path that may expose secret material).
- Commit style follows the existing history: imperative summary line, optional scope prefix like
  `ci:`, body explains the why.
