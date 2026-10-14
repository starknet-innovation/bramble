# Changelog

All notable changes to Bramble are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. Older entries are kept in [CHANGELOG_ARCHIVE_0.9.md](CHANGELOG_ARCHIVE_0.9.md) (v0.9.0–v0.10.2) and [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md) (before v0.9.0).
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

## [0.10.5] - 2026-10-07

### Added

- **285:** settings entry point for the own-account rescan
- **285:** background rescan of the wallet's own accounts
- **accounts:** hide accounts without removing them
- **privacy:** state the STRK the registration needs
- move deployment out of Home and into Security & permissions
- quote one fee when a send also creates the account
- put the address first on Receive, everything else behind Pro
- rework token picking, the Send flow, and the address book

### Fixed

- **deps:** pin patched sharp and shell-quote in the reviewed overrides
- **settings:** stop the own-phrase scan on lock and test its background handlers
- **send:** reserve a non-STRK configured fee token instead of waiting forever
- **accounts:** never fall back to a hidden account when choosing the active one
- **onboarding:** read the account address in the data voice, not a caption
- **firefox:** hold the event page open while an approval is pending
- **deps:** pin patched source-map-js in the reviewed overrides
- **security:** compare denylisted hosts without a trailing dot
- **privacy:** warn, don't fail, when a registration reply is lost
- **privacy:** hold the worker open while a reviewed preparation awaits confirmation
- cap added tokens per network and keep one record per address
- keep a late phrase validation from undoing the import wipe
- say nothing is signed while the Ledger grant handshake runs
- bound the custom networks dapps can store in preferences
- keep deployment submit errors out of the Cost box
- keep portfolio balances live when one tracked token reverts
- leave the import-key form ready after a successful import
- don't let a stale suggestion panel rewrite a pasted recovery word
- never report a Firefox phrase copy as cleared
- restore safety facts the copy review dropped
- keep the guarded phrase copy's clipboard promise
- clear the imported recovery phrase after an in-wallet import
- don't let Tab or Enter replace a complete recovery word
- don't claim a STRK20 approval charges no fee when it lists a relay fee
- state the Mainnet consequence where the acknowledgement used to be
- keep the wrong-network warning visible on Receive by default
- don't tell users to retry a submission whose outcome is unknown
- don't say "Transaction not sent" for a transaction the chain reverted
- show a failed deploy or NFT transfer as a failure, not a success
- bind the network picker to its buttons only
- name a pasted recipient that is already a known account or contact
- settle a stuck privacy marker without racing or trusting a bad nonce
- tolerate a missing app root on the clipboard wait
- clear the copied phrase before onboarding closes
- commit a backup mismatch on Enter, and only from Continue
- report a backup mismatch when Continue is pressed
- align Manage tokens when the token list is absent
- name both class hashes in the Receive mismatch alert
- hide an empty send folder hint while it is minimized
- forget a collapsed folder once that folder is gone
- keep the folder drop highlight while the pointer is inside it
- show a dropped account and count unfiled ones in My accounts
- keep drawer folder names and leave account drags alone
- show default folders on the manage view
- re-estimate when the two fees cannot be added
- withhold a fee total when the two estimates cannot be added
- an undeployed account on Home is a state, not a fault
- restoring a Ready Ledger account belongs under Import
- treat only a real contract prefix as an address search
- keep the save-address handoff until save or leave
- match token search on name and address, best hit first
- ignore a swap catalog reply that is no longer current
- type the onboarding watchdog timer as one setTimeout

### Documentation

- keep the word for secret material out of non-boundary comments
- **transfer-fee-review:** stop claiming no estimate ever signs
- **deployment:** describe the Braavos deployment truthfully
- **build:** verify the AMO rebuild against the submitted archive
- **ui-lab:** recount the checkpoint total for this bundle
- **accounts:** match the hide guard's comment to the visible-first fallback

### Maintenance

- split the flow-chrome and list rules out of styles-base
- **recovery-ui:** kill the detached-flag mutant
- reconcile the bundle's overlapping recovery and signability tests
- drive the Braavos deployment estimate and submission end to end
- cover scene selection and the recovery runtime client
- **ledger:** count the find-accounts route in the no-transport import chooser
- **285:** cover the find-accounts screen in the UI Lab
- **285:** cover the find-accounts flow and its reviewed copy
- pin the audit 134/153 hunks no test protected
- keep the Send render under the complexity cap, and format
- regenerate bun.lock and move the policy pins with the group bump
- **deps:** bump the minor-and-patch group with 8 updates
- keep onboarding-ui.ts within the 500-line cap
- split the Send close cases out of the transfer-ui suite
- assert the extension e2e paths the suite only named
- add derek-flossman to codeowners

### Other

