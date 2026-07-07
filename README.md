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

## Account class

Accounts use the OpenZeppelin `AccountUpgradeable` preset, pinned by Krusty KMS.

- Preset: OpenZeppelin `AccountUpgradeable`, Cairo `openzeppelin_presets` v3.0.0.
- Pinned class hash:
  `0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`
  (identical on Mainnet and Sepolia). Source of truth: the vendored Krusty KMS
  manifest `crates/kms/src/oz_account_class_manifest.json` at the commit pinned
  in `scripts/vendor-krusty.ts`. Address derivation matches `ozAccountDeployment`
  in `src/starknet/deployment.ts` (constructor `constructor(public_key: felt252)`).
- Audit: OpenZeppelin Contracts for Cairo audit reports —
  <https://github.com/OpenZeppelin/cairo-contracts/tree/main/audits> (API docs:
  <https://docs.openzeppelin.com/contracts-cairo/3.x/api/account#AccountUpgradeable>).

### Verification

Verified DECLARED on both networks with `starknet_getClass` against the Cartridge
endpoints on 2026-07-07 (RPC spec `0.10.2` mainnet, `0.9.0` sepolia); the class
resolved with the `UpgradeableImpl` + `AccountMixinImpl` ABI on both. Re-run:

```bash
for NET in mainnet sepolia; do
  curl -s -X POST "https://api.cartridge.gg/x/starknet/$NET" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClass","params":{"block_id":"latest","class_hash":"0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"}}' \
    | head -c 80; echo " <- $NET";
done
```

A non-empty `result` (not a `Class hash not found` error) confirms the class is
declared. If the RPC endpoint is unreachable from a sandbox, run the command from
a networked host and expect the same result.

## Migration Workflow

1. Bump `CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`.
2. Add one adjacent step to `VAULT_MIGRATIONS` in `src/storage/migrations.ts`.
3. Update schema validators and tests for old, current, and invalid vault data.
4. Run `bun run check`, `bun run build`, and `bun run package:extension`.

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

## Transaction replacement

Starknet has no mempool fee-bump or replace-by-nonce as of RPC 0.8: once
broadcast, a transaction is accepted, reverted, or dropped, and cannot be sped
up, replaced, or cancelled. Pending activity rows surface this with a hint line
and a tooltip; they typically settle within a few minutes. If a transaction is
dropped, the next transaction on that nonce proceeds normally. This is a protocol
constraint, not a wallet limitation.

## Allowance manager

Settings → Allowances lists the ERC20 approvals granted through this wallet
(spender, token, amount, account, network) and revokes any with one tap by
submitting `approve(spender, 0)` through the same verified send path as
transfers. Approvals are recorded from decoded `approve` calls when a dapp invoke
is submitted; the plain store lives at `mc-wallet:allowances`, outside the
encrypted vault. Enumerating allowances granted on other sites requires an
on-chain indexer and is a follow-up — only approvals made through this wallet are
tracked today.

## NFT gallery

Home → NFTs is a gallery of watched collectibles, kept as an optional `nfts` list
in preferences (contract, token id, network, optional label, spam flag). Adding
an NFT proves ownership on-chain (`owner_of`/`ownerOf`) against the active account
before it is stored; each NFT has a spam-hide toggle, and the detail screen sends
with `transfer_from` through the same verification + invoke path as transfers.
Limitations (follow-ups): metadata images are not fetched — the extension ships a
tight `host_permissions`/CSP allowlist, so remote image and `token_uri` loading
is out of scope for v1 — and sends use snake_case `transfer_from` only
(`safe_transfer_from` and camelCase entrypoints are not yet probed from the ABI).

## Reproducible Builds

Every build input is pinned: Bun `1.3.3` (`packageManager` + CI), a frozen
lockfile, `wasm-pack 0.13.1`, GitHub Actions by commit SHA, and the Krusty KMS
source at the commit recorded in `scripts/vendor-krusty.ts`. To reproduce a
release, run the Commands section above on those versions and compare
`artifacts/*.zip.sha256` against the CI artifact checksum:

```bash
cd artifacts && shasum -a 256 -c mc-wallet-0.1.0.zip.sha256
```
