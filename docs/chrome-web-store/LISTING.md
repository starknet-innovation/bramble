# Chrome Web Store listing

Use this copy verbatim unless product behavior changes. Any data-handling change must update the
in-product disclosure, privacy policy, Privacy practices declaration, and this listing before it is
collected. Chrome's current policy requires prominent disclosure for all data collection.

## Store listing

- **Name:** MC Wallet
- **Category:** Productivity
- **Primary language:** English
- **Summary:** A self-custodial Starknet wallet for accounts, dapps, privacy and multisig, with a trusted-tester Ledger preview.
- **Single purpose:** Securely manage Starknet accounts and review, sign, and submit user-approved
  Starknet transactions from Chrome.

### Detailed description

MC Wallet is a self-custodial Starknet wallet built for clear transaction review and resilient daily
use. Create or recover OpenZeppelin and Argent accounts, inspect balances and activity, connect to
dapps, send assets, swap tokens, and manage shared Argent multisig accounts.

Software signing keys stay inside the encrypted local wallet vault. Ledger support remains a
trusted-testers preview until the physical compatibility matrix is complete. Every dapp request is
reviewed in a trusted wallet surface before approval. Cached public data keeps the wallet useful
during temporary network disruption, while visible freshness indicators distinguish saved data from
current network state.

Reliability diagnostics are optional and off by default. If enabled, MC Wallet keeps only anonymous,
separate process-local counts for RPC endpoint classes and the optional Starkscan explorer service,
with outcome classes and average latency. It never includes addresses, sites, hashes, calldata,
endpoint URLs, or raw errors, and nothing is uploaded automatically. The user may download the
report and decide whether to share it with support.

MC Wallet is non-custodial software. Keep your recovery phrase offline. No maintainer or support
agent will ask for it.

## Dashboard fields

- **Privacy policy URL:** publish `docs/chrome-web-store/PRIVACY.md` at a stable HTTPS URL and enter
  that exact URL in the designated dashboard field.
- **Homepage:** `https://github.com/starknet-innovation/mc-wallet`
- **Support:** GitHub issues for non-sensitive defects; GitHub private vulnerability reporting for
  security or sensitive reports.
- **Visibility for first publish:** Private / trusted testers.
- **Test instructions:** Create a fresh wallet with a synthetic phrase, use Sepolia, exercise the
  side panel and dapp approval, and confirm diagnostics are off by default. No credentials required.

## Required assets

The upload set lives in `docs/chrome-web-store/assets/`:

- `icon-128.png` — 128×128 PNG; the packaged extension uses the same artwork.
- `promo-small-440x280.png` — required small promotional image.
- one to five full-bleed `screenshot-*-1280x800.png` files showing actual wallet UI.

Google's current image guidance requires a 128×128 PNG icon, a 440×280 small promo, and at least
one 1280×800 or 640×400 screenshot:
<https://developer.chrome.com/docs/webstore/images>.

## Human prerequisites

The repository cannot create or own the external publisher identity. Before submission, a
maintainer must record privately:

- verified Chrome Web Store publisher and 2-Step Verification owner;
- item ID and the four `chrome-web-store` environment secrets from `RELEASING.md`;
- required environment reviewer independent of the publisher;
- stable public privacy-policy URL;
- Verified CRX Upload public key and separate protected custody of its private key.

Official first-publish steps:
<https://developer.chrome.com/docs/webstore/publish/>.
