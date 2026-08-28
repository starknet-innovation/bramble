# Chrome Web Store permission justifications

These declarations map exactly to `apps/extension/public/manifest.json`. Remove a permission when
its current feature is removed; never retain one for future use.

## Single purpose

Securely manage Starknet accounts and review, sign, and submit user-approved Starknet transactions
from Chrome.

## Extension permissions

| Permission | Narrow justification |
| --- | --- |
| `storage` | Stores the encrypted wallet vault, non-secret preferences, public cache snapshots, pending transaction reconciliation, and a locked-session marker. Signing material never leaves the encrypted vault. |
| `alarms` | Expires an unlocked session and reconciles only locally recorded pending transactions while the extension is installed. |
| `sidePanel` | Presents the wallet, transaction reviews, and dapp approvals in Chrome's trusted extension side panel. |

## Site access

The content script runs on HTTPS pages and local development pages only to expose the Starknet
provider and relay an explicit site request to the background. It does not read page content,
keystrokes, forms, cookies, or browsing history. The requesting origin is used only to show the
approval and store/revoke that site's local account permission.

## Host permissions

| Host | Current feature |
| --- | --- |
| `wallet.nodes.starknet.org` | Wallet-operated Starknet RPC and configured STRK20 privacy services. |
| `mainnet.nodes.starknet.org`, `sepolia.nodes.starknet.org` | Direct Starknet Foundation RPC fallback when the wallet gateway has a transport failure. |
| `api.cartridge.gg` | Final Sepolia RPC fallback. |
| `api.coingecko.com` | Public token price and market-change data. |
| `starkscan.co` | User-opened explorer links and the separately disclosed, per-network opt-in activity fallback. |
| `starknet.api.avnu.fi`, `sepolia.api.avnu.fi` | Swap token catalog, quote, and build services for user-initiated swaps. |
| `metamask.github.io` | Public phishing-domain feed used to warn before site connection. |
| `127.0.0.1:5050`, `localhost:5050` | Explicit local Starknet devnet support for developers; never used for a public network. |

All remote hosts are HTTPS except the loopback-only developer endpoints. User-added Starknet
networks are admitted through Chrome's runtime host-permission flow and validated before use.

## Nostr WebSocket destinations

An explicit **Share securely** or **Check for co-signer updates** action opens a one-shot encrypted
WebSocket exchange with the reviewed defaults (`relay.primal.net` and `nos.lol`) or one custom relay
the user deliberately selected as their replacement. Relay URLs require WSS, except loopback WS for
local testing, and cannot contain credentials. They do not grant page or host access through the
manifest. The extension does not poll them while idle.

Chrome requires the narrowest permissions necessary and recommends listing the reason for each:
<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/#minimum-permission>.
