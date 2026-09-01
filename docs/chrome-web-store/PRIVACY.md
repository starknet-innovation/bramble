# MC Wallet privacy policy

Effective date: 1 September 2026

MC Wallet is a self-custodial Starknet browser-extension wallet. This policy describes what data the
extension handles, why it is needed, where it goes, and how a user controls it.

## Data handled on the user's device

MC Wallet stores an encrypted wallet vault, account metadata, locally granted site origins, address
book entries, preferences, watched assets and multisigs, pending signing intents, activity, and
cached public network data in Chrome extension storage. Recovery phrases and software signing keys
are encrypted at rest and are used only for user-approved wallet operations. Ledger signing keys do
not enter the extension.

The extension injects a Starknet provider into HTTPS sites and local development sites. It receives
only explicit provider requests made by a site; it does not read page content, forms, keystrokes,
cookies, or browsing history. A requesting origin is shown to the user and retained locally only
when the user grants that site access.

## Network data necessary for wallet features

To provide balances, account discovery, activity, fee estimates, signing preparation, transaction
submission, swaps, explorer links, public price data, phishing warnings, and optional private
transaction services, MC Wallet connects to the hosts listed in
`docs/chrome-web-store/PERMISSIONS.md`. Starknet RPC requests may necessarily include public account
addresses, contract addresses, transaction hashes, calldata, signatures, and signed transactions.
Those requests are sent only to the selected user-configured or bundled service needed for the
requested wallet feature, using HTTPS except for an explicit loopback devnet.

Starkscan activity lookup that discloses an account address is used only after every configured RPC
history source is unavailable. This outage rescue is enabled by default for the bundled RPCs and
can be disabled per network; it defaults off when the user configures a custom RPC unless they
explicitly enable it. AVNU receives the asset and amount details needed for a user-requested swap.
CoinGecko receives public asset identifiers needed for prices. The phishing feed supplies a public
denylist; MC Wallet does not send the current site to that feed.

When the user explicitly shares or checks for an Argent multisig handoff, MC Wallet connects to the
reviewed public Nostr relays `relay.primal.net` and `nos.lol`, or to one custom relay the user chose
as their replacement. A relay receives the recipient's public Nostr key, an encrypted and signed
gift-wrap event, request timing, and ordinary connection metadata such as the user's IP address. The
transaction package and signer identities inside the gift wrap are end-to-end encrypted by Krusty
KMS; MC Wallet does not use these relays for chat, analytics, or background polling. Manual
copy-and-paste handoff remains available without contacting a relay.

## Optional product analytics

Product analytics are off by default and require affirmative in-product opt-in. When enabled, MC
Wallet adds a random installation identifier, extension version, browser family, release channel,
and (for a multi-request private-transaction workflow) a temporary random flow identifier only to
requests sent to `wallet.nodes.starknet.org`. The installation identifier is generated independently
of every account, address, site, extension id, and browser profile. It is stored as non-secret local
metadata so extension updates do not create a new identifier; reinstalling the extension does.

These headers never contain an address, site, balance, transaction hash, calldata, signature,
request body, or response body. The wallet gateway replaces the raw random identifiers with keyed
pseudonyms before retaining an access event and does not retain the raw values. A pseudonymous
installation is not an authenticated person or account. Retained events are used only to understand
gateway feature usage, version adoption, failures, and multi-request funnel completion, and expire
after 90 days. Disabling product analytics stops sending all analytics headers; the local random
identifier remains so re-enabling does not create a misleading new installation.

## Reliability diagnostics

Reliability diagnostics are off by default and require affirmative in-product opt-in. When enabled,
MC Wallet keeps separate process-local aggregate rows for Starknet JSON-RPC and the optional
Starkscan explorer lane, using only coarse endpoint or service classes, outcome classes, and average
latency. Explorer requests are never counted as RPC. The report contains no address, site,
transaction hash, calldata, RPC method, exact endpoint URL, raw error, raw response, timestamp,
secret, or hardware identity. It is never uploaded automatically. A user may download it and choose
whether to share that specific file with support. Disabling diagnostics clears the counters.

## Collection, sharing, and retention

MC Wallet's maintainers do not operate advertising, cross-site tracking, profiling, or automatic
diagnostic collection in the extension. The optional, bounded product analytics described above is
the only behavioral measurement operated by the maintainers. Other data remains in the extension's
local storage unless a wallet feature must send it to the service described above, the user
explicitly exports a file, or the user chooses to share a diagnostic with support. External services
process requests under their own policies.

Local data remains until the user removes the relevant item, clears the extension's storage, or
uninstalls the extension. Product-analytics access events expire after 90 days. A support diagnostic
remains only wherever the user saves or shares it. Maintainers use a voluntarily shared diagnostic
only to investigate the requested support issue and delete their copy when the issue is closed,
unless security or legal obligations require longer.

## User controls

Users can revoke connected sites, remove contacts and tracked assets, change or remove custom
services, refuse explorer fallback, disable and clear diagnostics, export non-secret preferences,
disable product analytics, clear extension storage, or uninstall MC Wallet. Deleting browser storage
or uninstalling before confirming an offline recovery phrase may make a software wallet
unrecoverable.

## Limited Use disclosure

MC Wallet's use and transfer of data received from Chrome APIs complies with the Chrome Web Store
User Data Policy, including the Limited Use requirements. Data is used only to provide, secure, and
maintain the wallet's disclosed single purpose; it is not sold, used for advertising or credit
assessment, or transferred except as necessary for the user-requested feature, security, legal
compliance, or a corporate transaction permitted by that policy. Human access occurs only with the
user's consent for the specific support material they choose to share, for security, or when legally
required.

Chrome requires an accurate public policy even when sensitive data is stored only locally:
<https://developer.chrome.com/docs/webstore/program-policies/privacy>.

## Changes and contact

Any material handling change will be disclosed in the extension and listing before collection and
will update this policy's effective date. Non-sensitive questions may be opened at
<https://github.com/starknet-innovation/mc-wallet/issues>. Sensitive or security reports must use
GitHub private vulnerability reporting from the repository's Security tab and must never include a
recovery phrase or private key.
