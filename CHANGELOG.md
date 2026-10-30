# Changelog

All notable changes to Bramble are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. Older entries are kept in [CHANGELOG_ARCHIVE_0.9.md](CHANGELOG_ARCHIVE_0.9.md) (v0.9.0–v0.10.4) and [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md) (before v0.9.0).
See DEVELOPMENT.md and RELEASING.md.

## [Unreleased]

## [0.10.8] - 2026-10-30

Import accounts the recovery phrase can't find, pay network fees in other
tokens on Mainnet, a smoother Home and multisig setup, and fixes from user and
QA reports.

### Added
- Import an account by its address when the recovery phrase can't derive it,
  for example a Ready account with a guardian or a Braavos account with a
  rotated key. Bramble imports it only when the account's live owner key matches
  a key the phrase derives (#781). A Ready account found from a private key can
  be imported the same way (#792).
- Restore a Ready account from its private key at the release it was deployed
  with (#777).
- Recover Xverse accounts, and deploy a funded Xverse account (#763, #780).
- Pay the network fee in another token on Mainnet (#784).
- Account deployment can be sponsored through the wallet gateway. When it
  isn't offered, you pay the fee as before (#768, #806).
- Activity lists outside executions signed for a relay, with their on-chain
  outcome (#766).
- wstETH, xSTRK and xWBTC are curated, so held balances show up (#801).
- Shield says how much STRK it needs and how much to add (#665, #786).

### Changed
- Home fills in while balances load instead of flashing errors (#795, #805).
- Each account is drawn as a bird (#746). The 24h caption and per-row window
  label are gone from the portfolio (#745).
- Private actions are turned off for an account another wallet registered for
  private balances (#755).
- Multisig setup stays on Approval until you check the fee and address,
  "Fund from this wallet" fills in the minimum, the minimum is rounded up, and
  titles wrap instead of being cut off (#807, #810, #811).
- Onboarding previews the account under the name it will get (#811), with UX
  polish for full-tab setup and Ledger (#731). Braavos accounts are listed like
  Ready's, and are found during first-run Ledger setup (#733).
- The wallet remembers deployed accounts instead of re-reading them (#741).

### Fixed
- Approvals open in a popup where the side panel can't show, such as Arc or an
  expired gesture (#690, #707, #787). The wheel scrolls a long request down to
  Approve (#747).
- The side panel no longer scrolls when its content fits, screens stay centred
  on Windows, and the onboarding background reaches the window edges (#759,
  #765, #800, #808).
- The live phishing blocklist loads again (#772, #773, #774).
- A wallet without a recovery phrase can add a regular account (#740, #762).
- Dock labels fit inside their capsule (#785).

### Security
- A gasless send counts as refused only when the wallet gateway itself refuses
  it, so a relay's reply can't make the wallet report "Nothing was submitted"
  for a request that may still execute (#812).
- The privacy maturity store keeps a just-settled write when full, and evicts
  in write order across networks (#729, #802). A malformed relay error on a
  private broadcast is treated as a lost answer (#798).
- Patched node-forge 1.4.2, and high/critical dev-tooling advisories cleared
  (#495, #767, #769, #790).

## [0.10.7] - 2026-10-19

Private sends that recover from a lost relay reply without a browser restart,
the remaining Low findings from the v0.10.6 release audit, and fixes from user
and QA reports.

### Added
- Settings → Unlock private transactions lifts a private-transaction pause on
  purpose, after stating that the earlier transaction could still go through
  (#668).
- When a downloaded update is ready, an idle wallet applies it straight away. A
  wallet in use shows a prompt to restart, and applies the update once nothing
  is in progress (#708).
- Send warns when the recipient is a token contract, where tokens sent are
  usually lost (#713).
- Recovery has a Clear button, confirms a valid phrase, and fills empty account
  groups (#718).
- On Arc, Extension options opens the wallet in a tab (#690).
- Multisig: a stale proposal says why it went stale, names a fee refusal on its
  card, tells a rejected stale version from a reverted one, and offers Propose
  again (#673).

### Changed
- Shielding says upfront that its network fee is paid in public STRK (#665).
- Max on STRK leaves room for the network fee (#720).
- A site's non-pool SNIP-36 proof invoke goes out as an ordinary invoke. Only a
  privacy-pool batch takes the private lane (#692).
- Service endpoints are stored only in their canonical spelling, so an endpoint
  echoed in an error is always redacted in full (#674).
- Docs: upgrades are one-way. The README and support page say how to recover if
  an older build is installed (#670).

### Fixed
- A private transaction whose relay reply was lost no longer needs a browser
  restart, which used to unlock the account without cancelling anything. The
  pause now survives restarts and lifts once Ethereum-finalized chain state
  shows the relayed transaction can no longer apply, which can take hours
  (#668).
- The deploy screen reads fresh deployment status, refuses an account that is
  already deployed by name, and an automatic account deployment is recorded in
  Activity for sends, NFT sends, swaps, revokes, site invokes and declares
  (#712, #719).
- A transaction found reverted only on chain is stored as reverted, not
  accepted (#656).
- A rate-limit refusal from an RPC endpoint stays a rate-limit refusal through
  starknet.js, instead of reading as a generic failure (#660).
- A wrong-passphrase error no longer offers a copy button (#713).
- From the v0.10.6 release audit (Low):
  - a pool-fee refusal before signing reads as not sent, never "status
    unknown" (#679);
  - a balance that was never read shows "—", never 0, on token detail and Swap
    (#680);
  - `wallet_watchAsset` keeps the user's own token record (#682);
  - a site approve whose reply was lost files its allowance under the signed
    hash, so it can be revoked (#678);
  - a multisig submit whose reply was lost shows "status unknown" with the
    signed hash and stays pending in Activity, with no blind resend (#681);
  - old unresolved sends no longer push a send still being watched out of
    Activity storage (#677).

### Maintenance
- The Firefox package is attached to every GitHub Release (#685).
- CI actions bumped together with their security-policy pins (#711).
- Terminal: each Vesu registry check reads at one block (#270).

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
