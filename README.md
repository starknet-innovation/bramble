<div align="center">

# MC Wallet

### A Starknet wallet that lives in your browser side panel.

Send, sign, and connect to Starknet dapps without leaving the tab. Keys stay encrypted, multisig and NFTs come standard, and sketchy sites get flagged before you connect.

![Starknet](https://img.shields.io/badge/Starknet-10.0.2-EC796B?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.3.3-fbf0df?style=for-the-badge&logo=bun&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-2.5.3-60A5FA?style=for-the-badge&logo=biome&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-0.3.0-3ba55d?style=for-the-badge)

</div>

---

## Features

- **Accounts & transfers** — OpenZeppelin accounts, seed-phrase backup with on-screen verification, derive more accounts, reveal keys behind re-auth.
- **dApp connect** — injects `window.starknet_mcWallet` (get-starknet compatible), with per-origin grants so connected sites never see each other.
- **Tokens & prices** — auto-detects ETH / STRK / USDC / USDT / DAI / WBTC, live CoinGecko prices with a 7-day sparkline, and spam-token filtering.
- **NFT gallery** — watch collectibles with on-chain ownership proof before they're stored.
- **Multisig** — watch, propose, confirm, and execute on OpenZeppelin multisig accounts.
- **Anti-phishing** — domain blocklist plus lookalike / punycode detection and per-origin connection history.
- **Allowance manager** — see every ERC-20 approval you've granted and revoke it in one tap.
- **Liquid Glass UI** — Apple-style glass surfaces, spring motion, and View Transitions, with full reduced-motion support.

Runs on **Starknet mainnet** by default (Sepolia and a local devnet are also available). Mainnet moves real funds. All cryptography runs through the vendored **Krusty KMS** WASM core, and there is no local signing fallback.

## Quick start

```bash
bun install
bun run vendor:krusty     # Krusty KMS crypto core (WASM)
bun run vendor:multisig   # pinned multisig contract artifacts
bun run build             # -> dist/
```

Open `chrome://extensions`, turn on Developer mode, hit **Load unpacked** and pick `dist/`, then click the toolbar icon to pop open the side panel.

Day to day:

```bash
bun run check     # types, lint, standards, unit tests
bun run format    # Biome autofix
bun run test:e2e  # Playwright end-to-end (run test:e2e:install once first)
```

## Built with

Bun · TypeScript · [starknet.js](https://github.com/starknet-io/starknet.js) · Biome · Krusty KMS (WASM) · Chrome Manifest V3 side panel. No framework and no bundler magic, just a custom `Bun.build` step.

## Architecture

The extension is split by trust boundary, so page code can never reach signing or vault operations:

```
src/background              privileged state, approvals, unlock sessions, vault service
src/content + src/provider  page <-> background bridge (signing never exposed to pages)
src/storage                encrypted persistence, permissions, schema migrations
src/crypto                 Krusty KMS boundary (validates every WASM input/output)
src/starknet               RPC, networks, token registry, prices
src/security               phishing blocklist and lookalike heuristics
src/sidepanel + src/ui      the side-panel app and its design system
contracts/multisig         the pinned OpenZeppelin multisig shell (Cairo)
```

`src/background` owns privileged state, approvals, unlock sessions, and vault wiring; `src/content` and `src/provider` bridge page requests to the background without exposing signing or the vault; `src/storage` owns encrypted persistence, permission checks, schema validation, and migrations; `src/crypto` adapts Krusty KMS and rejects invalid inputs or WASM outputs at the boundary. The full tour — provider API, pinned account/multisig class hashes, and internals — lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Krusty KMS

All wallet cryptography runs through the vendored **Krusty KMS** WASM core — there is no local signing, key-derivation, or mnemonic-validation fallback, so if the core is unavailable the wallet fails closed. Vendor it once before any check or build:

```bash
bun run vendor:krusty     # checks out the commit pinned in scripts/vendor-krusty.ts, wasm-pack builds it
```

The build copies the vendored runtime files from `vendor/krusty-kms/crates/wasm/pkg` into `dist/vendor/krusty-kms/pkg`; `bun run check:krusty` verifies the pin.

## Design System

Side-panel styling is layered so each axis lives in one place:

- **Colors** — `Skin` tokens in `src/ui/skin.ts`; swap `defaultSkin` in `src/sidepanel/index.ts` to re-theme (`applySkin` rejects missing, extra, or hidden tokens).
- **Scales** — spacing, radius, type, control metrics, `EASE` curves, and named `SPRING` presets in `src/ui/tokens.ts`.
- **Motion** — `src/ui/spring.ts` turns a spring preset into a CSP-safe CSS/WAAPI `linear()` easing; `src/sidepanel/motion.ts` provides `prefersReducedMotion()`, an interruptible `animate()`/`spring()` wrapper, and drag-dismiss momentum.
- **Material** — opt a surface into Apple-style Liquid Glass with `class="glass"`; it degrades to a solid panel where `backdrop-filter` is unsupported and frosts near-solid under `prefers-reduced-transparency`.

Screen changes run through the View Transitions API and collapse to an instant cut under `prefers-reduced-motion`. `tests/sidepanel-styles.test.ts` and `tests/motion.test.ts` enforce these rules.

## Migration Workflow

The vault schema is versioned (`CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`) and currently at **v2** — v2 adds a `mnemonic: string | null` field so the wallet can derive more accounts and reveal the recovery phrase after re-auth. To change the stored shape:

1. Bump `CURRENT_SCHEMA_VERSION` in `src/storage/vault-schema.ts`.
2. Add exactly one adjacent step to `VAULT_MIGRATIONS` in `src/storage/migrations.ts`.
3. Update the schema validators and add tests for old, current, and invalid vault data.
4. Run `bun run check`, `bun run build`, and `bun run package:extension`.

Each step advances exactly one version (`v0 → v1 → v2`) and must be deterministic; `mnemonic` only ever exists inside the encrypted vault envelope.

## Extension

Load `dist/` as an unpacked extension after `bun run build`, then click the toolbar action to open the Chrome side-panel wallet. Package a release with:

```bash
bun run package:extension   # writes artifacts/*.zip + artifacts/*.zip.sha256
```

CI uploads those same files as the `mc-wallet-extension` workflow artifact. Cutting a release and submitting to the Chrome Web Store is documented in [RELEASING.md](RELEASING.md).

## Docs

- **[Documentation portal](docs/index.md)** — host-ready project and security-audit documentation.
- **[Architecture & internals](docs/ARCHITECTURE.md)** — the provider API, pinned class hashes, storage migrations, design system, and full tour.
- **[Security audit](docs/security-audit/index.md)** — baseline, threat model, review sequence, and sanitized findings ledger.
- **[Source package audit](docs/security-audit/src-package-audit.md)** — package-by-package controls, resolved findings, and validation evidence.
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Releasing](RELEASING.md)** · **[Code of Conduct](CODE_OF_CONDUCT.md)**

## License

[MIT](LICENSE)
