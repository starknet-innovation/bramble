---
layout: default
title: STRK20 privacy integration
permalink: /strk20-privacy/
---

# STRK20 privacy integration

MC Wallet implements the Wallet API `0.10.4-rc.0` STRK20 surface through the official Starknet
Privacy SDK browser bundle. It supports shielded balance discovery, action preparation, private
submission, and dapp-scoped sub-account commitments.

## Pinned runtime

The source revision and emitted bundle digest are both pinned. Run:

```bash
bun run vendor:privacy
bun run check:privacy
```

Only the checked browser bundle is copied to `dist/vendor/starknet-privacy/`; the SDK's npm build
tree is not packaged. The extension imports this bundle only from its own origin under the MV3
content-security policy.

## Required network configuration

Each enabled network needs one complete public configuration:

- Discovery Service URL implementing `/health`, `/v1/history`,
  `/v1/sync/incoming_state`, `/v1/sync/outgoing_state`, and
  `/v1/sync/preflight_check`.
- Transaction Prover URL implementing `starknet_specVersion` and
  `starknet_proveTransaction`.
- STRK20 pool and sub-account anonymizer contract addresses.
- Optional OHTTP relay URL.
- Optional private paymaster/relayer URL and its pool fee token.

These values contain no credentials and live in normal preferences. An extension cannot protect a
shared service secret, so authenticated deployments must put authentication behind a
wallet-controlled relay. Partial routing is rejected; an unconfigured network fails closed.

## Privileged data flow

1. The content/provider bridge strictly parses bounded actions, token lists, proof envelopes, and
   dapp-scoped sub-account requests. A connected origin sees only its granted active account.
2. Private balance reads, proof preparation (including simulation), and sub-account commitments
   each create a dedicated approval. The queue retains the exact private request and exposes only
   review summaries plus an account/network/payload digest. Denial returns `USER_REFUSED_OP`;
   account, network, grant, or payload changes invalidate the request.
3. Only after approval does the background lazily derive a domain-separated viewing key through
   Krusty from the selected account's encrypted signing key. The key is never persisted, logged,
   or returned through a browser message. Keyless Ledger accounts cannot currently use STRK20 and
   fail closed.
4. The SDK performs note discovery, transaction assembly, and proving. `USER_LINKAGE` warnings map
   to the Wallet API privacy-leak error; every other non-empty or malformed warning fails closed.
5. Before an invoke approval appears, the wallet validates private balances, rejects a
   deposit/withdraw correlation, requests and freezes the relayer fee action and any typed data,
   verifies the configured fee token, and checks that the combined user spend plus fee is
   affordable. No proof or signature is produced before approval.
6. After approval, the wallet repeats the balance checks, asks the SDK to prove the exact frozen
   action batch plus fee action, requires the configured pool's `apply_actions` call, signs any
   frozen outside-execution typed data, and submits once through the configured private paymaster.
   The SDK signer binds account, chain, and complete call set using the protocol SNIP-12 hash.

The Wallet API allows a dapp to submit the result of `wallet_strk20PrepareInvoke`; therefore a
non-simulated prepare request does not sign or generate that submittable proof until the user
approves its exact action list. Private balances and the deterministic, origin-scoped sub-account
commitment are likewise never disclosed under the general account connection grant alone.

Registration is not performed silently. If the privacy account has not been registered, the
wallet returns the Wallet API `NOT_REGISTERED` error so the caller can drive an explicit,
reviewable registration flow.

The generic `wallet_addInvokeTransaction` path also preserves an optional prepared proof. Such a
request must contain exactly one call, receives the normal decoded approval review, and can submit
only a non-empty proof to the configured pool's `apply_actions` entry point. The proof and call are
included in the approval digest and are never silently converted into an ordinary public invoke.

## Failure and trust boundaries

The wallet has no fallback proving, discovery, signing, or direct public broadcast for built-in
STRK20 action submission. SDK, discovery, prover, paymaster, OHTTP, RPC, and contract responses are
untrusted and validated at their boundaries. Unknown or malformed privacy warnings, an unexpected
fee token, insufficient fee balance, a mismatched pool or entry point, an empty proof, a changed
approval context, or unavailable services all fail closed.

The upstream SDK and remote service implementations are external trust dependencies. Their pinned
artifact integrity and wallet-facing behavior are checked here; their internal cryptography and
production deployments require their own audits and operations monitoring.

## Operator checklist

- Supply Discovery Service, Transaction Prover, pool, and anonymizer values for each network.
- Supply a private paymaster/relayer and fee token to enable submission.
- Put credentials, quotas, and abuse controls behind a wallet-owned HTTPS relay; never add a shared
  API key to the extension.
- Supply an OHTTP relay when the prover deployment requires it.
- Verify service health and network/contract alignment before enabling the configuration.
- Run `bun run check`, `bun run build`, `bun run test:e2e`, and `bun run package:extension`.

Fixture tests intentionally use no real vault, private notes, signing material, hardware, or
production service. Live interoperability testing therefore requires operator-provided service
URLs and deployed contract addresses.
