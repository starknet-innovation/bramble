# Changelog

All notable changes to Bramble are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. Older entries are kept in [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md).
See DEVELOPMENT.md and RELEASING.md.

## [Unreleased]

## [0.10.6] - 2026-10-14

Shadow accounts for STRK20 sites, a recovery screen for a wallet that cannot
be verified, fixes from an external security review, and fixes from user
reports.

### Breaking
- STRK20 sub-accounts use the Wallet API 0.10.4 shadow-account names:
  `wallet_strk20ShadowAccountCommitment` and the `shadow_account_invoke` action.
  The old names are refused, with no alias. `wallet_supportedWalletApi` reports
  `0.10.4` instead of `0.10.4-rc.0`, which still used the old names.
- Every shadow-account identity changes: the scope domain is now
  `bramble/strk20-shadow-account/v1`. Shadow accounts derived under the old
  domain are not reachable from this build, by a site or by the wallet. Only
  users who entered a sub-account anonymizer by hand on v0.8.0–v0.10.5 (no
  build bundled one) can have funded one; recovering it needs an old build
  together with that old anonymizer.
- The per-network setting `subaccountAnonymizerAddress` is now
  `shadowAccountAnonymizerAddress`. A stored value under the old key is
  dropped, not carried over, and must be re-entered with a current anonymizer.
- The vault migrates to schema v12 on unlock, adding encrypted shadow-account
  records. Earlier builds cannot open a v12 vault.

### Added
- Shadow accounts. A site can run calls through a per-site shadow account
  funded from private notes. The approval card states the calls, which shadow
  account runs them for which site, the anonymizer (bound into the approval),
  which tokens settle back into private notes, any recipient other than you,
  and the whole-balance effect of collecting `all`.
- Settings → Shadow accounts. Every scope a site drives (origin, label,
  anonymizer, and the exact nonces used) is recorded in the encrypted vault
  before the request runs. The screen lists them, reads balances only when
  asked (the read links the addresses at the RPC provider, and the screen says
  so), and sweeps what a site left back into private notes through the private
  relay, paying the relay fee from the private balance.
- A recovery screen for a wallet whose stored copy cannot be confirmed as the
  latest, for example after restoring a browser backup. Unlock anyway opens it
  with your password and disconnects every site; a damaged wallet points to
  restoring from the recovery phrase.
- Send resolves Starknet names (`name.stark`) as recipients, quotes the
  estimated fee on the Amount screen, and states what a private send needs to
  keep for its fee.
- Activity can be filtered, sorted and searched, with a per-counterparty
  summary. The CSV export gains columns and a per-transfer summary.
- Recovery finds accounts funded only in native USDC, and a Braavos account
  owned by a Ledger key can be recovered and deployed.
- New wallets track native USDC on Mainnet, and curated tokens you hold
  publicly or privately are tracked automatically. Spam and uncurated tokens
  are never added, and a token you removed stays removed.
- Bridged `.e` tokens such as `USDC.e` can be suggested and added.
- Multisig deploy quotes the fee and address beside the approval controls.
- Home explains the 24h change figures, and the collapsed balance row shows
  the public and private split.
- Each wallet transaction records the fee it paid.

### Changed
- A site's shadow-account request that cannot run (no anonymizer on this
  network, the record limit reached, or a request that fails before review)
  shows a notice such as "Private services aren't set up for this network."
  The site gets the refusal only after you close it, or a user-refused error
  if the notice expires. Batches that cannot succeed are refused before
  approval.
- Transaction outcomes are stated truthfully. Once a transaction has a hash,
  the result is that hash or "status unknown", never a plain error. "Not sent"
  appears only when the wallet refused before broadcast, an unknown outcome
  shows an amber notice rather than a red failure, and swap, sweep, activation,
  multisig deploy and NFT actions do not offer a resend on an unknown outcome.
- Errors read as reviewed, plain sentences instead of raw RPC or SDK text, and
  security and funds facts are never collapsed. Ledger rejections show the
  device's own message. The deploy screen translates its errors: a balance
  rejection reads "Add STRK to this account to deploy it."
- The unlock screen asks for a password, so it is not mistaken for the
  recovery phrase. The passphrase meter rates common passwords as weak.
- The Connect card names its action ("Connect account"), and the send review
  shows the network and full addresses.
- A payment to a lookalike of a known address can only be denied.
- Account index `0x41474E54` is reserved and refused on manual entry, restore,
  import and recovery.
- Wallet copy is shorter throughout, following an owner-approved review.
- Layout: the Activity title bar stays pinned, scroll areas no longer shift
  width, spacing and label alignment are consistent, and each progress stage
  stays on screen for at least 500 ms (display only; signing is never delayed).
- The pinned official Starknet privacy SDK moved from `0.14.3-rc.4` to
  `0.14.3-rc.8`. On its own it changes no dapp-visible behaviour, stored data,
  settings, or Wallet API names; the shadow-account changes above do.
- Terminal: Vesu lending and Multiply re-check the pool registry right before
  handing calls to the wallet, and the Multiply swap cap is anchored to an
  independent price. Balances are read over RPC (Starkscan retired its
  holdings endpoint), and a failed read shows as unknown, never zero. Perps
  placement stays off, and default slippage is 50 bps.

### Fixed
- Fixes from an external security review (Sherlock audit). What changes for
  users:
  - The vault survives a lost synced commit record, and a second synced
    install no longer locks out a vault it does not own.
  - A full vault, or a refusal before any vault write, no longer signs you out.
  - Sign and approval cards show STRK20 amounts, u256 totals and long
    typed-data fields in full; typed data too long to display cannot be signed.
  - An accepted transaction is never relabelled as failed, and zero-amount
    notes from others no longer freeze the private balance.
  - The allowances manager shows live approvals (with a loading state) instead
    of "none".
  - Sites no longer see wallet details they were not granted, and
    network-change and account events report the right values.
  - Multisig relay sync no longer stalls or re-imports removed proposals, and a
    stale proposal is checked before it is sent again.
  - Relay fee-token handling is stricter, and a relay server error counts as an
    unknown outcome rather than a refusal.
  - Ledger prompts are tied to the request that raised them, and an idle
    device is released.
  - Token details come from the chain, and price, chart and phishing-list data
    refresh correctly.
  - Wallet pages run under a stricter content security policy, and collectible
    images stay sandboxed.
- A stuck private "submitting" state is released when that is provably safe;
  otherwise the wallet offers Check again instead of a browser restart.
- Shield Max on STRK leaves room for the network fee, and the review checks the
  network fee, pool fee and amount against the STRK balance before Confirm.
- Same-symbol tokens no longer merge in the Activity filter; colliding labels
  show a short address.
- A failed allowance revoke clears "Revoke sent" and can be retried.
- A pending activity row is settled only by its receipt, not by a transfer
  event.
- A reverted private transaction is no longer reported as "services
  unavailable".
- A Send review or proof that fails returns to the Amount screen with the error
  instead of staying on "reviewing".
- Smaller fixes: an existing Ledger account is refused up front on Firefox, the
  Send unit toggle, one main landmark per page, the Terminal's Ekubo 1% fee
  tier, and a patched `moment` in the Terminal.

### Known limitations
- Shadow accounts ship with no default anonymizer: they are off unless you set
  an anonymizer address in Settings → Privacy (#666).
- A private transaction stranded after a lost relay reply still needs a
  browser restart to clear (#668).

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
[#224](https://github.com/starknet-innovation/mc-wallet/issues/224) for v0.9.1,
after this release can be loaded on the target hardware.