- Drop the unreachable key-less refusal from the recovery context
- Bind the escape acknowledgement to the escape's kind as well as its ready_at
- Let recovery gate reads fail over and re-pin instead of refusing
- Refuse a Ready escape step inside the account's 12-hour limit in words
- Never show a deployed account as not deployed on an RPC flake
- State each recovery refusal's true cause
- Pin the recovery gates to one accepted block
- Never show a Ready escape to a new guardian as a guardian removal
- Bind the owner-escape acknowledgement to the escape the review showed
- Refuse Ready recovery for an account with a backup guardian
- Confirm 2FA and guardian removal with the fee and a truthful consequence
- Bind recovery submits to the reviewed account and journal them
- Read the Ready escape window from chain and bind its submit to the confirmation
- Bind the Braavos 2FA removal to a validated, confirmed fee
- Say truthfully who can cancel a Ready guardian removal
- ui-lab: checkpoint the undeployed Braavos Home state
- dApp approval card says to deploy an undeployed Braavos account first
- Send review says to deploy an undeployed Braavos account first
- Home asks an undeployed Braavos account to deploy first
- Refuse deploy-then-act for an undeployed Braavos account
- Validate the signability response's account id with isAccountId
- Correct stale Braavos comments and a family-specific RPC diagnostic
- Re-pin the Braavos and submit-path live checks on block skew
- Sign Braavos only on implementation classes, for the first stark signer
- Split scene markup selection out of the side-panel entrypoint
- Recover a Ready account with a guardian using the recovery phrase
- Show the recovery unlock as an absolute UTC datetime
- Recover a Braavos 2FA account with the recovery phrase
- Deploy funded Braavos counterfactuals from the wallet
- Sign for stark-only Braavos accounts
- Disable Shield for a read-only account, and cover the signability poll
- Home says an account is read only before any button is pressed
- Document the AMO source-submission rebuild
- Reserve the STRK20 pool fee in the token the relay charges it in
- fix/privacy: keep the settle watch from re-arming after its window closes
- fix/privacy: keep the home private balance fresh after a settled send
- Gate the Ledger transport on browser support
- Show the STRK20 pool fee as a STRK amount, not a raw felt
- Say an account is view-only before it is picked, and in plain words after
- Refuse the Ready-scheme kind in the v7/v8 legacy validator too
- Find Ready and Braavos accounts on the ladders their apps actually use
- Accept the optional api_version on every Wallet API method
- Accept valid_until and api_version on wallet_strk20Balances
- Keep the recovery scan going while it keeps finding accounts
- Pin the swap review enrichment and the checker's secret-material pattern
- Let the shared client classify non-OK silent reads in the grant tab
- Review OutsideExecution signs against own accounts and paid recipients
- Never re-quote a swap whose reply was lost, and pin header Back
- Split the fallback preferences store out of runtime-state
- Report a lost swap reply as status unknown with its signed hash
- Protect the trust-set enrichments and the secret-material rule with tests
- Report a lost private execution worker as status unknown
- Stop Enter in the multisig token search from submitting the composer
- Replay a lost Send reply through the full stack
- Trust payees of NFT and multisig sends as paid recipients
- Re-quote after a failed swap and hold header Back while it confirms
- Purge planted history rows persisted before the decoder filter
- Report a lost Send reply as status unknown and re-review every retry
- Flag lookalikes in every zero-padded display spelling
- Only reject a vanished transaction the wallet actually saw on chain
- Keep the trust-set vault read inside the secret boundary modules
- Fail closed on replaced STRK20 markers and keep post-deploy outcomes honest
- Escape the account label in three innerHTML rows
- Accept the Ledger signHash recovery byte in the grant tab
- Stop Enter in Send searches from submitting a stale recipient
- Widen the poisoning check to padded windows, own accounts and paid recipients
- Drop planted zero-value and untracked-token rows from history
- Persist the phishing feed cache in byte-budgeted chunks
- Drop a cached price the feed answers without
- pin the removal of the SDK builder's simulate
- privacy-views: state the activation network fee in its own unit
- track freshness per address so a stale leg cannot bound a relay fee
- state a relayed private-send fee in its own token
- refuse a stale price snapshot as the converted relay-fee reference
- refuse a relayed private broadcast once the wallet is locked
- stop the recipient-status probe renewing the unlock session
- prove STRK20 simulations through the prover, not the RPC node
- Pin the chain-switch landing to this origin's grant and the active account
- Restore the copy review's final commits that #475 left out
- Name the payee of a dapp STRK20 deposit that credits another account
- Decode dapp AVNU swaps on the review card and flag foreign payees
- Pin the dapp token source through the real wiring and curated checks
- Split the verifier context out of verify-decode
- Label STRK20 review cards from the trusted token set
- Stop trusting dapp-watched tokens the wallet cannot vouch for
- Flag OutsideExecution allowance top-ups against standing allowances
- Land a chain switch on the origin's stored grant, not its visible account
- Stop trusting spoofed tokens on watch-asset and review cards
- Apply invoke call defences to OutsideExecution sign requests
- Stop an approved chain switch from granting an unconnected account
- Reset RPC cooldowns per case in the history-scan degradation tests
- Accept the unpatched node-forge advisory with a scoped, documented ignore
- Drop deployment verdicts that answer for a different account
- Bump wrangler and patch stale lock entries to clear high advisories
- Make every word count across the wallet (#466, rebased onto release/v0.10.5)
- Say who sent what to whom on the Send receipt, and link it to Starkscan
- send and swap a token from its detail screen
- Copy button beside every address on a static screen
- Lower the Firefox floor to ESR and withhold the sandboxed renderer
- resolve a lost account-mode send on-chain, not by restarting
- offer the Reveal screen's guarded copy for a new phrase
- scroll dock screens only when content reaches the dock
- say when the backup words don't match
- give each surface one radius and one text column
- name every account on the manage screen, identifiers to Receive
- Group Send's recipients under their folders, and lower-case avnu
- reword a groups comment the secret-material scan matched
- Group the account drawer into folders you can drag between
- warn Ledger users on NFT sends that deploy, and link the security hub
- reset the QR when Pro closes and describe the address to assistive tech
- fix token pick re-measure, catalog races, and dropdown listeners
- follow the token dropdown, Pro address form, and catalog view
- open the account's own channel during registration
- bump to 0.10.5

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
