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

## dApp Provider

The injected `window.starknet_mcWallet` object follows the get-starknet/starknetkit
`StarknetWindowObject` shape: `id`, `name`, `version`, an inline `data:` URI `icon`, `isConnected`,
`selectedAddress`, `on`/`off`, `enable`, and `request`. `chainId` is initialized lazily from
`wallet_requestChainId` after `enable` and kept current from `networkChanged` events;
`isPreauthorized()` resolves `true` when the origin already holds an account grant. The object is
frozen and installed as a non-configurable global.

`request` accepts these methods, mapped to safe background messages by `src/provider/bridge.ts`:
`wallet_requestAccounts`/`mc_requestAccounts`, `mc_accounts`, `wallet_requestChainId`,
`wallet_switchStarknetChain`, `wallet_addInvokeTransaction`, `wallet_signTypedData`,
`wallet_getPermissions` (returns `["accounts"]` when the origin is connected, else `[]`), and
`wallet_watchAsset`.

Grants and provider events are isolated per origin: each origin reads only its own accounts
(`wallet.getGrantedAccounts`) and each content script derives page events from its own history
(`pageEventsFor`), so multiple connected sites never observe each other's state.

`wallet_watchAsset` (SNIP-compatible ERC20, `options.address`) fetches the token's on-chain
`name`/`symbol`/`decimals` via RPC (falling back to the caller's options), then queues a
`watch-asset` approval rendered in the side panel. Approving calls `preferencesStore.upsertToken`;
denying leaves the token untracked. Like `wallet_requestAccounts`, this uses the queue-and-pending
model rather than a persistent open promise: an already-tracked asset resolves `true` immediately,
otherwise the current call rejects with `approval pending` and the dapp receives `true` on a repeat
call after approval. Holding the dapp promise open across the side-panel decision within a single
service-worker lifetime is a possible future enhancement.
## Connected Sites & Site Reputation

The wallet tracks which dapp origins hold account grants and surfaces phishing
and reputation signals before a connection is approved:

- Connected-sites manager: Settings → Connected sites lists every origin with a
  persisted grant and how many accounts it can see. Revoking an origin removes
  its grants from the encrypted vault and broadcasts `accountsChanged` so the
  revoked page immediately sees an empty account list.
- Phishing blocklist: `src/security/blocklist.ts` vendors a starter blocklist of
  known-bad domains. `wallet.requestAccounts` from a blocklisted origin is
  refused with `origin blocked`. This starter list is intentionally small and
  explicit; replace or extend `BLOCKED_DOMAINS` with a real threat feed for
  production coverage.
- Lookalike heuristics: punycode detection plus digit-substitution,
  hyphen-insertion, edit-distance, and brand-substring checks against a
  protected list (`starknet.io`, `argent.xyz`, `braavos.app`, `cartridge.gg`,
  `ethereum.org`) raise warnings without blocking, so real sites are never
  denied by heuristics alone.
- Site reputation: the first time an origin requests accounts is persisted in
  `src/storage/origin-history.ts` (key `mc-wallet:origin-history`) using an
  injected clock. Approval cards show first-seen, prior-connection, risky-TLD,
  and lookalike insights prominently before the user grants access.

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
