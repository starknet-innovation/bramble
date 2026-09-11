# Changelog archive

Release notes before v0.7.2 are archived here. Current release notes remain in
[CHANGELOG.md](CHANGELOG.md).

## [0.7.1] - 2026-07-27

Live Starknet portfolio data, a production trading terminal, and faster wallet
state convergence after unlock and transactions, with reliable Ledger transport
ownership and an inspectable wallet interaction-design lab.

### Added
- A dedicated full-page first-install onboarding tab for creating, importing,
  or connecting a Ledger, with a side-panel fallback link and explicit handoff
  into the normal wallet surface after setup.
- An isolated Storybook HTML UI Lab with 100 deterministic checkpoints across
  14 scenario families, exact onboarding-tab/side-panel/popup presets,
  production templates and motion, fixture-only RPC behavior, direct state
  links, playback controls, evidence logs, and local review notes.
- Repository-hosted, access-controlled GitHub Pages delivery for the static UI
  Lab, plus conditional Chromatic publishing for PR-linked visual review.
- A validated ordinary-tab Ledger transport broker supporting explicit USB and
  Bluetooth device choice, retained sessions, lifecycle recovery, timeouts, and
  actionable support diagnostics.
- A strictly validated Starkscan read boundary for address summaries,
  transactions, activity, token transfers, holdings and balances, contract
  metadata, events, and blocks on indexed Starknet networks.
- Starkscan-preferred wallet balances and transaction history, with incomplete
  index snapshots rejected and existing RPC reads retained as the safe fallback.
- A persistent production trading terminal with connected-wallet positions,
  activity and follows, live token and perps markets, swap and lending actions,
  Starknet activity streaming, and a wallet toolbar shortcut.

### Changed
- Send and Ledger-signing progress now use explicit authorization, submission,
  confirmation, success, and failure states with smoother transitions and
  visible liveness throughout the transaction.
- Activity snapshots are partitioned by network and account, and stale rows are
  cleared immediately during scope switches so state cannot bleed between
  wallets.
- Storybook navigation is organized into numbered user journeys from onboarding
  through security settings, with cross-cutting runtime contracts kept
  separately reviewable.
- Wallet refreshes now converge sooner after unlock and submitted actions while
  retaining account-scoped stale-result guards.
- Terminal token prices, daily changes, chart history, trade fills, portfolio
  totals, and protocol positions now come from validated live data sources.
- Token artwork is served from local high-resolution AVNU and Extended asset
  catalogs across Tokens, Perps, Discover, and portfolio surfaces.

### Fixed
- Ledger connection no longer depends on Chrome exposing a chooser inside the
  side panel; permission and live transport ownership remain in the ordinary
  extension tab while the side panel communicates through a bounded broker.
- Full-page onboarding completion no longer falls through into an expanded
  dashboard; it stops background hydration and gives the user a deliberate
  side-panel handoff.
- Stablecoin supply changes are no longer presented as daily price moves.
- Non-ETH token charts, spot trade tapes, swap token selection, and utilization
  curve inspection now behave consistently across supported assets.
- Starknet Live now interleaves activity smoothly and restores at least twenty
  cached rows instead of visibly repopulating from an empty feed.

### Security
- Ledger accounts remain mnemonic-less, broker session identifiers and messages
  are validated and ephemeral, raw device events are not logged, and every
  signing path retains device/key verification before broadcast.
- The UI Lab has no production RPC, vault, hardware transport, recovery
  material, or signing capability; production view coverage fails when a new
  wallet view lacks a deterministic scenario.
- Every consumed Starkscan response is parsed at the trust boundary with
  bounded pages and response sizes; malformed or incomplete indexed data fails
  closed to the wallet's existing RPC path.
- The wallet requests only the fixed Starkscan HTTPS host permission and keeps
  external terminal navigation pinned to the reviewed production origin.

## [0.7.0] - 2026-07-24

NFT interoperability, deliberate transfer review, faster collectible hydration,
and clearer dapp approval hand-offs.

### Added
- Mainnet-ready ERC-721 and ERC-1155 ownership detection, transfers, and
  metadata resolution across Starknet naming conventions. The wallet decodes
  Cairo `ByteArray` token URIs, inline JSON and IPFS/HTTPS metadata, collection
  names, descriptions, images, and bounded attributes.
- A two-step NFT send flow with recipient validation, decoded call summary,
  address-poisoning warnings, deployment state, fee estimation, explicit
  confirmation, and retryable failure states before any signature or broadcast.
- A user-selectable dapp approval surface: requests can open in the side panel
  or toolbar popup, with popup failure falling back safely to the side panel.
- A companion mainnet MC Punks interoperability collection and mint-only NFT
  Studio in the terminal test app. The deployed test collection is
  `0xda8b762dcb301e6b144e521ede1e2870ce9c723e5b4e6856c870ad341098a9`.

### Changed
- Collectibles now use gallery-scale artwork, a larger detail hero, structured
  attributes, resilient broken-image placeholders, and eager loading for the
  first solicited items rather than tiny thumbnails.
- Unlock and resync prioritize explicitly watched collectible artwork ahead of
  slower portfolio and indexer work, coalesce duplicate loads, and discard
  stale account-scoped results after account or network changes.
- Terminal wallet requests now show a focused review dialog with route,
  network, calldata summary, wallet hand-off, submitted hash, retry, and
  accessible keyboard/focus behavior.
