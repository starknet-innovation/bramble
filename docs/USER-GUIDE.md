---
layout: default
title: User guide
permalink: /user-guide/
---

# Bramble — User Guide

Bramble is a Starknet wallet that lives in your browser's **side panel**. This
guide is for people *using* the wallet. If you are building or contributing to
it, start with the [engineering onboarding](../engineering/) instead.

> **Mainnet moves real funds.** Bramble runs on Starknet Mainnet by default.
> Starknet Sepolia (testnet) and a local devnet are also available from the
> network selector — use a testnet while you are learning.

---

## 1. Getting started

### Install

Bramble is a Manifest V3 browser extension. Download a published extension
archive from the
[GitHub Releases page](https://github.com/starknet-innovation/mc-wallet/releases),
verify it against the accompanying `.sha256` file, extract it, then open
`chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and
select the extracted directory. Contributors can instead build `dist/` locally;
see the [README](https://github.com/starknet-innovation/mc-wallet#quick-start).

### First run

On a fresh installation, Bramble opens a dedicated full-browser onboarding
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
5. Review the derived account. Bramble supports both account models;
   **OpenZeppelin Account** is the recommended default and **Argent Account**
   remains available. Setup defaults to Starknet Mainnet.
6. Press **Finish setup**, then open the side-panel wallet from the completion
   screen.

### Restore an existing wallet

1. Choose **Add an existing wallet**, then **Recovery phrase**.
2. Enter the 12 or 24 words individually, or paste the complete phrase into the
   first field.
3. Set and confirm a vault passphrase of at least 12 characters.
4. Select the accounts to restore and press **Restore selected accounts**.
   Invalid recovery data fails closed and remains on the current step for
   correction.

### Unlocking later

When a wallet already exists, opening the panel shows the **"Welcome back"**
unlock screen. Enter your vault passphrase to reach the dashboard.

### Set up with a Ledger

Choose **Add an existing wallet**, then **Ledger hardware wallet**. Ledger
accounts are keyless in Bramble: the private key never leaves the device, and
recovery is handled by the Ledger's own recovery phrase, not by an Bramble
software recovery phrase. This is a trusted-testers preview until the physical
device and transport matrix in issue #224 is complete; no model or connection
method is advertised as production-validated yet.

---

## 2. Feature how-to

### Send, receive, and deploy

Choose either a stable OpenZeppelin Account or Argent Account, backed by the
encrypted software vault or a Ledger. A newly created account
first exists as a *counterfactual* address; **on-chain deployment is a separate
action** you take from the dashboard when you are
ready. Use the dashboard to send transfers, receive (share your address), switch
networks, and deploy.

To attach an existing Argent Account 0.4 from a private key, enter its original
deployment salt during import. Before signing, Bramble verifies the pinned
account class, Stark owner, and absence of a guardian at one accepted block.
Accounts using another signer type or a guardian are not supported and fail
closed.

### Swap

Choose **Swap** on Home, select the tokens, and enter what you want to sell. Bramble asks AVNU for a
route, shows the estimated result and fee, and warns when the quoted value loss is unusually high.
Before confirmation, the wallet builds and freezes the exact Starknet calls. Review **what will happen**, the
wallet-enforced minimum received, the maximum network fee, and any risk warning.
Raw calls and the review digest remain available under **Technical details**.
The route cannot change after this review.

A submitted swap is not the same as a confirmed swap. Track its pending,
preconfirmed, accepted, or failed network status in **Activity**.

### Private balances and STRK20

Private-balance discovery is opt-in. Activating it publishes a one-time
viewing-key commitment for the account so Bramble can discover private notes,
and opens the account's own private channel; it does **not** publish the
viewing key or private balance. Activation may need a
proof, account authorization, network fee, and time for the indexer to catch up.
The wallet keeps **submitted** and **discoverable** as separate states.

After activation, Shield and Unshield appear as routes in the normal Send flow,
so amount, recipient, fee, authorization, and confirmation use the same review
model as a public transfer. Privacy services are network-specific. If the
prover, relay, indexer, or pool is not configured or fails validation, the
wallet fails closed and states whether anything was submitted. Ledger accounts
cannot use a privacy path that requires a viewing key the wallet cannot derive.

### Connect to a dApp

Bramble injects `window.starknet_bramble` and is discoverable through
get-starknet / starknetkit. On a Starknet site, choose to connect Bramble and
approve the connection in the side panel. Grants are **per-origin**: each
connected site sees only itself, never the sites you connected elsewhere.

A new site request opens in front of the wallet so it cannot hide behind another
screen. The wallet names the task it paused and returns to it after you approve,
deny, or choose **Review later in Activity**. Technical request identity remains
available without competing with the human outcome and risk summary.

### Tokens & prices

Common tokens (ETH, STRK, USDC, USDT, DAI, WBTC) are auto-detected. Live prices
come from CoinGecko with a 7-day sparkline, and likely spam tokens are filtered
out.

### NFT gallery (collectibles)

> **Currently hidden.** The Collectibles tab, gallery, and NFT indexer setting
> are not shown in this release while the feature is being finished, and the
> wallet fetches no collectible data. An indexer URL saved in an earlier release
> stays stored but unused. The description below covers the
> parked journey.

Add an ERC-721 or ERC-1155 collectible by contract address and token ID. Bramble proves that the active account owns it on-chain before saving it, then
reads the name, image, description, and attributes from the token's `token_uri`
/ `uri`. Automatic discovery is also ownership-checked before an item appears.

### Multisig

Bramble supports the pinned Argent Multisig account contract. You can deploy
a new account or add an existing account by its address and current signer
authority. The wallet verifies the live signer GUIDs and threshold, freezes the
exact Starknet transaction and fee ceiling, and collects signatures from
eligible local or Ledger accounts. Every signer reviews decoded actions, risk
warnings, the full sender, chain ID, nonce, fee ceiling, and transaction hash;
the collaborator note is unsigned context only. Independent signers exchange
the versioned intent package or individual signature fragments; signing and
submission remain disabled unless the fresh on-chain authority exactly matches
the intent and the exact threshold is met. There is no separate on-chain
proposal or confirmation state.

For encrypted Nostr coordination, each participant first saves the other participant's complete
wallet card so the Stark signer key and coordination key stay bound to one contact. The intent owner
chooses **Share securely with co-signers**; the other participant opens the same shared account and
chooses **Check for co-signer updates**. Bramble uses the reviewed relay defaults unless a user
sets **Settings → Network → Advanced endpoints → Multisig coordination relay**. A custom relay
replaces the defaults, so participants must select infrastructure that can receive the same events.
Relay access is one-shot and user initiated; manual copy-and-paste remains available as a fallback.

### Allowance manager

The allowance manager lists **ERC-20 token approvals** submitted through Bramble — from a dApp, a
swap, a privacy-pool deposit, or a multisig you sign for — plus live approvals it can discover
on-chain, and lets you **revoke** one by
setting that spender's allowance to zero. For every approval it tracks, the
wallet re-reads the live on-chain amount, so a listed figure reflects the chain
rather than only what this wallet saw. An allowance a multisig granted is shown
but not revokable here: revocation needs a separately reviewed multisig intent.

An amount shown as **"at least N"** is one the wallet can only bound from below:
part of the allowance was granted somewhere else (or has aged out of the log) and
no on-chain reading was available, so the spender's true reach is N or more.

Two limits are worth knowing. Approvals for tokens you do not track and never
approved here may not appear, so this view is not a complete chain index. And
**NFT collection approvals are not token allowances**: `set_approval_for_all`,
which lets a marketplace move every item you own in a collection, is flagged
loudly on the review screen before you sign but is not listed or revokable here —
revoke it from the marketplace that asked for it. Reviewing detected allowances
periodically limits how much a compromised dApp contract can move.

---

## 3. Safety, FAQ & troubleshooting

### Recovery-phrase hygiene

- Your recovery phrase is the master key. Write it on paper; never photograph it,
  paste it into a website, or store it in cloud notes.
- Bramble never asks for your recovery phrase to "verify" or "sync" anything
  after setup. Any site or message that does is a scam.
- The **vault passphrase** unlocks the wallet on one device only. Losing it means
  re-restoring from the recovery phrase; losing the recovery phrase means the
  funds are unrecoverable.

### Recognising phishing

Bramble flags sketchy sites before you connect: it checks a domain blocklist
and detects lookalike / punycode domains (e.g. a site spoofing a real one with
swapped characters). It also keeps a per-origin connection history so you can see
what you have connected to. If the wallet warns you about a site, stop.

### What "fails closed" means for you

If the wallet's crypto core (Krusty KMS) is unavailable, Bramble **refuses to
act** rather than falling back to a weaker path — onboarding buttons stay
disabled and no wallet is created. There is no local signing fallback. This is
deliberate: the wallet would rather do nothing than do something unsafe with your
keys.

### FAQ

- **I closed the panel mid-setup — did I lose anything?** No. If you had not
  pressed **Finish setup** successfully, no wallet was written. Reopen
  and start again; no draft phrase or passphrase is kept.
- **Why is my new account "not deployed"?** Deployment is a separate on-chain
  step from the dashboard, done when you choose — creating the wallet does not
  spend gas.
- **How do I switch to a testnet?** Use the network selector (Starknet Sepolia or
  Local Devnet). Testnets do not require the real-funds acknowledgement.

### Reporting a security issue

Please report vulnerabilities privately — see the
[security policy](https://github.com/starknet-innovation/mc-wallet/blob/main/SECURITY.md).
Do not open a public issue for a security problem.
