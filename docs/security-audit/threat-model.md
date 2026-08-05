---
layout: default
title: Threat model
permalink: /security-audit/threat-model/
---

# Threat model

## Security objectives

1. A website cannot read seed phrases, private keys, vault plaintext, signatures, or data granted
   to another origin.
2. A website cannot reach privileged wallet operations or cause a state-changing Starknet action
   without the required origin grant and explicit user approval.
3. The side panel shows the user the same transaction, typed data, chain, fees, and account that
   will be signed.
4. Locked or invalid wallet state fails closed.
5. Stored secret material remains confidential and authenticated against local storage tampering.
6. Builds contain only reviewed packaged code and pinned artifacts.

## Assets

- Seed phrase and imported/derived private keys.
- STRK20 viewing keys, private note state, proof intent, and dapp-scoped sub-account commitments.
- Vault passphrase-derived encryption state and decrypted vault contents.
- Unlock session capability.
- User approvals and origin-to-account permissions.
- Transaction, declaration, deployment, multisig, and typed-data signing intent.
- Network, account, and class-hash configuration.
- Chrome Web Store and release credentials.
- Auditability of the source-to-package path.

## Adversaries

- A malicious or compromised website running arbitrary page JavaScript.
- A compromised legitimate dapp origin.
- Malformed or adversarial RPC, token, NFT, price, swap, discovery, prover, paymaster, or
  phishing-feed responses.
- Another extension or local process attempting storage or message tampering.
- A supply-chain attacker targeting dependencies, vendored KMS/contract artifacts, CI, or releases.
- A user who is socially engineered into approving misleading content.

## Trust boundaries

```text
untrusted web page
    |
    | window.postMessage
    v
injected provider (page world)
    |
    | window.postMessage
    v
content script (isolated world)
    |
    | chrome.runtime messaging
    v
background service worker (privileged router)
    |
    +--> approval UI / side panel
    +--> permissioned and encrypted storage
    +--> Krusty KMS WASM
    +--> pinned Starknet Privacy SDK
    +--> Starknet and external HTTPS services
```

The page, every message payload, every sender claim, browser storage, and every network response
are treated as untrusted until parsed at their boundary. The background service worker and packaged
extension pages are privileged but remain subject to confused-deputy and stale-session risks.

## Primary review questions

- Can a page forge the source, origin, request ID, response, or wallet message type?
- Does every privileged handler reject content-script and foreign-extension senders by default?
- Is approval bound to the exact account, network, payload, and origin executed afterward?
- Can a lock, restart, navigation, or race reuse stale authority?
- Can malformed storage or RPC data select a different key, calldata, class hash, or recipient?
- Can dynamic text or remote metadata reach an executable DOM sink?
- Can remote data alter executable behavior?
- Can privacy warnings, service routing, fee actions, or proofs bypass review or target a
  non-configured contract?
- Can a build or release include an undeclared file or unpinned input?
