---
layout: default
title: Gasless fees (pay gas in other tokens)
permalink: /gasless-fees/
---

# Gasless fees: pay gas in tokens other than STRK

Design for issue #752, built in
[#784](https://github.com/starknet-innovation/bramble/pull/784). Mainnet is on.
The wallet code is `packages/features/transactions/src/gasless/`. It is not part
of the privacy paymaster.

## Goal

A public send or a dapp invoke can pay its network fee in a token other than
STRK when that account is short on STRK. STRK stays the default. The fee goes
through a SNIP-29 paymaster behind the Starknet Foundation wallet gateway. The
review shows the token and the maximum on a **Pay up to** button, and that
button submits.

**In scope:**

- a deployed account's public `invoke` on mainnet: Send, and a dapp invoke.

**Out of scope.** These stay on STRK:

- Sepolia: there is no forwarder, and `GASLESS_FEES_ENABLED.SN_SEPOLIA` is false;
- `deploy_and_invoke`: the wallet does not build one. An undeployed account is
  not quoted, and a gasless submit after the account is no longer deployed is
  refused with "Deploying on Mainnet needs STRK.";
- swap, NFT send, and allowance revoke;
- private STRK20 and sponsored deployment (#431 / #768);
- Argent multisig, read-only, unknown classes, Argent 0.3.0 and 0.3.1, and
  every Braavos account.

## Gateway contract (wallet side)

The wallet posts JSON-RPC to:

- `POST https://wallet.nodes.starknet.org/api/paymaster/mainnet`
- `POST https://wallet.nodes.starknet.org/api/paymaster/sepolia` (unused while
  Sepolia is off)

The existing host permission `https://wallet.nodes.starknet.org/*` covers both.
The wallet never sends `sponsored` or `sponsored_private` fee modes on these
routes, and needs no API key.

### Requests

`paymaster_isAvailable` and `paymaster_getSupportedTokens` take no parameters.
The token list's prices are ignored.

`paymaster_buildTransaction` and `paymaster_executeTransaction` take a `params`
object whose only keys are `parameters` and `transaction`. The account address
is `transaction.invoke.user_address`; a top-level `userAddress` is refused.

`parameters`:

- `version`: `0x1`.
- `fee_mode`: `mode` `default` and `gas_token`, with no `tip`.
- `time_bounds`: `execute_after: 1` and `execute_before` ten minutes on
  (`GASLESS_MAX_WINDOW_SECONDS`, 600), as JSON numbers. A longer window is
  refused before signing.

A build's invoke is `user_address` plus a non-empty `calls` array of `to`,
`selector`, and `calldata`, all `0x` felts. Execute sends `user_address`, the
paymaster's `typed_data` unchanged, and the signature.

### Typed data

The wallet signs only SNIP-9 v2 outside executions: the pinned `starknet`
package's `OutsideExecutionTypesV2`, primary type `OutsideExecution`, domain
`Account.execute_from_outside` version `2` revision `1`, and `chainId` the
shortstring `SN_MAIN`.

It signs only when `outsideExecutionCalls` reads exactly the user's calls plus
one `transfer` of the chosen token to the pinned forwarder, with
`Caller` equal to the forwarder; the amount is within both the paymaster's
quoted maximum and the wallet's ceiling; the window is live and within ten
minutes; and the SNIP-12 hash matches one rebuilt locally from those terms.

### Refusals

Gateway refusals are `{"error":"<code>"}`; relay errors come back as JSON-RPC
errors. On execute, only `invalid_gasless_request`, `address_not_allowed`,
`screening_denied`, `screening_unavailable`, and `gasless_disabled` (with no
result beside them) mean nothing was submitted. Every other execute answer,
including a malformed reply, a timeout, or a reply with no transaction hash, is
status unknown (`IndeterminateRpcWriteError`). `screening_unavailable` is
retried before it is shown.

## Wallet

### Config

`gasless-config.ts` holds the routes, the flag, and the forwarder. Callers read
`gaslessRoute` and `gaslessRouteReady`; a missing forwarder or a false flag
refuses the path.

```text
GASLESS_FEES_ENABLED.SN_MAIN = true
GASLESS_FEES_ENABLED.SN_SEPOLIA = false
```

The mainnet forwarder is
`0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f`, checked on
chain: it keeps the fee it is owed, pays it to its fee recipient, and refunds
the rest to the account in the same transaction. Sepolia has none
(`GASLESS_FORWARDER_ADDRESS.SN_SEPOLIA` is `null`).

### Fee and ceiling

The signed transfer is the paymaster's suggested maximum, about three times its
own estimate. The forwarder refunds the unused part, so the user pays the actual
fee; "Pay up to" is the most they can pay.

`gaslessFeeCeiling` in `gasless-ceiling.ts` caps that maximum at 7/2 of an
independent reference, rounded up: what the reviewed STRK estimate is worth in
the fee token, from `PriceService` prices, never the paymaster's. No price, or a
stale one, hides the token. This is not `STRK20_FEE_CEILING_MULTIPLIER` (2×).
At submit, a re-quote above the reviewed amount is refused.

### Who is offered a token

`quoteGaslessOffers` runs only when STRK is short, the route is ready, and
`accountSignsGaslessV2` is true: Argent 0.4.0 (including Xverse) and
OpenZeppelin (`OPENZEPPELIN_ACCOUNT_CLASS_HASH`). At most three offers
(`MAX_GASLESS_OFFERS`); STRK is never one. A paymaster token is offered only
when it matches a held curated token by address and decimals.

The Send review and the dapp approval card render
`Pay up to ${amount} ${symbol}` (`review-render.ts`); that control submits.
Leaving it unclicked submits in STRK. A refused gasless choice never falls back
to STRK on its own. A send's offers are held in the background and consumed
once; the side panel can only name one of them.

### Lost replies

Before execute is posted, the outside-execution nonce and the signed fee are
written to Activity's signed-for-relay list and read back; if that fails,
nothing is posted. A lost reply leaves that row, and the nonce view marks it
used or expired.

### Copy

- `address_not_allowed` and `screening_denied`: "This account can't pay the network fee in another token."
- `screening_pending`: "The network fee check is still pending. Nothing was submitted."
- `screening_subject_unverifiable`: "Deploying on Mainnet needs STRK."
- `screening_unavailable`: "The network fee could not be checked. Nothing was submitted."
- `gasless_disabled`, and a route or class that cannot sign: "Paying the network fee in another token is unavailable."
- a quote the wallet cannot check: "This token's network fee could not be checked."
- `above_ceiling`, `invalid_gasless_request`, `invalid_screening_transaction`,
  `upstream_rejected`, and an unrecognised code: "This network fee quote was refused. Nothing was submitted."

## Verification

Handler tests drive a send and a dapp approval through the real handlers with
the route on and the gateway mocked
(`tests/background/transactions/gasless-handler-e2e.test.ts`,
`gasless-approval-e2e.test.ts`). Fetch cannot leave the process.

`bun run test:mainnet` (`scripts/gasless-mainnet-e2e.ts`) is opt-in and not part
of `bun run check` or CI; setup is in `docs/GASLESS_MAINNET.md`. On 28 October
2026 it ran on mainnet: transaction
`0x3419215ccbdd7c7fbfa641eabb64e57e84d89a1eb3204198f3514b48f94860b` sent 7078
USDC base units to the forwarder, which refunded 1846, so the fee was 5232
units (about $0.005). The account's STRK balance did not change.

## Follow-ups

- The mainnet script still asserts the balance drops by the full signed
  amount; it should expect the refund.
- `setGaslessReviewHooksForTests` ships in the background bundle; move it to a
  test-only module.
- Offers are quoted (address and calls sent to the gateway) before the user
  chooses another token.
- A flag-on background test from review through to the Activity row.
- Braavos could be offered again once its rows are tracked: its current class
  has a single SNIP-9 v2 nonce map.

## Decisions that are closed

- The ceiling is 7/2 of the independent reference; the refund makes the
  signed maximum safe to show as "Pay up to".
- The choice control is a Pay up to button that submits.
- Another token is offered only when STRK is short.
- The mainnet forwarder is the address above. Sepolia has none.
