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

## Krusty KMS

Wallet checks and cryptography require vendored WASM from Krusty KMS.

```bash
bun run vendor:krusty
bun run check
```

The vendor script checks out the pinned Krusty KMS commit in `scripts/vendor-krusty.ts`.
The build copies `vendor/krusty-kms/crates/wasm/pkg` into
`dist/vendor/krusty-kms/pkg` when it exists.

## Extension

Load `dist/` as an unpacked extension after `bun run build`.

Release zips and SHA-256 checksum files are written to `artifacts/` by
`bun run package:extension`.

CI uploads those same files as the `mc-wallet-extension` workflow artifact.
