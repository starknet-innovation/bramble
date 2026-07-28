---
layout: default
title: User guide
permalink: /user-guide/
---

# MC Wallet — User Guide

MC Wallet is a Starknet wallet that lives in your browser's **side panel**. This
guide is for people *using* the wallet. If you are building or contributing to
it, start with the [engineering onboarding](../engineering/) instead.

> **Mainnet moves real funds.** MC Wallet runs on Starknet Mainnet by default.
> Starknet Sepolia (testnet) and a local devnet are also available from the
> network selector — use a testnet while you are learning.

---

## 1. Getting started

### Install

MC Wallet is a Manifest V3 browser extension. Download a published extension
archive from the
[GitHub Releases page](https://github.com/starknet-innovation/mc-wallet/releases),
verify it against the accompanying `.sha256` file, extract it, then open
`chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and
select the extracted directory. Contributors can instead build `dist/` locally;
see the [README](https://github.com/starknet-innovation/mc-wallet#quick-start).

### First run

On a fresh installation, MC Wallet opens a dedicated full-browser onboarding
tab. It is used only for setup; normal wallet activity remains in the browser
side panel. If you close the onboarding tab, click the toolbar icon and use
**Open full-screen setup** to return to it.

### Create a new wallet

1. Choose **Create a new wallet**. A fresh recovery phrase (seed phrase) is
   generated and shown **masked**.
2. Press **Show recovery phrase** to reveal it. Write it down on paper and store
   it offline. Anyone with this phrase controls your funds.
3. Confirm your backup: the wallet asks you to re-type the words at specific
   positions (**3, 7, and 11**). This is case-insensitive and trimmed. You cannot
   create the wallet until the words match.
4. Set a **vault passphrase** of at least **12 characters**. This encrypts the
   wallet on *this* device; it is not your recovery phrase.
5. Review and explicitly select the derived account. Setup defaults to Starknet
   Mainnet, so tick the **real-funds acknowledgement**.
6. Press **Add selected account**, then open the side-panel wallet from the
   completion screen.

### Restore an existing wallet

1. Choose **Add an existing wallet**, then **Recovery phrase**.
2. Enter the 12 or 24 words individually, or paste the complete phrase into the
   first field.
3. Set and confirm a vault passphrase of at least 12 characters.
4. Review and select the derived account, accept the Mainnet real-funds
   acknowledgement, and press **Add selected account**. Invalid recovery data
   fails closed and remains on the current step for correction.

### Unlocking later

When a wallet already exists, opening the panel shows the **"Welcome back"**
unlock screen. Enter your vault passphrase to reach the dashboard.

### Set up with a Ledger

Choose **Add an existing wallet**, then **Ledger hardware wallet**. Ledger
accounts are keyless in MC Wallet: the private key never leaves the device, and
recovery is handled by the Ledger's own recovery phrase, not by an MC Wallet
software recovery phrase.

---

## 2. Feature how-to

### Send, receive, and deploy

Accounts are OpenZeppelin accounts backed by the encrypted software vault or a
Ledger. A newly created account first exists as a *counterfactual* address; **on
-chain deployment is a separate action** you take from the dashboard when you are
ready. Use the dashboard to send transfers, receive (share your address), switch
networks, and deploy.

### Connect to a dApp

MC Wallet injects `window.starknet_mcWallet` and is discoverable through
get-starknet / starknetkit. On a Starknet site, choose to connect MC Wallet and
approve the connection in the side panel. Grants are **per-origin**: each
connected site sees only itself, never the sites you connected elsewhere.

### Tokens & prices

Common tokens (ETH, STRK, USDC, USDT, DAI, WBTC) are auto-detected. Live prices
come from CoinGecko with a 7-day sparkline, and likely spam tokens are filtered
out.

### NFT gallery (collectibles)

Add an ERC-721 or ERC-1155 collection to watch it. MC Wallet verifies on-chain
ownership, then reads the name, image, description, and attributes from the
token's `token_uri` / `uri`.

### Multisig

For OpenZeppelin multisig accounts you can **watch** an account, **propose** a
transaction, **confirm** others' proposals, and **execute** once the threshold is
met.

### Allowance manager

The allowance manager lists every ERC-20 approval you have granted and lets you
**revoke** any of them in one tap. Reviewing allowances periodically limits how
much a compromised dApp contract can move.

---

## 3. Safety, FAQ & troubleshooting

### Recovery-phrase hygiene

- Your recovery phrase is the master key. Write it on paper; never photograph it,
  paste it into a website, or store it in cloud notes.
- MC Wallet never asks for your recovery phrase to "verify" or "sync" anything
  after setup. Any site or message that does is a scam.
- The **vault passphrase** unlocks the wallet on one device only. Losing it means
  re-restoring from the recovery phrase; losing the recovery phrase means the
  funds are unrecoverable.

### Recognising phishing

MC Wallet flags sketchy sites before you connect: it checks a domain blocklist
and detects lookalike / punycode domains (e.g. a site spoofing a real one with
swapped characters). It also keeps a per-origin connection history so you can see
what you have connected to. If the wallet warns you about a site, stop.

### What "fails closed" means for you

If the wallet's crypto core (Krusty KMS) is unavailable, MC Wallet **refuses to
act** rather than falling back to a weaker path — onboarding buttons stay
disabled and no wallet is created. There is no local signing fallback. This is
deliberate: the wallet would rather do nothing than do something unsafe with your
keys.

### FAQ

- **I closed the panel mid-setup — did I lose anything?** No. If you had not
  pressed "Create wallet" successfully, no wallet was written. Reopen and start
  again; no draft phrase or passphrase is kept.
- **Why is my new account "not deployed"?** Deployment is a separate on-chain
  step from the dashboard, done when you choose — creating the wallet does not
  spend gas.
- **How do I switch to a testnet?** Use the network selector (Starknet Sepolia or
  Local Devnet). Testnets do not require the real-funds acknowledgement.

### Reporting a security issue

Please report vulnerabilities privately — see the
[security policy](https://github.com/starknet-innovation/mc-wallet/blob/main/SECURITY.md).
Do not open a public issue for a security problem.
