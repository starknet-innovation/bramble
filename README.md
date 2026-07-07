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
- `src/ui` defines the design system: the replaceable color skin contract plus the shared scale
  tokens (spacing, radius, type, motion, control metrics) consumed by side panel styling.

## Migration Workflow

1. Bump `CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`.
2. Add one adjacent step to `VAULT_MIGRATIONS` in `src/storage/migrations.ts`.
3. Update schema validators and tests for old, current, and invalid vault data.
4. Run `bun run check`, `bun run build`, and `bun run package:extension`.

The vault schema is currently at **v2**. v2 adds a `mnemonic: string | null` field so the
wallet can derive more accounts and reveal the recovery phrase after re-authentication. Vaults
migrated from v1 (which never stored the phrase) carry `mnemonic: null` and cannot add accounts or
reveal a phrase until re-created; each migration step advances exactly one version
(`v0 → v1 → v2`) so a v1 vault produces a v1-shaped value before the v1→v2 step attaches the null
phrase. `mnemonic` only ever exists inside the encrypted vault envelope.

## Account Lifecycle and Secret Reveal

- **Backup verification (onboarding).** Generating a fresh phrase reveals confirmation inputs for
  words 3, 7, and 11. Those positions are deterministic on purpose: randomness would need a
  clock/entropy boundary that repo standards keep out of pure UI code, and fixed positions keep the
  predicate (`verifyBackupWords` in `src/sidepanel/backup-verify.ts`) pure and exhaustively
  testable. Create stays disabled until the words match. Pasting an existing phrase skips
  verification.
- **Add account.** `wallet.addAccount { networkId }` (privileged, session-authenticated) delegates
  to `WalletVaultService.addDerivedAccount`, which derives the next unused `accountIndex` for that
  network from the stored phrase, appends the account plus its signing key, and selects it.
- **Reveal seed / export key.** `wallet.revealSecrets { vaultPassphrase }` is privileged, requires
  the passphrase re-entered in the message (never the cached session), verifies it via `readVault`,
  and returns `{ mnemonic, privateKey }` for the active account. The settings-reachable reveal
  screen re-authenticates, warns strongly, blurs the values until tapped, and never persists them —
  they are wiped on the next render. `tests/key-boundary.test.ts` sanctions this reveal only for an
  extension-page sender with the correct passphrase.

### Import private key (not shipped)

Importing a raw private key is intentionally omitted. Krusty KMS exposes no
private-key-to-public-key derivation, so the wallet cannot compute an imported key's public key or
account address without adding local key-derivation crypto — which `CONTRIBUTING.md` forbids
("Do not add fallback signing, key derivation, or mnemonic validation code"). Shipping it would
require a new vendored Krusty KMS export and an `"imported"` account-derivation kind across the
schema, validators, and UI. It is deferred rather than shipped half-tested.

## Design System

Side panel styling is layered so each axis can be updated in one place:

- Colors: `Skin` tokens in `src/ui/skin.ts`. Replace `defaultSkin` in `src/sidepanel/index.ts`
  to swap the palette; `applySkin` rejects missing, extra, hidden, or accessor tokens.
- Scales: spacing, radius, type, motion, and control metrics live in `src/ui/tokens.ts` and are
  interpolated into the stylesheet.
- Components: `src/sidepanel/styles.ts` composes tokens into component classes used by the pure
  templates in `src/sidepanel/views.ts`.

Interaction contract: controls keep a constant 1px border and transition only paint properties,
so nothing moves on hover or press; screens animate only when the visible scene changes, and
`prefers-reduced-motion` disables motion entirely. `tests/sidepanel-styles.test.ts` enforces
these rules.

The background broadcasts `wallet.event` messages (`accountsChanged`, `networkChanged`,
`approvalsChanged`) after mutations. The side panel refreshes live from those events, and content
scripts forward `accountsChanged`/`networkChanged` to connected pages through the injected
provider's `on`/`off` subscription API — after re-querying which addresses each origin may see,
so events never leak wallet state to unconnected sites.

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
Click the extension action to open the Chrome side panel wallet.

Release zips and SHA-256 checksum files are written to `artifacts/` by
`bun run package:extension`.

CI uploads those same files as the `mc-wallet-extension` workflow artifact.

## Reproducible Builds

Every build input is pinned: Bun `1.3.3` (`packageManager` + CI), a frozen
lockfile, `wasm-pack 0.13.1`, GitHub Actions by commit SHA, and the Krusty KMS
source at the commit recorded in `scripts/vendor-krusty.ts`. To reproduce a
release, run the Commands section above on those versions and compare
`artifacts/*.zip.sha256` against the CI artifact checksum:

```bash
cd artifacts && shasum -a 256 -c mc-wallet-0.1.0.zip.sha256
```
