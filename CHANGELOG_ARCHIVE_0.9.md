# Changelog archive (v0.9.0 – v0.10.4)

Entries moved out of [CHANGELOG.md](CHANGELOG.md) to keep it readable. v0.10.0 is backfilled from its GitHub Release notes. Earlier entries are in [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md).

## [0.10.4] - 2026-09-22

### Added

- scan every Argent release during recovery discovery
- derive Argent accounts at any release they could have been deployed with
- derive account addresses across every class a wallet deploys with
- **terminal:** connect injected wallets through WalletAccountV6
- let the revealed recovery phrase be copied to the clipboard
- acknowledge a weak vault passphrase instead of accepting it silently
- lower the vault passphrase floor to 8 and warn instead of refusing

### Fixed

- do not treat an unfinished check as a reason to deploy or fund
- stop offering a deployment privacy cannot use
- send unfunded token rows to receive before deployment
- drop deployment status when the active account changes
- offer privacy deployment only when it can succeed
- bump web-ext past the image-size audit failure (#408)
- offer deployment before privacy registration
- accept an upgraded account class instead of demanding the pinned one
- move wallet-standard types into a named capability folder
- drop the starknet type patch for a shared wallet-standard path
- keep starknet 10.8.0 with a reviewed WalletAccountV6 type patch
- rescan history after the wallet records a transaction
- refuse to start a Ledger flow from the toolbar popup
- reserve the document scrollbar gutter so rows cannot shift the layout

### Maintenance

- regenerate bun.lock after Dependabot bumps
- re-evaluate the PR guards when a pull request is retargeted
- **deps:** bump the minor-and-patch group with 16 updates

### Other

- Restore Braavos accounts from a phrase (view-only) and close Ready 0.3.x restore gaps (#400)
- Version the Ready Ledger path scheme as vault schema v9
- Restore Ready Ledger accounts at Ready's EIP-2645 path
- Name the publisher in the extension package
- Build, package and validate the Gecko artifact in CI
- Update the Receive stories to the address-first card
- Fix the four confirmed UX-spec defects: allowance units, address-first Receive, bound connect grants, tested field edge
- announce the Bramble bird as the dapp wallet icon
- bump to 0.10.4 (#367)

## [0.10.3] - 2026-09-16

A patch release that lets a single-asset shielded balance pay its own relay
fee, adds a Firefox build target, and hardens the vault and the v0.10.1
authorization boundaries.

### Added
- The STRK20 relay fee can be paid in the token being sent. A converted fee is
  admitted only under a ceiling derived from an independent reference price,
  frozen into the reviewed plan and re-checked at submission; the route falls
  back to STRK when no reference bounds it, when the batch spends several
  tokens, or when the relay refuses the token.
- A Firefox build target derived from the Chrome manifest. `bun run build:all`
  emits both targets from one run of the gates; the wallet panel maps onto
  `sidebar_action`, pending approvals mark the toolbar button so the click that
  opens the panel is a real user gesture, and `data_collection_permissions` is
  declared. The sandboxed collectible renderer and Ledger are not shipped on
  Firefox, each decided rather than discovered.

### Changed
- The encrypted vault's commit state is mirrored into `storage.session`, which
  no content script can reach, and an envelope must be vouched for by both the
  durable record and the session shadow. The first read of a session seeds the
  shadow, a version-2 envelope after a committed lineage is refused as a
  downgrade, and the shadow is written before the durable record.
- Deferred approval and signing work is bound to the unlock session that
  authorized it; approvals claimed, grant metadata read, and session restores
  superseded after a lock or revocation are rejected rather than served.
- Embedded private-swap calls are validated against the reviewed trade intent,
  and the paymaster gateway only carries credentials for the configured pool's
  `apply_actions` call. Private-swap planning stays disabled until an
  independently reviewed executor deployment is pinned.
- Only wallet-authored errors reach STRK20 toast copy; SDK, RPC, and service
  diagnostics collapse to a stable fallback.

### Fixed
- Analytics failures and consent races no longer affect wallet traffic.
- Stale direct-provider account and permission responses are suppressed after
  the session that produced them ends.
- The website tooling pins a patched `sharp` (GHSA-rgj7-g3m4-5g8c).

## [0.10.2] - 2026-09-11

A refreshed wallet chrome on the design kit's light palette, explorer-backed
activity, and STRK20 shielding that always reports where it is.

### Added
- Every shortened account address across the wallet carries a copy control for
  the full address: activity rows, account switchers, multisig signers,
  approvals, and receipts.
- The onboarding passphrase meter fills and recolours from a strength estimate
  as the passphrase is typed.
- The working screen and the privacy diagnostics export report the phase and
  elapsed time of a running STRK20 preparation (discovery, maturity, proof
  request, proving), each wait under an explicit budget.

### Changed
- The light skin adopts the design kit's blue-grey tinted neutrals and blue
  accent; the midnight skin keeps its original values. Every surface stays a
  solid fill and the contrast gate still enforces WCAG AA on both skins.
- The website's bird mark and wordmark replace the traced wallet icon in the
  header, gates, Ledger tab, onboarding, toolbar icons, and store artwork,
  rendered from one source and pinned by a conformance test.
- The bottom dock is a floating icon-only pill; home tiles share its tint;
  screen headers show the short network name inline; standalone rows have
  rounded hovers; composite fields highlight as one box; amount fields
  ellipsise instead of clipping.
- Instructional copy that crowded the multisig, send, and privacy screens is
  removed.
- Activity groups rows per day with the UTC time and status, trims amounts to
  four decimals, and reads history from the configured explorer first with the
  RPC scan as fallback.
- Send presents Shield and Unshield semantics for pool routes, shows busy
  feedback immediately on Review, and ticks the sign and broadcast steps as the
  execute job hands the transaction on.
- The Shield tile and "Go private" entry explain a blocked state instead of
  doing nothing.
- The compact onboarding surface closes once it has opened the setup tab, and
  completion opens the wallet in the side panel. The lock screen follows the
  chosen theme.

### Fixed
- Layouts hold at the side panel's minimum width (320px, and 256px under zoom)
  without clipping the right edge.
- Every STRK20 proof runs as a tracked background job polled on short requests,
  so a service-worker restart or the extension message channel closing can no
  longer swallow the result. Execution claims the one-time proof on the
  request, so a lost worker can never double-submit.
- Nested analytics-wrapped privacy services no longer deadlock on the
  flow lock.
- A white button no longer turns its text white on hover in the midnight skin.
- The swap amount field no longer underlines on focus.

### Maintenance
- Bump `actions/deploy-pages` to 5.0.1.

## [0.10.1] - 2026-09-08

### Changed
- Hide the Collectibles tab, the "Manage collectibles" menu entry, the multisig Collectibles tab,
  and the NFT indexer setting while the NFT journey is finished. No view loads NFT data any more:
  watched-metadata and indexer discovery both stop, so a saved `nftIndexerUrl` stays in
  preferences unused and can no longer be set. The gallery code stays in the tree, unreachable
  from the UI, and a conformance test fails if any screen renders a route back into it.

## [0.10.0] - 2026-08-31

### Added

- add secure Nostr multisig coordination

### Fixed

- allow selected account recovery after scan pause

### Other

- Fix multisig intent rendering boundary
- Fix release review blockers
- Harden Nostr coordination and endpoint controls
- Refine Receive identity layout
- Harden Nostr multisig coordination
- Stabilize multisig Nostr handoff
- Enable custom Nostr multisig coordination
- Consume published Krusty package
- Scope multisig relay synchronization
- Align Nostr envelope validation
- Harden Nostr coordination and RPC cooldowns
- Harden RPC and explorer request budgets
- Tighten ambient network request budgets
- Reduce network refresh amplification
- Harden production readiness edges
- Prepare v0.10 production readiness

## [0.9.2] - 2026-08-14

Official Argent account contracts, true M-of-N multisig, safer account recovery,
and the complete remediation of the v0.9.1 comprehensive security audit.

### Added
- New software and Ledger accounts can use the official Argent Account 0.4 or
  OpenZeppelin account contract. Private-key import can attach an existing
  Argent account only when the key is its pinned Stark owner, no guardian is
  configured, and the exact deployment salt is supplied.
- Recovery-phrase import numbers words, flags unknown BIP39 words, offers prefix
  completions while typing, and runs Krusty mnemonic validation before the
  vault passphrase step.

### Changed
- Multisig creation, signing, configuration review, and submission now use the
  official Argent Multisig 0.2 implementation. The former OpenZeppelin-based
  proposal flow is removed; older release entries describe historical behavior.
- STRK20 service reads use bounded retries without multiplying retries across
  nested service layers.

### Security
- Remediated the comprehensive v0.9.1 audit across encrypted-store freshness
  and rollback protection, session and origin-grant races, provider admission
  and event ordering, reviewed fee binding, canonical account identities, KMS
  key verification, and post-broadcast outcome integrity. Full evidence is in
  `docs/security-audit/releases/v0.9.1-comprehensive.md`.
- Argent deployment and signing bind the pinned class, owner, guardian state,
  deployment salt, chain, nonce, calls, fees, and returned transaction hash.
  Multisig intent signatures are validated against the exact fresh signer set
  and threshold before submission.

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
  Bramble gateway, with reviewed direct RPC fallbacks retained for transport
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
[#224](https://github.com/starknet-innovation/bramble/issues/224) for v0.9.1,
after this release can be loaded on the target hardware.
