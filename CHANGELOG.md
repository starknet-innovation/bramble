# Changelog

All notable changes to Bramble are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. Older entries are kept in [CHANGELOG_ARCHIVE_0.10.md](CHANGELOG_ARCHIVE_0.10.md) (v0.10.5), [CHANGELOG_ARCHIVE_0.9.md](CHANGELOG_ARCHIVE_0.9.md) (v0.9.0–v0.10.4) and [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md) (before v0.9.0).
See DEVELOPMENT.md and RELEASING.md.

## [Unreleased]

### Changed
- Addresses are shortened the same way on every screen. Contacts, tokens, NFTs
  and the watch-asset request read `0x5e1d…f2e4`, as the review you sign
  already did (#884).

## [0.10.10] - Unreleased

Quick fixes from the v0.10.9 review: the validator list on Mainnet, the Home
tab order, NFT art, and clearer review screens.

### Added
- A Show art button on NFTs Bramble found for you. It checks on chain that you
  own the NFT, then loads its art. Bramble doesn't fetch art for an NFT until
  you choose it (#896, #897).

### Changed
- Home tabs read Tokens, Staking, NFTs. Manage tokens is in the Tokens tab's
  menu only; Refresh portfolio stays on every tab (#894).
- The validator list keeps Starkscan's order, most STRK staked first, and Show
  more loads 50 at a time. Sort by is gone: it only sorted the validators
  already loaded (#895).
- Staking reviews confirm with the primary button. Claim, withdraw and
  cancel-unstake reviews hide the row's other controls and add Cancel (#898).
- A multisig approval has one "What will happen" section (#898).
- Settings → Import private key offers "Bramble (recommended)" and "Ready"
  (#898).

### Fixed
- The validator list opens on Mainnet instead of saying Starkscan's list is
  incomplete. Your stakes follow the same rule (#893, #895).
- A staking row can't start another review while a transaction is being
  submitted or its outcome is unknown (#898).
- Multisig private balances show "Loading…" until ready, and "Couldn't load
  private balances. Try again." if the read fails (#898).
- At 320px, multisig review values no longer split mid-identifier, approval
  cards reach the right edge, and Ledger setup steps line up (#898).

## [0.10.9] - 2026-11-08

Staking, NFTs on Home, private balances for Argent multisigs, a first shield
in one transaction, and fixes from user and QA reports.

> This release updates how the wallet stores your data. Older versions of
> Bramble can't open it after you unlock this one.

### Added
- Stake STRK and BTC on Mainnet. Pick a validator from the list or paste its
  address, then stake, add stake, claim rewards, unstake, cancel an unstake and
  withdraw. Home has a Staking tab with your positions, each checked on chain
  (#750, #845, #880).
- NFTs are a Home tab, on by default. Bramble finds your Mainnet ERC-721 NFTs
  through Starkscan and shows each one only after the chain confirms you own
  it. Turn it off in Settings → Appearance & currency (#164, #840, #871).
- An Argent multisig can connect to a site and approve its requests (#824,
  #825), and can hold private balances: co-owners share a viewing key and
  co-sign register, deposit, transfer and withdraw (#827).
- A first shield activates private balances and deposits in one transaction,
  so you pay one pool fee instead of two (#849, #862).
- A first shield can be sponsored through the wallet gateway. When it isn't
  offered, you pay the fee as before (#789, #842, #873).
- An expanded Activity row shows the network fee, network, token contract,
  full address and the value at submission. The CSV export gains the value
  columns (#480, #838, #848).
- A Starknet VIP eligibility notice on Home for accounts worth $10,000 or more,
  decided on this device (#688, #839).

### Changed
- Shadow accounts are on by default on Mainnet: the bundled configuration now
  names the Mainnet shadow-account anonymizer, and an existing Mainnet
  configuration that is still the bundled one picks it up once. A custom
  configuration, an anonymizer you set yourself, or one you cleared is kept
  (#666, #870).
- Wallet screens say "NFT" instead of "collectible" (#881).
- A Ledger sign refusal says it may be a rejection or Blind signing being off,
  since the device reports both the same way (#876, #877).

### Fixed
- Undeployed accounts can approve dapp transactions; the review prices the
  deployment too (#851, #853).
- Private swaps on AVNU open the approval card instead of failing with
  `signing-failed` (#860).
- Sponsored account deployment works with the live gateway instead of always
  falling back to self-paid (#850).
- A wrong passphrase when revealing secrets says "That passphrase is wrong."
  (#834, #835).
- A failed Ledger setup or recovery keeps your network instead of switching it
  (#822, #874).
- A privacy-service outage reads as services down, with the diagnostic kept
  (#837). A node's non-JSON error reply shows the refusal message (#857, #859).
- Labels and values no longer overlap at the narrowest side panel, including
  Settings, multisig review, Manage tokens, screen titles and approval buttons
  (#882, #883). Staking keeps the amount and fee visible during review (#880).

### Security
- `wallet_addStarknetChain` refuses chains the wallet can't use instead of
  answering `added` for a network that never appears (#852, #854).
- CodeQL `security-extended` findings closed (#829), and v0.10.8 review
  follow-ups (#820).

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