- The unit suite is organized by source boundary, and privileged GitHub
  workflows now isolate untrusted source execution from release authority
  ([#158](https://github.com/starknet-innovation/mc-wallet/pull/158),
  [#160](https://github.com/starknet-innovation/mc-wallet/pull/160)).

### Fixed
- “Add NFT” no longer assumes one `owner_of` ABI shape. Contracts exposing
  `ownerOf`, ERC-1155 balance reads, `tokenURI`, `token_uri`, or `uri` now
  resolve through validated fallbacks, including large decimal token IDs.
- NFT metadata and artwork now survive explorer/indexer gaps by resolving
  explicitly watched tokens directly from the contract while preserving
  on-chain ownership proof.
- NFT sends no longer broadcast immediately from the detail form; the reviewed
  recipient and call must match the separately confirmed submission.
- Gallery add/hide/spam/remove and send-review failures restore actionable UI
  state instead of leaving controls wedged.

### Security
- Indexer ownership claims are never trusted: discovered, added, reviewed, and
  submitted collectibles are re-proven on-chain, with bounded RPC concurrency.
- Unsolicited airdrops do not trigger attacker-controlled metadata or image
  requests during background discovery or gallery paint. Remote metadata is
  public-HTTPS only, size-capped, credentialless, no-referrer, redirect-rejected,
  and blocked from private/local hosts.
- Review and submit share the same NFT call-preparation boundary; recipient
  poisoning is a submission-blocking check, and all malformed metadata degrades
  to an empty display rather than crossing into HTML unsanitized.
- The coverage gate remains enforced at 95%; focused NFT success, malformed
  input, fee retry, wallet failure, and control-recovery tests close the release
  regression without lowering the threshold.

## [0.6.0] - 2026-07-23

Phase 6 security work plus release-hygiene and audit closeout.

### Added
- First-class Ledger hardware-wallet accounts, including Ledger-only onboarding,
  adding multiple derived accounts, device-confirmed deploy/send/dapp/typed-data
  and multisig signing, and a keyless v3 vault migration that never stores a
  Ledger mnemonic or signing key (#134, #135).
- Origin-scoped WebHID permission grant through a short-lived extension popup,
  with timeout/closed-window recovery and explicit selection when more than one
  granted Ledger is available (#134).
- A host-ready v0.6 security-audit route recording the reviewed Ledger and
  multisig boundaries, resolved findings, validation evidence, and residual
  third-party risk.

### Changed
- Ledger signing now verifies the expected device and returned signature before
  every broadcast, fails closed on lock or disconnect, scopes the Buffer
  compatibility layer to the Ledger boundary, and makes partial multi-account
  onboarding safely retryable (#134).
- Multisig declare/deploy operations now use durable atomic claims, preserve an
  accepted transaction hash across local persistence failures, and do not
  downgrade pending state when local activity reads fail (#126, #127, #131).
- Multisig list/detail views refresh on entry, distinguish RPC/storage failures
  from a real empty result, scope signer confirmation state to the active
  account, and reject locally impossible actions before a round trip
  (#128–#130).
- PR guards fail closed for unknown or feature-like branch prefixes, GitHub
  Actions are pinned to their current majors, and the Bun/TypeScript/Biome test
  toolchain and lockfile are refreshed (#136, #143–#145).

### Fixed
- Added focused side-panel multisig client, response-guard, hydration, and UI
  regression coverage; corrected the stale multisig artifact comment
  (#132, #133).
- The terminal-app lockfile and Vite toolchain now remain reproducible under the
  repository dependency updates (#125).

## [0.5.0] - 2026-07-16

Phase 5 (hardening, audit & public release — roadmap #83).

### Added
- In-wallet swaps via the AVNU aggregator: a Swap action between Send and
  Receive opens a full quote → confirm → execute → receipt flow with live
  debounced quoting, a searchable verified-token picker (untracked picks are
  added through the on-chain token flow), value-sanity tiers that warn on
  bad routes, and an approve-only-sell-token policy gate before signing (#115).
- Proactive dapp requests: a pending approval takes over the panel's dock
  views with its full decision card the moment it arrives, with a "Not now"
  snooze that parks it in Activity (#115).
- Real on-chain history merged into the activity feed, with per-leg transfer
  dedup and an explicit flag when only device records are available (#111).
- On-chain verification of the active account's OZ class hash, surfaced as a
  verification badge on the account screen (#110).
- Import a standalone account from a raw Starknet private key, stored only in
  the encrypted vault (#112).
- Automated release-on-merge: promoting a `release/*` or `hotfix/*` branch to
  `main` now cuts the tagged GitHub Release automatically, with the version
  derived from the merged branch (issue #59, #60).

### Changed
- Full design-system overhaul: cobalt accent with market semantics split from
  brand, an anchored bottom dock, de-bordered grouped lists and receipt rows,
  a restructured settings hub and sub-screens, WCAG AA contrast enforced by
  test, redesigned toasts with tone chips, and a choreographed swap success
  moment that returns home on its own (#115).
- Send review and dApp approval prompts now share one decode/risk pipeline,
  so both surfaces flag identical calls identically (#109).
- The release version is single-sourced from `package.json`; the tag, artifact,
  and changelog all derive from it and a gate fails the release on any drift
  (closes the gap that shipped `v0.4.0` as `mc-wallet-0.3.0.zip`).

## [0.4.0] - 2026-06-30

### Added
- First release under the roadmap-driven release-branch model (milestone `v0.4`,
  Phase 3 — table-stakes parity).

## [0.3.0] - 2026-05-19

### Added
- Baseline wallet shell established as the initial stable version on `main`.
