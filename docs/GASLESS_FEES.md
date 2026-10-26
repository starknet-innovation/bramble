---
layout: default
title: Gasless fees (pay gas in other tokens)
permalink: /gasless-fees/
---

# Gasless fees: pay gas in tokens other than STRK

Design and requirements for issue #752. Status: **proposed**. Nothing here is built yet. The
wallet work ships behind a flag that is off until the backend requirements below are met.

## Goal

A user who holds USDC or ETH but no STRK can't send, swap, or even deploy their account today.
The affordability check compares every fee against the STRK balance alone
(`packages/features/transactions/src/routing/fee-funds.ts`, `resolveFeeAffordability`). This
design lets the user pay a public transaction's network fee in another supported token through
SNF's own paymaster, with the fee token and its maximum shown on the approval card.

**In scope:**
- public `invoke` transactions;
- `deploy_and_invoke` for an account that isn't deployed yet, so a new user with no STRK can
  deploy and act in one step.

**Out of scope:**
- private (STRK20) transactions, which already use the paymaster in `sponsored_private` mode;
- sponsored deployment (#431 / #768);
- Argent multisigs.

## The paymaster

SNF runs [`starknet-innovation/paymaster`](https://github.com/starknet-innovation/paymaster), a
fork of AVNU's open-source SNIP-29 paymaster that is identical to upstream. It has a "gasless" fee
mode, `default`, in which the user pays gas in a token from the server's `supported_tokens`. The
paymaster's relayer submits the transaction, and the user's signed calls include the fee transfer.

What the source shows (verify on the deployed version):
- **Methods:** `paymaster_isAvailable`, `paymaster_getSupportedTokens`,
  `paymaster_buildTransaction`, `paymaster_executeTransaction`
  (`crates/paymaster-rpc/src/lib.rs`).
- **Gasless needs no API key.** Only `sponsored` and `sponsored_private` validate one
  (`crates/paymaster-rpc/src/endpoint/validation/mod.rs`, `check_is_allowed_fee_mode`).
- **Accepted tokens are server configuration.** Any other token is refused with
  `TokenNotSupported` (`check_is_supported_token`).
- **`deploy_and_invoke` is built in gasless mode.** Only a bare sponsored `deploy` takes a
  separate path (`crates/paymaster-rpc/src/endpoint/build.rs`).
- **Execution is SNIP-9 outside execution:** `execute_from_outside` (v1) or
  `execute_from_outside_v2` (v2), chosen from the account class
  (`crates/paymaster-starknet/src/transaction/version.rs`).

Account support, checked against Mainnet classes:

| Account | Outside execution | Notes |
| --- | --- | --- |
| Argent / Ready 0.4.0 | v1 and v2 | Includes the Xverse build |
| OpenZeppelin (Bramble's class) | v2 | |
| Braavos (current implementation) | v2 | |
| Ledger-held accounts of these classes | as above | Signed through the existing typed-data path (`accountHashSigner`) |
| Argent multisig | — | Out of scope |

## Backend requirements (owner: Adrien)

Today the wallet reaches the paymaster only through the gateway at
`https://wallet.nodes.starknet.org/api/strk20/paymaster`, and only for private relays. The gateway
answers `invalid_paymaster_request` to `paymaster_isAvailable` and
`paymaster_getSupportedTokensAndPrices` (checked 2026-10-26). Gasless needs the following.

1. **A route for gasless public transactions.** Accept `paymaster_isAvailable`,
   `paymaster_getSupportedTokens`, `paymaster_buildTransaction` and
   `paymaster_executeTransaction` for transaction types `invoke` and `deploy_and_invoke` with
   fee mode `default` only. Keep today's private routes unchanged.
2. **Never let a client request sponsorship on this route (security-critical).** The server
   validates an API key for `sponsored` and `sponsored_private`, and the gateway holds the key
   that today's private relays need. If the gateway attaches that key to a gasless-route request,
   a client could ask for `sponsored` and have SNF pay its gas. On the gasless route the gateway
   must:
   - reject any `fee_mode` other than `default`;
   - not attach the sponsor key at all.
   Sponsored deployment (#768) gets its own reviewed route later.
3. **Supported tokens.** Configure `supported_tokens` for Mainnet and Sepolia. Proposed: STRK,
   USDC, ETH (owner to confirm). `paymaster_getSupportedTokens` must return them with prices, and
   the price oracle must be healthy.
4. **Relayer exposure and limits.** Confirm what the relayer loses if a transaction reverts or a
   fee transfer fails, and set per-client rate limits and a pause switch for the route. The user
   pays in gasless mode, but the relayer fronts the STRK.
5. **Sepolia first.** The same route on the Sepolia gateway, for wallet testing.
6. **Monitoring.** Add the gasless route to `.github/workflows/gateway-health.yml` (a cheap
   `paymaster_isAvailable` probe) and to the gateway's own dashboards.
7. **Contract details to share with the wallet team:** the forwarder address per network, the
   exact `buildTransaction` response shape (typed data, fee token, fee amount, maximum), and the
   error codes for refused tokens, unsupported accounts and paused routes.

## Wallet requirements

The wallet treats every paymaster answer as untrusted, as it already does for private relays.
Most of the client exists in `packages/features/privacy/src/paymaster/`:
- the transport (`paymaster-rpc.ts`);
- the typed-data rebuild and hash check (`paymaster-typed-data.ts`);
- fee bounds (`fee-bound.ts`);
- frozen relay quotes (`relay-quote.ts`).

1. **Flag.** A per-network flag, off by default, enabled only once the gasless route is live.
2. **Affordability by token.** `resolveFeeAffordability` takes a fee token. STRK behaviour stays
   byte-for-byte the same.
3. **Fee-token choice on review.** STRK stays the default. Other tokens are offered only when the
   paymaster supports them and the account holds enough. The wallet never switches token
   silently. When STRK is short and another token works, the review says so and offers it.
4. **Quote, rebuild, verify.** Rebuild the SNIP-9 typed data locally from the user's exact calls.
   Accept the quote only when:
   - the calls are exactly the user's calls plus **one** fee transfer;
   - that transfer is in the chosen token, to the paymaster's forwarder;
   - its amount is within the quoted maximum.
   Sign only on a hash match. Refuse a quote that adds, reorders or changes any call.
5. **Independent price ceiling.** Admit a non-STRK fee only under a ceiling derived from an
   independent price source: the wallet's existing price feed, with a margin. Refuse when no
   price is available, as `fee-bound.ts` already does.
6. **Approval card.** Show the fee token and the maximum fee, e.g. "Network fee: up to 1.20
   USDC". Copy goes through owner review.
7. **Deploy and invoke.** For an undeployed account, offer `deploy_and_invoke`. The deployment
   data must reproduce the stored address exactly, as #768 does for sponsored deploys.
8. **Lost replies.** A broadcast whose reply is lost is "submission unknown": amber, check
   Activity, no blind retry. This reuses the private-relay rules.
9. **Activity.** Record the fee paid in the chosen token and keep it out of STRK fee totals.
10. **Account gating.** Offer it only for the classes in the table above. Never offer it to a
    read-only account or a multisig.

## Security review

The change touches signing, so it gets an independent non-Anthropic security review before merge.
Threats it must address:
- a compromised or buggy paymaster quoting extra calls, a different token or recipient, or an
  inflated fee;
- typed-data substitution and replay across networks or accounts;
- price manipulation pushing the fee past the user's expectation;
- the sponsorship bypass in backend requirement 2;
- deploy-and-invoke address substitution.

## Rollout

1. Backend route on Sepolia, then the wallet flag on Sepolia for QA.
2. Mainnet route, with the flag still off.
3. Turn the flag on in a reviewed release, with release notes naming the supported tokens.

## Open questions

- Final token list per network (proposed: STRK, USDC, ETH).
- The price-ceiling margin (proposed: 20% over the independent price).
- Whether to suggest another token when the user has enough STRK, or only when STRK is short
  (proposed: only when short).
