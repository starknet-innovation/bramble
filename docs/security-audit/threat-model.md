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
- STRK20 viewing keys, private note state, proof intent, and dapp-scoped shadow-account commitments.
- The record of which sites an account drove shadow accounts through (origin, label, anonymizer,
  exact nonces), and the funds those shadow accounts hold. Only this wallet, deriving the
  origin-bound scope, can move what a site leaves in one.
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
Persistent and session Chrome storage are explicitly restricted to trusted extension contexts.
Secret-bearing vault fields are additionally authenticated and encrypted; a retained Ledger STRK20
viewing key is treated as privacy-sensitive even though it cannot authorize a spend, and remains in
the v4 `accountSecrets` collection only. The v12 `shadowAccountScopes` collection is privacy-
sensitive the same way: it names the sites someone used privately, lives only in the encrypted
vault (never preferences, activity, logs, or session storage), crosses only to the privileged
Shadow accounts screen, and is recorded before a shadow-account request runs so that a failed
write stops the request instead of leaving an account the wallet cannot find again. Plaintext
activity never holds a scope's label or nonce: a sweep is recorded as the generic "Sweep shadow
account", and a site's own private transaction keeps the line every site-submitted transaction
has always recorded, "<site> submitted a private transaction (N actions)", which names the site
but not the scope. Reading a
scope's shadow accounts or balances sends its partial commitment and addresses to the RPC
provider, which can link them, so it runs only on the user's request. A dapp's shadow-account
request on a network with no anonymizer is held on a close-only notice and given its refusal only
when the user closes it; a notice left to expire answers as any expired approval does ("request
rejected"), so a site cannot silently probe whether private services are set up. A request whose
scope the full record table cannot take is held on the same notice, for the same reason. (A configured
anonymizer still costs a pool quote before an invoke's card is queued, so a fast quote failure is
a timing signal that one is configured.)

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
- Can a shadow-account action run through an anonymizer other than the one the card named, or
  without its scope recorded, or can a site read or probe the scope records?
- Can a build or release include an undeclared file or unpinned input?

## Executable test coverage

This map is maintained with the threat model. Paths name the adversarial check that must fail if
the corresponding boundary regresses; the scheduled nightly workflow also runs the high-severity
dependency audit.

| Threat / review question | Named executable coverage |
| --- | --- |
| Forged source, origin, request ID, response, or message type | `tests/background/routing/privileged-messages.test.ts`; `tests/property/security-boundaries.test.ts` — “never accepts one site's sender as another claimed origin” |
| Privileged handlers reached from a page or foreign extension | `tests/background/routing/key-boundary.test.ts`; `tests/background/routing/privileged-messages.test.ts` |
| Approval differs from executed account, network, payload, origin, or fee | `tests/background/approvals/background-invoke-approval.test.ts`; `tests/background/reviewed-fee-binding.test.ts` |
| Lock, restart, navigation, race, duplicate, or replay reuses authority | `tests/background/session-auto-lock-privilege.test.ts`; `tests/background/routing/background-messages.test.ts` — “failed claimed approval is terminal”; `tests/background/approval-queue-bounds.test.ts` |
| Malformed storage or RPC data changes a key, call, class hash, or recipient | `tests/property/security-boundaries.test.ts` — vault, message, felt, and Krusty properties; `tests/starknet/starknet-rpc-assets.test.ts` |
| Dynamic text or metadata reaches an executable DOM sink | `scripts/check-file-standards.ts`; `tests/conformance/shared-helper-single-source.test.ts` |
| Remote metadata changes executable behavior | `tests/background/portfolio/background-nft-discovery.test.ts`; `tests/background/portfolio/token-ops-addtoken-spam.test.ts` |
| Shadow-account scope runs unrecorded, under another anonymizer, or leaks to a site | `tests/background/privacy/strk20-shadow-scope-recording.test.ts`; `tests/background/strk20-shadow-account-origin-binding.test.ts` — “refuses to execute under an anonymizer other than the one the card named”; `tests/background/privacy/strk20-shadow-account-lifecycle.test.ts`; `tests/background/privacy/strk20-anonymizer-precheck.test.ts`; `packages/platform/vault/tests/schema/schema-v12.test.ts` |
| Privacy route, fee, proof, or pool bypasses exact review | `tests/background/strk20-shadow-account-sdk-boundary.test.ts`; `tests/background/privacy/strk20-wallet-preparations.test.ts`; `tests/background/strk20-vault-sign-lock-revocation.test.ts` |
| Build or release admits undeclared or unpinned input | `tests/scripts/workflow-action-pinning.test.ts`; `tests/scripts/vendor-execution-policy.test.ts`; `tests/scripts/krusty-package-provenance.test.ts`; `tests/conformance/release-version-single-source.test.ts` |

The dapp-reachable negative corpus explicitly covers hostile and overflowing calldata in
`tests/property/security-boundaries.test.ts` and
`tests/provider/bridge/provider-bridge-results-guards.test.ts`, origin spoofing in
`tests/background/provider/add-chain-ops-sender-mismatch.test.ts`, and duplicate/replayed approvals
in `tests/background/approval-queue-bounds.test.ts` and
`tests/background/routing/background-messages.test.ts`.
