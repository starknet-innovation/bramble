# MC Wallet

Browser extension wallet scaffold for Starknet, built with Bun and TypeScript.

## Status

This repository starts with the extension shell, strict checks, encrypted storage primitives,
permissioned store access, migration tests, and a Krusty KMS WASM adapter boundary.

Krusty KMS is required for wallet cryptography. Its upstream README currently marks the project
experimental and not suitable for production or security-critical use, so this repo does not add a
local signing fallback.

## Commands

```bash
bun install
bun run vendor:krusty
bun run check
bun run build
bun run package:extension
```

## Architecture

- `src/background` owns privileged state, approvals, unlock sessions, and vault service wiring.
- `src/content` and `src/provider` bridge page requests to the background without exposing signing
  or vault operations to dapps.
- `src/storage` owns encrypted persistence, permission checks, schema validation, and migrations.
- `src/crypto` adapts Krusty KMS and rejects invalid inputs or WASM outputs at the boundary.
- `src/ui` defines the replaceable skin contract used by popup rendering.

## Migration Workflow

1. Bump `CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`.
2. Add one adjacent step to `VAULT_MIGRATIONS` in `src/storage/migrations.ts`.
3. Update schema validators and tests for old, current, and invalid vault data.
4. Run `bun run check`, `bun run build`, and `bun run package:extension`.

## UI Skin

Popup styling flows through `Skin` tokens in `src/ui/skin.ts`. Replace `defaultSkin` in
`src/popup/index.ts` to swap the skin; `applySkin` rejects missing, extra, hidden, or accessor
tokens.

## Krusty KMS

Wallet checks and cryptography require vendored WASM from Krusty KMS.

```bash
bun run vendor:krusty
bun run check
```

The vendor script checks out the pinned Krusty KMS commit in `scripts/vendor-krusty.ts`.
The build requires `vendor/krusty-kms/crates/wasm/pkg` and copies its runtime files into
`dist/vendor/krusty-kms/pkg`.

## Extension

Load `dist/` as an unpacked extension after `bun run build`.

Release zips and SHA-256 checksum files are written to `artifacts/` by
`bun run package:extension`.

CI uploads those same files as the `mc-wallet-extension` workflow artifact.
