# Changelog

All notable changes to MC Wallet are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. Older entries are kept in [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md).
See DEVELOPMENT.md and RELEASING.md.

## [0.9.1] - 2026-08-12

Response to the 31 findings raised by the post-release deep adversarial audit of
v0.9.0 (`MCW-V09-101`..`131`). No third-party dependency changes. Full detail,
including the residual on the partially remediated `MCW-V09-127`, is in
`docs/security-audit/releases/v0.9-deep.md`.

### Security
- SNIP-12 signing no longer accepts a type graph whose names can reassemble
  `encodeType` into a different graph. A name carrying a separator let two
  structures produce one message hash, so a site could obtain a signature over
  an opaque payload that is valid against a structured order. Each revision is
  now validated against its own vocabulary under a deny-by-default name grammar
  (`MCW-V09-101`, High).
- Multisig proposal ids are derived locally from the reviewed
  `(to, selector, calldata, salt)` rather than taken from a node's
  `hash_transaction` answer, which is now only a cross-check that must agree.
  Stored proposals re-derive their id before confirm, revoke, and execute, so a
  record written by an earlier version cannot be acted on if its id came from a
  hostile answer (`MCW-V09-102`, High).
- Inactivity auto-lock is alarm-driven and now fires in normal use.
- Balances and history come from the configured Starknet RPC first; the explorer
  gateway is a per-network opt-in, off by default once an RPC override is set.
- The approval surface consults the phishing blocklist before opening and takes
  a 1000 ms per-tab cooldown.
- Every wallet-initiated fee-bearing action now estimates and displays the
  maximum network fee before signing, then binds the transaction to that
  reviewed ceiling. An estimate failure refuses signing.
- Removed `wallet.signHash` (an unapproved arbitrary-hash signing path with no
  production caller) and `wallet.grantOrigin`. Neither was dapp-reachable.
- Malformed successful RPC broadcast responses now retain indeterminate-write
  semantics, and multisig claims survive an indeterminate broadcast so a lost
  response cannot reopen blind duplicate signing.
- Declare approval binds the exact displayed declaration-plus-deployment total,
  supports fail-closed fee retries, and enforces each component at submission;
  duplicate multisig proposals and externally revoked confirmations are
  reconciled through the durable claim ledger.
- The Chromatic token is scoped only to its main-branch publish step.

### Changed
- SNIP-12 revision 0 remains signable and a numeric `revision: 1` is accepted.
  Revision 0 is held to what its encoder resolves: preset field types, `enum`
  fields, and tuple types are refused there, because the pinned library cannot
  encode them. Preset *names* may now be declared as ordinary structs on
  revision 0, a widening for legacy dapps.
- A `merkletree` leaf must name a declared struct or preset on **both**
  revisions; `contains: "felt"` is refused, because a raw-felt leaf is the value
  the site supplied and could stand in for another structure's hash under the
  same root. Dapps hashing their own allowlist or session leaves must declare
  the leaf struct.
- STRK20 sub-account commitments are separated by verified origin rather than a
  caller-chosen label, so a site holding a commitment for a label sees a
  different one.
- Restoring a preferences backup applies only labels, groups, display, theme,
  hidden tokens, and active network. Every trust-bearing field the review layer
  reads as ground truth is ignored: RPC overrides, custom networks, token
  metadata, NFT indexer, STRK20 network and prover endpoints, approval surface,
  and explorer fallback. Address-book contacts are left untouched in both
  directions, being the reference set behind the address-poisoning guard.
- The sign-request card renders domain rows by the payload's actual revision;
  rows that were never in the hash no longer appear as signed.

## [Unreleased]

### Added
- Recovery-phrase import now flags unknown BIP39 words, offers prefix completions
  while typing, and runs Krusty mnemonic validation on Continue before the vault
  passphrase step.
- New software and Ledger accounts can use the official Argent or OpenZeppelin
  account contract. Private-key import can attach an existing Argent Account 0.4
  only when that key is its pinned Stark owner, no guardian is configured, and
  the exact deployment salt is supplied.

### Changed
- Multisig creation, signing, and submission now use the official Argent
  Multisig 0.2 implementation. The former OpenZeppelin-based proposal
  flow is removed; references in older release entries describe those releases'
  historical behavior.

## [0.9.0] - 2026-08-10

Account-safe upgrades, one coherent public/private Send journey, managed service
routing, and stricter Ledger and STRK20 trust boundaries ahead of the wallet's
first formal external audit.

### Added
- A unified Send route model for public-to-public transfers, shielding into a
  private balance, private transfers, and unshielding. Each route identifies its
  submission path, fee source, and on-chain disclosure before review.
- Account- and network-scoped encrypted custody for optional Ledger STRK20
  viewing material. Software-account viewing keys remain derivable through
  Krusty and are not retained.
- Staged, authenticated, crash-recoverable vault schema v4 migration with
  verified writes and deterministic recovery from interrupted extension updates.
- Ledger OS and Starknet-app compatibility probes with model-specific firmware
  floors, bounded response parsing, upgrade guidance, and exact-device reconnect.

