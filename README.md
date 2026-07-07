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

## Tokens, Prices, and Spam Filtering

Token tracking spans a few narrow modules:

- Custom tokens: the privileged `wallet.addToken { address }` message reads `name`, `symbol`, and
  `decimals` on-chain through `getTokenMetadata` in `src/starknet/rpc.ts` (felt short-string and
  Cairo ByteArray decoding), normalizes the symbol, and stores it through `preferencesStore`. The
  UI lives on the tokens flow (`src/sidepanel/token-flows.ts`), reachable from the home Balances
  header and Settings.
- Auto-detection: `src/starknet/token-registry.ts` vendors a curated mainnet registry (ETH, STRK,
  USDC, USDT, DAI, WBTC). `wallet.detectTokens` probes `balanceOf` for registry tokens not yet
  tracked and returns held ones as one-tap suggestions. Registry addresses marked `VERIFY` are
  advisory; a wrong address simply fails its probe and is never surfaced, and detection never
  authorizes a transfer.
- Spam filtering: the same registry module exports heuristics (registry-symbol spoofing with
  confusable folding, absurd decimals, empty names). Flagged tokens are hidden from home by
  default; the tokens flow reveals them with a warning. A backwards-compatible optional
  `hiddenTokens` preference (like `rpcOverrides`) records user hide/show choices.
- Prices: `src/starknet/prices.ts` fetches CoinGecko `simple/token_price` and `market_chart` for
  the `starknet` platform (host permission `https://api.coingecko.com/*`), cached in storage with a
  ~5 minute TTL behind an injected clock. Fetching happens only in the background worker through an
  injected `fetch`; every failure degrades to cached-or-empty so the UI omits fiat when offline.
  Home balance rows and the hero portfolio total use `preferences.displayCurrency`.
- Token detail: tapping a balance row opens a detail flow with the current price, a self-drawn
  7-day SVG sparkline (`src/sidepanel/sparkline.ts`), holdings, and contract facts.

Known limitations (v1): registry coverage is mainnet-only and address-verified from public token
lists; fiat prices depend on CoinGecko's Starknet coverage and address normalization, so some
tokens show no price; spam-flagged tokens cannot yet be force-pinned to home (they stay on the
tokens flow); custom tokens whose on-chain symbol is not a `[A-Z0-9]{2,12}` ticker are rejected;
there is no dedicated remove-token action (hide instead).

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

## Reproducible Builds

Every build input is pinned: Bun `1.3.3` (`packageManager` + CI), a frozen
lockfile, `wasm-pack 0.13.1`, GitHub Actions by commit SHA, and the Krusty KMS
source at the commit recorded in `scripts/vendor-krusty.ts`. To reproduce a
release, run the Commands section above on those versions and compare
`artifacts/*.zip.sha256` against the CI artifact checksum:

```bash
cd artifacts && shasum -a 256 -c mc-wallet-0.1.0.zip.sha256
```
