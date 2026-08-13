# Changelog archive

Release notes before v0.7.0 are archived here. Current release notes remain in
[CHANGELOG.md](CHANGELOG.md).

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