### Changed
- Default Starknet RPC and bundled STRK20 traffic now route through the managed
  MC Wallet gateway, with reviewed direct RPC fallbacks retained for transport
  availability and custom user routing preserved.
- Public and private balances share one portfolio and asset vocabulary. Shield
  and Unshield open Send preconfigured instead of maintaining parallel transfer
  interfaces.
- Active-account and active-network mutations are serialized behind one
  generation-aware authority so concurrent unlock, import, Ledger, dApp, and
  preference operations cannot create split-brain state.
- Browser storage is restricted to trusted extension contexts before startup,
  session restoration, alarms, or runtime request handling continue.

### Fixed
- Private relay quotes no longer introduce a public sender fee approval or leave
  unrelated allowance behind; mixed batches retain only exact public deposit
  approval.
- Account-mode transaction preparation failures remain retry-safe, while an
  indeterminate response after an add-transaction request retains the durable
  one-broadcast guard instead of risking duplicate submission.
- Structured sequencer errors keep their numeric semantics even when hostile
  revert text contains transport-like phrases.
- Send review now fails closed on unknown account-scoped balances, insufficient
  source value, missing relays, unread pool fees, changed fees, stale recipient
  registration, and account/network changes.
- Closing or editing Send invalidates the frozen review instead of reopening or
  submitting a stale composition.
- UI Lab Send checkpoints use valid account-scoped balances and report the
  actual fixture preparation error instead of timing out generically.

### Security
- The pool fee, recipient, token, amount, account, network, and route are bound
  into each private preparation and checked again immediately before proof,
  signing, and broadcast.
- Paymaster execution errors are generic at the post-proof boundary, preventing
  a relay from echoing short proof or proof-fact values into wallet UI or logs.
- RPC write ambiguity is created only at the three actual
  `starknet_add*Transaction` fetches; endpoint selection, deployment checks, fee
  estimation, transaction construction, and class decompression cannot claim a
  possible broadcast.
- Vault migrations fail closed on malformed staging data, silently failed writes
  or deletes, stale sessions, and preference-write failures. Public account
  projections cannot expose encrypted account-secret records.
- Ledger compatibility checks may reuse a verified transport session, but key
  matching and signature verification remain mandatory for every signing path.
- The final software release head passes the repository's full test, 95%
  coverage, dependency-audit, terminal, UI Lab, build, extension E2E,
  reproducible-package, and checksum gates.

