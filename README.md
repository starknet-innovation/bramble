<div align="center">

# Bramble

### A Starknet wallet that lives in your browser side panel.

Send, sign, and connect to Starknet dapps without leaving the tab. Keys stay encrypted, multisig and NFTs come standard, and sketchy sites get flagged before you connect.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

</div>

---

## Features

- **Accounts & transfers** — choose an OpenZeppelin or Argent account backed by the encrypted software vault, with deploy/send/receive and network switching. Ledger hardware support is available to trusted testers while its physical compatibility matrix is completed.
- **Onboarding & recovery** — a dedicated full-page first-install flow for creating, importing, or connecting a Ledger; seed-phrase backup includes on-screen verification, while Ledger accounts stay keyless. An existing Ready (Argent X) Ledger account can be restored from the add-account chooser, which reads the device at Ready's derivation path.
- **dApp connect** — injects `window.starknet_bramble` (get-starknet compatible), with per-origin grants so connected sites never see each other.
- **Tokens & prices** — auto-detects ETH / STRK / USDC / USDT / DAI / WBTC, live CoinGecko prices with a 7-day sparkline, and spam-token filtering.
- **NFT gallery (parked)** — watch ERC-721 and ERC-1155 collectibles with on-chain ownership proof, then read their name, image, description, and attributes from `token_uri` / `uri`. The Collectibles tab, gallery entry points, and NFT indexer setting are hidden in the current release while the journey is finished.
- **Multisig** — create or import true Argent M-of-N account contracts, collect exact-hash signatures from local owners, and submit from the shared account.
- **STRK20 privacy** — explicitly activate private balances, shield tracked ERC-20 assets through a
  reviewed public deposit, read private note totals on demand, submit private action batches, and
  derive chain/pool-scoped viewing identities and dapp-scoped shadow-account commitments through the
  pinned official Privacy SDK. The wallet keeps an encrypted record of every shadow account a site
  drove, lists them under Settings → Shadow accounts (balances read only on request), and can sweep
  what a site left back into private notes.
- **Anti-phishing** — domain blocklist plus lookalike / punycode detection and per-origin connection history.
- **Allowance manager** — see every ERC-20 approval you've granted and revoke it in one tap. An
  approval on a contract the wallet cannot confirm is a token is listed without an amount claim and
  without a revoke control: on an NFT contract the same call would grant rather than revoke.
- **Clean Mono UI** — solid near-neutral surfaces with a single accent, purposeful spring motion, and View Transitions, with full reduced-motion support.

Runs on **Starknet mainnet** by default (Sepolia and a local devnet are also available). Mainnet moves real funds. All cryptography runs through the exact, lockfile-pinned **Krusty KMS** WASM package, and there is no local signing fallback.

## Quick start

### Prerequisites

