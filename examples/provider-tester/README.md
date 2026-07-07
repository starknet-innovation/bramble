# MC Wallet — Provider Tester

A standalone dApp page that exercises every method of the injected wallet
provider (`window.starknet_mcWallet`) so you can walk through and confirm the
wallet behaves correctly end to end.

## Why it must be served (not opened as a file)

The extension's content script injects the provider only on `https://` and
`http://localhost` / `http://127.0.0.1` pages (see `content_scripts.matches` in
`public/manifest.json`). A `file://` page gets no provider. So serve this folder
over a local HTTP server.

## Run it

From the repo root, serve this folder on localhost with anything you like:

```bash
# Option A — Bun
bunx serve examples/provider-tester

# Option B — Python (no install)
python3 -m http.server 8000 --directory examples/provider-tester
```

Then:

1. Load and unlock MC Wallet (`bun run build`, load `dist/` unpacked in
   `chrome://extensions`, create/unlock a wallet).
2. Open `http://localhost:8000` (or the port your server printed) in a tab.
3. Open the MC Wallet side panel next to it.
4. Run the steps on the page top to bottom.

## What each step verifies

| Step | Method | What to confirm |
| --- | --- | --- |
| 1 Detect | metadata | `id: mc-wallet`, `name: MC Wallet`, `version: 0.1.0`, inline icon |
| 2 Connect | `wallet_requestAccounts` | wallet prompts a **Connection request**; returns addresses after Approve |
| 3 Authz | `mc_accounts`, `wallet_getPermissions` | `isPreauthorized: true` and `["accounts"]` once connected |
| 4 Chain id | `wallet_requestChainId` | `0x534e5f4d41494e` (Mainnet) / `0x534e5f5345504f4c4941` (Sepolia) |
| 5 Sign | `wallet_signTypedData` | **holds** until you decide; Approve → `[r, s]`, Deny → rejects. Never auto-signs |
| 6 Invoke | `wallet_addInvokeTransaction` | shows a **Transaction request**; call rejects `approval pending`; tx lands in Activity after Approve. Never auto-submits |
| 7 Switch | `wallet_switchStarknetChain` | returns `true`, fires `networkChanged`; unconnected origins refused |
| 8 Watch | `wallet_watchAsset` | shows an **Add token** card; token appears under Tokens after Approve |
| 9 Events | `on`/`off` | switching account/network in the wallet, or revoking the site, emits events |

The two security gates to watch closely: **step 5** (sign) must hang until you
approve, and **step 6** (invoke) must never broadcast a transaction without an
explicit approval in the side panel.