Physical Ledger confirmation across the full supported device and transport
matrix is deliberately not claimed by v0.9.0. It is tracked in
[#224](https://github.com/starknet-innovation/mc-wallet/issues/224) for v0.9.1,
after this release can be loaded on the target hardware.

## [0.8.0] - 2026-08-05

Safer dApp account boundaries, explicit STRK20 privacy, faster and more truthful
transaction status, and opt-in support for fully on-chain animated collectibles.

### Added
- An explicit multisig confirmation review that shows the exact decoded effect,
  signer, network, mode, and estimated fee before hardware or software signing.
- Atomic confirm-and-execute for the signer that reaches quorum, while retaining
  a deliberate confirmation-only choice.
- A background transaction monitor that recognizes Starknet pre-confirmation,
  finality, and L1 acceptance, then reconciles submitted activity without
  blocking the send flow on slow polling.
- Account-scoped transaction alerts for late rejection, reversion, and expiry,
  with bounded delivery and visible status updates in the popup and side panel.
- Explicit playback for self-contained on-chain NFT animations on collectible
  detail screens, including static fallbacks for gallery views.
- Account- and network-scoped STRK20 registration, private balance disclosure,
  shielding, transfer, withdrawal, and invoke journeys through the pinned
  official Starknet Privacy SDK.
- A mainnet Terminal privacy workspace for pool inspection, private portfolio
  actions, and reviewed AVNU private swaps through bounded server gateways.

### Changed
- Connected dApps now resolve a grant to at most the active account. Switching
  outside a site's approved accounts disconnects it and requires deliberate
  reapproval instead of silently exposing or signing with a stale account.
- Account creation, import, Ledger creation, and manual account selection now
  notify connected pages of active-account changes consistently.
- Submitted activity advances monotonically through pre-confirmed, accepted,
  rejected, reverted, expired, and L1-confirmed states; terminal observations
  cannot regress when providers disagree or respond out of order.
- Mainnet status reads prefer the Starknet Foundation v0.10 endpoint with a
  Cartridge fallback and bounded concurrency.
- dApp invoke requests now take over the wallet before fee RPC work completes,
  show an explicit estimating state, and share Send's unit-aware fee and
  affordability review.

### Fixed
- Multisig confirmation sheets keep focus contained, keep their final action
  visible at compact side-panel heights, and expose a working fee-estimate retry.
- Impossible confirmation counts no longer qualify for atomic execution, and
  concurrent extension surfaces cannot broadcast the same proposal action twice.
- Late transaction failures are delivered only to the matching unlocked
  account and network, preventing activity or alerts from bleeding between
  account scopes.
- Reconnecting after an account switch no longer returns the previously active
  address, and a stale network-switch approval cannot reconnect an origin that
  is no longer authorized.
- Fully on-chain collectibles without a static image no longer stop at an empty
  placeholder when their supported animation is opened deliberately.

### Security
- Multisig action messages require an exact confirmation mode and reject unknown
  fields; the reviewed fee and submitted call batch are derived from that same
  typed request. Durable pre-broadcast claims fail closed on unresolved duplicate
  intent without blocking a valid later confirm/revoke state transition.
- Untrusted animation HTML runs in a manifest sandbox with an egress-denying
  CSP and a second opaque-origin iframe sandbox. Browser regression tests prove
  it cannot access extension APIs or parent DOM state, beacon the network, load
  remote images, or escape isolation through self-navigation.
- Transaction approvals remain bound to the exact account shown at review time
  and fail closed if active-account or origin-grant state changes before
  execution.
- STRK20 disclosures require explicit consent; prepared operations are
  one-time, kind- and digest-bound, and discovery/proving use OHTTP through
  bounded gateways without embedding private upstream URLs or credentials.
- Review-time invoke fee estimation skips account validation, so it cannot
  exercise Krusty or open a Ledger signing prompt before approval.
- Status reconciliation is fail-closed, concurrency-bounded, and capped to five
  sanitized alerts per drain, limiting provider-induced resource use and UI
  flooding.
- The final release head passes the repository's 95% coverage floor, extension
  browser E2E suite, reproducible packaging, and high-severity dependency audit.

## [0.7.2] - 2026-07-28

A focused interaction-design and security release: clearer onboarding and
account management, deliberate transaction progress, practical multisig
workflows, and an expanded review lab backed by hardened provider and release
boundaries.

### Added
- A unified Add account chooser, shared by the account drawer and Manage
  accounts, with explicit Standard, Ledger, private-key import, and Multisig
  signer models. Multisig setup then separates creating a new shared account
  from adding an existing deployed account where the active account is already
  a signer.
- A complete Multisig portfolio and operations journey: shared balances and
  collectibles, proposal-first major actions, guided token-transfer proposals,
  address-book and wallet-account signer selection, quorum review, deployment,
  proposal tracking, and independent scan/copy/local-decoder verification.
- Recipient-first sending with address-book selection, searchable token
  selection, token/fiat amount switching, a network-aware summary, decoded
  action accordion, and explicit review before submission.
- Deterministic account identity artwork, a fourth Portfolio quick action, an
  MC Terminal handoff, and production Starknet marks wherever a destination
  network is displayed.
- Storybook checkpoints for the unified account chooser and Multisig
  create/add-existing gateway, extending the organized wallet journeys and
  deterministic design-review coverage.

### Changed
- The wallet now uses an intentionally monochrome interaction system so
  hierarchy, focus, motion, and state remain legible without pervasive accent
  color. Green and red remain reserved for success and failure.
- Full-browser onboarding follows a stable staged flow with slower,
  counter-rotating icon orbits, smoother transitions, Mainnet defaults, and
  reduced-motion behavior.
- Portfolio surfaces use larger balances, four consistent major actions,
  simplified Tokens/Collectibles navigation, a compact overflow menu, and a
  cleaner icon-only wallet dock.
- Send and Ledger transaction progress now advances through visible review,
  hardware authorization, broadcast, confirmation, success, and failure states
  with calmer liveness motion and direction-aware transitions.
- Multisig proposals aggregate recipient, token, amount, source, network, and
  decoded effects into focused stages while keeping raw contract calldata in an
  explicit advanced path.

### Fixed
- Activity state is partitioned by network and account so switching wallets
  cannot show another account's history.
- Add account no longer derives a Standard account immediately from the drawer;
  both entry points require the same visible account-model choice.
- Hover, focus, selected, and disabled states retain readable contrast, and
  native-looking select controls no longer escape the wallet design system.
- Onboarding orbit icons stay separated at normal playback speeds, surface
  presets retain side-panel spacing, and waiting animations no longer pulse too
  aggressively.
- Destination-network rows use the canonical Starknet token mark rather than a
  generic placeholder.

### Security
- All open CodeQL findings are addressed without suppressions: dapp provider
  requests and results use an exhaustive, single-sourced method set instead of
  page-controlled computed dispatch.
- Bounded JSON normalization preserves hostile keys such as `__proto__` only as
  own data properties on null-prototype records, and changelog regex inputs are
  escaped literally.
- AVNU asset synchronization accepts only signature-checked PNG, JPEG, and WebP
  downloads; remotely supplied SVG is no longer treated as safely sanitizable
  with regular expressions.
- Release and nightly workflows resolve immutable commit SHAs before
  self-hosted execution, validate tag-to-commit correspondence, and detach onto
  the verified revision.
- The repository-wide coverage gate remains enforced above 95%, with new tests
  covering account routing, settings and address-book bindings, approval
  behavior, NFT views, network marks, and navigation primitives.

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
