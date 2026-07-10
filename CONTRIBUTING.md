# Contributing

This wallet handles private keys, encrypted state, and extension permissions. Treat every change as
security-sensitive unless it is plainly documentation-only.

## Prerequisites / Setup

Install dependencies from the frozen lockfile first:

```bash
bun install --frozen-lockfile
```

Some gates need a toolchain beyond Bun and are expected to fail in offline
sandboxes:

- `bun run vendor:krusty` needs network access, `wasm-pack 0.13.1`, and a Rust
  toolchain (build Krusty KMS).
- `bun run vendor:multisig` needs `scarb 2.18.0` exactly (the multisig class
  hash pin is only reproducible on that version).

Without the vendored outputs, `check:krusty`, `check:multisig`, and `build`
fail; that is expected offline. Run the rest of the gates and say so.

Contributors can enable the local pre-push hook to run the offline-fast checks
(types, lint, file/config standards, extension manifest, unit tests) before
every push:

```bash
git config core.hooksPath .githooks
```

Bypass a single push with `git push --no-verify`.

## Required Gates

Run this before opening a pull request:

```bash
bun run vendor:krusty
bun run vendor:multisig
bun run check
bun run test:e2e:install
bun run build
bun run test:e2e
bun run package:extension
```

CI runs the same gates. Do not merge around them.

## Architecture Rules

- Keep files under 500 lines. Split by behavior, not by arbitrary layers.
- Keep modules narrow: crypto adapter, storage, migration, Starknet config, UI skin, popup, and
  background code stay separate.
- Pure code is the default. Side effects belong at browser, storage, network, clock, or randomness
  boundaries.
- Clock and randomness calls must stay in explicit boundary modules and remain covered by
  `bun run check`.
- Secret material fields may only appear in approved parser, session, crypto, encrypted-vault, and
  popup boundary modules enforced by `bun run check`.
- Krusty KMS owns wallet cryptography. Do not add fallback signing, key derivation, or mnemonic
  validation code.
- Krusty KMS source must stay pinned in `scripts/vendor-krusty.ts`; update the pin only with the
  full required gates.
- No fallback signing implementation. If Krusty KMS is unavailable, fail closed.
- Encrypted stores must validate decrypted data before use.
- Stored data access must go through permission checks. Do not read browser storage directly from UI
  code.
- Migrations must be deterministic functions with tests for old, current, and invalid data.
- UI code must depend on skin tokens, not hard-coded component-library details.
- Render dynamic text with `textContent` or `escapeHtml`; string HTML sinks stay in audited popup
  code only.
- Public APIs need doc comments that explain trust boundaries and failure behavior.

## Security Rules

- Never log secrets, ciphertext keys, mnemonics, signatures, passphrases, or decrypted vault data.
- Use Web Crypto for local store encryption. Use Krusty KMS for wallet/account cryptography.
- Treat extension messages as untrusted input. Validate type, origin, and requested capability.
- Request the smallest browser permissions possible.
- Prefer deny-by-default switches and allow lists over block lists.
- Do not use eval-style dynamic code execution; packaged scripts only.
- Runtime dependencies must stay pinned and explicit. Dev-tool dependencies must be pinned exactly.
- Any dependency addition needs a reason in the pull request and must be used immediately.
- Any change to key derivation, signing, encryption, storage schema, or permissions needs tests.

## Commits & PRs

- Commits must be GPG-signed.
- Commit style follows the existing history: an imperative summary line, an
  optional scope prefix like `ci:`, and a body that explains the why.
- Pull requests are squash-merged, so keep the PR title and description in the
  same commit style — that is what lands on `main`.
- Any dependency addition needs a justification in the pull request, must be
  pinned exactly, and must be used immediately. Prefer zero new dependencies.

## Code Style

- TypeScript stays strict. Do not weaken `tsconfig.json`.
- Biome owns formatting and linting.
- Do not suppress TypeScript or lint rules. Fix the boundary or add a narrower validator.
- Type-only imports, parameter immutability, and non-null checks are enforced by lint.
- Avoid classes unless state or browser resources make them simpler.
- Avoid abstractions with one speculative caller. Add them when duplication or a boundary proves they
  are needed.
- Prefer explicit return types at exported boundaries.

## Documentation

Keep docs close to the boundary they describe:

- `README.md` explains setup and the current security posture.
- `CONTRIBUTING.md` defines contributor rules.
- Source doc comments explain exported contracts.
- Tests document migration and storage invariants with executable examples.
