<div align="center">

# 🔷 MC Wallet

### A Starknet wallet that lives in your browser side panel.

Send, sign, and connect to Starknet dapps without leaving the tab. Keys stay encrypted, multisig and NFTs come standard, and sketchy sites get flagged before you connect.

![Starknet](https://img.shields.io/badge/Starknet-10.0.2-EC796B?style=for-the-badge)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.3.3-fbf0df?style=for-the-badge&logo=bun&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-2.5.3-60A5FA?style=for-the-badge&logo=biome&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-0.2.0-3ba55d?style=for-the-badge)

</div>

---

## ✨ Features

- 💸 **Accounts & transfers** — OpenZeppelin accounts, seed-phrase backup with on-screen verification, derive more accounts, reveal keys behind re-auth.
- 🔌 **dApp connect** — injects `window.starknet_mcWallet` (get-starknet compatible), with per-origin grants so connected sites never see each other.
- 🪙 **Tokens & prices** — auto-detects ETH / STRK / USDC / USDT / DAI / WBTC, live CoinGecko prices with a 7-day sparkline, and spam-token filtering.
- 🖼️ **NFT gallery** — watch collectibles with on-chain ownership proof before they're stored.
- 🤝 **Multisig** — watch, propose, confirm, and execute on OpenZeppelin multisig accounts.
- 🛡️ **Anti-phishing** — domain blocklist plus lookalike / punycode detection and per-origin connection history.
- 🎛️ **Allowance manager** — see every ERC-20 approval you've granted and revoke it in one tap.
- 🎨 **Liquid Glass UI** — Apple-style glass surfaces, spring motion, and View Transitions, with full reduced-motion support.

Runs on **Starknet mainnet** by default (Sepolia and a local devnet are also available). Mainnet moves real funds. All cryptography runs through the vendored **Krusty KMS** WASM core, and there is no local signing fallback.

## 🚀 Quick start

```bash
bun install
bun run vendor:krusty     # Krusty KMS crypto core (WASM)
bun run vendor:multisig   # pinned multisig contract artifacts
bun run build             # → dist/
```

Open `chrome://extensions`, turn on Developer mode, hit **Load unpacked** and pick `dist/`, then click the toolbar icon to pop open the side panel.

Day to day:

```bash
bun run check     # types · lint · standards · unit tests
bun run format    # Biome autofix
bun run test:e2e  # Playwright end-to-end (run test:e2e:install once first)
```

## 🧱 Built with

Bun · TypeScript · [starknet.js](https://github.com/starknet-io/starknet.js) · Biome · Krusty KMS (WASM) · Chrome Manifest V3 side panel. No framework and no bundler magic, just a custom `Bun.build` step.

## 🗺️ Layout

```
src/background              privileged state, approvals, unlock sessions, vault service
src/content + src/provider  page ⇄ background bridge (signing never exposed to pages)
src/storage                encrypted persistence, permissions, schema migrations
src/crypto                 Krusty KMS boundary
src/starknet               RPC, networks, token registry, prices
src/sidepanel + src/ui      the side-panel app and its design system
contracts/multisig         the pinned OpenZeppelin multisig shell (Cairo)
```

## 📚 Docs

- **[Architecture & internals](docs/ARCHITECTURE.md)** — the provider API, pinned class hashes, storage migrations, design system, and full tour.
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Releasing](RELEASING.md)** · **[Code of Conduct](CODE_OF_CONDUCT.md)**

## 📄 License

[MIT](LICENSE)