| Tool | Version | Install | Needed for |
| --- | --- | --- | --- |
| [Bun](https://bun.sh) | 1.3.3 | [bun.sh](https://bun.sh/) | all |
| [Scarb](https://docs.swmansion.com/scarb/) | 2.18.0 **exactly** | `asdf install scarb 2.18.0` (pinned in `.tool-versions`) | Terminal contract |
| [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/getting-started/installation.html) | 0.59.0 **exactly** | `asdf install starknet-foundry 0.59.0` | Terminal contract tests |

```bash
bun install --frozen-lockfile
bun run vendor:argent     # pinned official Argent release and artifact verification
bun run vendor:privacy    # pinned official Starknet Privacy SDK browser bundle
bun run build             # -> dist/
```

Open `chrome://extensions`, turn on Developer mode, hit **Load unpacked** and pick `dist/`. A
fresh install opens the full-page setup flow; after setup, use the toolbar icon for the side panel.

### Browser targets

`bun run build:firefox` writes `dist-firefox/`, and `bun run build:all` writes both from one run of
the prerequisite gates. Load the Gecko build at `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on** → `dist-firefox/manifest.json`.

There is one manifest definition. `apps/extension/public/manifest.json` is it;
`apps/extension/firefox-manifest.ts` derives the Gecko one and refuses to guess — a top-level key
nobody has classified throws, so a manifest change forces the Firefox decision at `check:extension`
rather than at upload time. What differs, and why none of it is a matter of taste:

| | Chrome | Firefox |
| --- | --- | --- |
| Background | service worker | event page (Gecko has no extension service worker) |
| Wallet panel | `side_panel` | `sidebar_action` (Gecko has no `sidePanel` API) |
| Collectible renderer | sandboxed page | **not shipped** |
| Ledger | supported | **not supported** |

Firefox is supported from **140**, the current ESR — so both ESR lines, the release channel, and the
forks that track either. 140 is also the first release that understands the
`data_collection_permissions` this manifest declares, so it is the lowest honest floor rather than
merely a cautious one.

The floor and the collectible renderer are **one decision**. That page executes untrusted on-chain
HTML and is only safe inside a manifest-declared sandbox, which Firefox gained in 154 — so it is
withheld from the Gecko package rather than shipped where the manifest cannot sandbox it. Nothing is
lost today: the collectibles journey is parked and no view can reach the gallery. Un-parking it means
raising this floor back to 154 and excluding ESR again.

**Ledger is not supported on Firefox.** Gecko implements no WebHID, WebUSB or Web Bluetooth, so no
hardware transport exists.

**Arc never shows the side panel.** It accepts `sidePanel.open` and draws nothing (#690). On Arc,
open the wallet from the extension's details page (**Extension options** opens it in a tab), then
choose **Settings → Request display → Compact popup**. The toolbar button and site requests then
open the popup.

One security difference is worth stating plainly: Firefox implements no `storage.setAccessLevel`, so
`storage.local` and `storage.sync` stay reachable from this extension's own content script and
cannot be closed off. The encrypted vault stays unreadable without the unlock credential, but the
rollback-freshness markers are reachable. See `apps/extension/src/browser-storage.ts`.

Day to day:

```bash
bun run check       # types, lint, standards, unit tests
bun run format      # Biome autofix
bun run test:e2e    # Playwright end-to-end (run test:e2e:install once first)
BRAMBLE_E2E_LIVE_NETWORK=1 bun run dev:session # explicit live-network manual session
```

`dev:session` is development-only and refuses to start without the explicit live-network flag shown
above. It onboards from a recovery phrase published in this repository, so its accounts are public
by construction — never send real funds to an address it shows, and read the header of
`tests/e2e/dev-session.ts` before pointing `BRAMBLE_DEV_MNEMONIC` at a phrase of your own. The wallet it
creates is kept in a git-ignored `.dev-profile/`; delete that directory to start over.

### Offline checks

After `bun install --frozen-lockfile`, the fast PR gates below need only Bun and the checked-out
repository. They do not clone Argent, build the extension, or
launch Chromium:

```bash
bun run check:types && bun run check:lint && bun run check:files && bun run check:imports && bun run check:cycles && bun run check:extension && bun test ./tests && bun run check:coverage
```

The full `bun run check` additionally verifies the published Krusty package, official Argent
release, and Privacy SDK outputs. `bun install --frozen-lockfile` installs Krusty; generate the
remaining outputs with `bun run vendor:argent` (network) and `bun run vendor:privacy` (Node.js 24 +
npm). `build`, packaging, and browser E2E also require the Argent and Privacy outputs; Playwright
needs its Chromium install once per machine.

## Upgrading

Upgrades are one-way. Once you unlock a newer version, an older build can't open your wallet: it
refuses the newer vault and settings. An older build can also delete recent activity history it
doesn't recognize.

If you installed an older build by mistake:

- **Install the newer version again, over the old one.** Your wallet opens as before. Don't remove
  Bramble first: removing the extension deletes the wallet from this browser.
- **Or restore from your recovery phrase.** Anything not derived from the phrase has to be added
  again: imported keys and phrases, Ledger accounts, site connections and settings.

## Built with

Bun · TypeScript · [starknet.js](https://github.com/starknet-io/starknet.js) · [Starknet Privacy SDK](https://github.com/starkware-libs/starknet-privacy) · Biome · Krusty KMS (WASM) · Ledger hardware preview · Chrome Manifest V3 side panel. No framework and no bundler magic, just a custom `Bun.build` step.

## Architecture

The extension is a private-workspace modular monolith. Package direction is deny-by-default, so
page code cannot reach signing or vault operations:

```
apps/extension              MV3 pages, entrypoints, browser adapters, privileged orchestration
apps/terminal               standalone trade terminal; connects as a dapp
apps/ui-lab                 Storybook workbench for production wallet UI
apps/website                public site for docs, support, and privacy
packages/foundation         pure values, validators, and wallet/provider protocol
packages/platform           store, encrypted vault, Krusty, Starknet, and Ledger adapters
packages/features           permissions, portfolio, transactions, multisig, privacy, settings
packages/presentation       UI Kit and production wallet UI shared with UI Lab
packages/testing/testkit    deterministic test doubles excluded from production bundles
```

`apps/extension/src/background` remains the sole privileged authority and composition root for
approvals, unlock sessions, Ledger signature verification, and vault wiring. Page-facing code can
access only the validated provider protocol. The package graph and its enforced invariants are in
[docs/MODULAR_ARCHITECTURE.md](docs/MODULAR_ARCHITECTURE.md); the runtime trust-boundary tour is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

- **[Documentation portal](docs/index.md)** — host-ready project and security-audit documentation.
- **[User guide](docs/USER-GUIDE.md)** — install, first run, backup, and everyday use.
- **[Engineering](docs/ENGINEERING.md)** — reading order, import layers, and the untrusted-message path.
- **[Development](DEVELOPMENT.md)** — release branches, where pull requests go, and which CI runs.
- **[Architecture & internals](docs/ARCHITECTURE.md)** — the provider API, Ledger trust boundary, pinned class hashes, storage migrations, design system, and full tour.
- **[Modular architecture](docs/MODULAR_ARCHITECTURE.md)** — package ownership, dependency direction, typed invariants, and local package workflows.
- **[Wallet store architecture](docs/WALLET_STORE.md)** — persistence layout, account scoping, Chrome update migrations, and Ledger viewing-key custody.
- **[Operations](docs/OPERATIONS.md)** — gateway monitoring, support diagnostics, and incident response.
- **[STRK20 privacy](docs/STRK20_PRIVACY.md)** — pinned Privacy SDK, privileged data flow, and failure boundaries.
- **[Security audit](docs/security-audit/index.md)** — baseline, threat model, review sequence, and sanitized findings ledger.
- **[Source package audit](docs/security-audit/src-package-audit.md)** — package-by-package controls, resolved findings, and validation evidence.
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Releasing](RELEASING.md)** · **[Building from source](BUILDING.md)** · **[Code of Conduct](CODE_OF_CONDUCT.md)**

## License

[MIT](LICENSE)
