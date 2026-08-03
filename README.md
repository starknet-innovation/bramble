<div align="center">

# MC Wallet

### A Starknet wallet that lives in your browser side panel.

Send, sign, and connect to Starknet dapps without leaving the tab. Keys stay encrypted, multisig and NFTs come standard, and sketchy sites get flagged before you connect.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

</div>

---

## Features

- **Accounts & transfers** — OpenZeppelin accounts backed by either the encrypted software vault or a Ledger hardware wallet, with deploy/send/receive and network switching.
- **Onboarding & recovery** — a dedicated full-page first-install flow for creating, importing, or connecting a Ledger; seed-phrase backup includes on-screen verification, while Ledger accounts stay keyless.
- **dApp connect** — injects `window.starknet_mcWallet` (get-starknet compatible), with per-origin grants so connected sites never see each other.
- **Tokens & prices** — auto-detects ETH / STRK / USDC / USDT / DAI / WBTC, live CoinGecko prices with a 7-day sparkline, and spam-token filtering.
- **NFT gallery** — watch ERC-721 and ERC-1155 collectibles with on-chain ownership proof, then read their name, image, description, and attributes from `token_uri` / `uri`.
- **Multisig** — watch, propose, confirm, and execute on OpenZeppelin multisig accounts.
- **Anti-phishing** — domain blocklist plus lookalike / punycode detection and per-origin connection history.
- **Allowance manager** — see every ERC-20 approval you've granted and revoke it in one tap.
- **Liquid Glass UI** — Apple-style glass surfaces, spring motion, and View Transitions, with full reduced-motion support.

Runs on **Starknet mainnet** by default (Sepolia and a local devnet are also available). Mainnet moves real funds. All cryptography runs through the vendored **Krusty KMS** WASM core, and there is no local signing fallback.

## Quick start

### Prerequisites

| Tool | Version | Install | Needed for |
| --- | --- | --- | --- |
| [Bun](https://bun.sh) | 1.3.3 | [bun.sh](https://bun.sh/) | all |
| Rust (stable) | 1.96+ | [rustup](https://rustup.rs) | `vendor:krusty` |
| [wasm-pack](https://github.com/rustwasm/wasm-pack) | 0.13.1 | `cargo install wasm-pack --locked --version 0.13.1` | `vendor:krusty` |
| [Scarb](https://docs.swmansion.com/scarb/) | 2.18.0 **exactly** | `asdf install scarb 2.18.0` (pinned in `.tool-versions`) | `vendor:multisig` |

```bash
bun install --frozen-lockfile
bun run vendor:krusty     # Krusty KMS crypto core (WASM) — needs Rust + wasm-pack
bun run vendor:multisig   # pinned multisig contract artifacts — needs Scarb 2.18.0 exactly
bun run build             # -> dist/
```

Open `chrome://extensions`, turn on Developer mode, hit **Load unpacked** and pick `dist/`. A
fresh install opens the full-page setup flow; after setup, use the toolbar icon for the side panel.

Day to day:

```bash
bun run check     # types, lint, standards, unit tests
bun run format    # Biome autofix
bun run test:e2e  # Playwright end-to-end (run test:e2e:install once first)
```

### Offline checks

After `bun install --frozen-lockfile`, the fast PR gates below need only Bun and the checked-out
repository. They do not clone Krusty, invoke Rust/wasm-pack or Scarb, build the extension, or
launch Chromium:

```bash
bun run check:types && bun run check:lint && bun run check:files && bun run check:imports && bun run check:cycles && bun run check:extension && bun test ./tests && bun run check:coverage
```

The full `bun run check` additionally verifies the vendored Krusty and multisig outputs. Generate
those first with `bun run vendor:krusty` (network, Rust, and `wasm-pack 0.13.1`) and
`bun run vendor:multisig` (`scarb 2.18.0`). `build`, packaging, and browser E2E also require those
vendored outputs; Playwright needs its Chromium install once per machine.

## Built with

Bun · TypeScript · [starknet.js](https://github.com/starknet-io/starknet.js) · Biome · Krusty KMS (WASM) · Ledger Web Bluetooth/WebUSB/WebHID · Chrome Manifest V3 side panel. No framework and no bundler magic, just a custom `Bun.build` step.

## Architecture

The extension is split by trust boundary, so page code can never reach signing or vault operations:

```
src/background              privileged state, approvals, unlock sessions, vault service
src/content + src/provider  page <-> background bridge (signing never exposed to pages)
src/storage                encrypted persistence, permissions, schema migrations
src/crypto                 Krusty KMS boundary (validates every WASM input/output)
src/starknet               RPC, networks, token registry, prices
src/security               phishing blocklist and lookalike heuristics
src/sidepanel + src/ui      full-page onboarding, side-panel app, Ledger boundary, and design system
contracts/multisig         the pinned OpenZeppelin multisig shell (Cairo)
```

`src/background` owns privileged state, approvals, unlock sessions, Ledger signature verification,
and vault wiring. Page-facing code cannot access signing or storage directly. The full trust-boundary
tour, provider API, design system, schema-migration workflow, and reproducible-build details live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

- **[Documentation portal](docs/index.md)** — host-ready project and security-audit documentation.
- **[Architecture & internals](docs/ARCHITECTURE.md)** — the provider API, Ledger trust boundary, pinned class hashes, storage migrations, design system, and full tour.
- **[Security audit](docs/security-audit/index.md)** — baseline, threat model, review sequence, and sanitized findings ledger.
- **[Source package audit](docs/security-audit/src-package-audit.md)** — package-by-package controls, resolved findings, and validation evidence.
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Releasing](RELEASING.md)** · **[Code of Conduct](CODE_OF_CONDUCT.md)**

## License

[MIT](LICENSE)
