---
layout: default
title: Gasless fees (pay gas in other tokens)
permalink: /gasless-fees/
---

# Gasless fees: pay gas in tokens other than STRK

Design for issue #752. Status: **built in
[#784](https://github.com/starknet-innovation/bramble/pull/784)**. Mainnet is on.
The independent security review is still pending. The gateway contract is
mc-backend `docs/INTEGRATION.md` ("Gasless paymaster") and `src/gateway/gasless.rs`,
shipped in [mc-backend #55](https://github.com/starknet-innovation/mc-backend/pull/55).
The wallet code is `packages/features/transactions/src/gasless/`. It is not part
of the privacy paymaster.

## Goal

A public send or a dapp invoke can pay its network fee in a token other than
STRK when that account is short on STRK. STRK stays the default. The fee goes
through AVNU's hosted SNIP-29 paymaster, reached via the bramble gateway. The
review shows the token and the maximum on a **Pay up to** button, and that
button submits.

**In scope:**

- a deployed account's public `invoke` on mainnet: Send, and a dapp invoke.

**Out of scope.** These stay on STRK:

- Sepolia. The route exists and is not screened. There is no forwarder, and
  `GASLESS_FEES_ENABLED.SN_SEPOLIA` is false;
- mainnet `deploy_and_invoke`. The wallet does not build one. An undeployed
  mainnet account is not quoted, and a gasless submit after the account is no
  longer deployed is refused with "Deploying on Mainnet needs STRK.";
- swap, NFT send, and allowance revoke;
- private STRK20 (`sponsored_private`), sponsored deployment (#431 / #768);
- Argent multisig, read-only, unknown classes, Argent 0.3.0 and 0.3.1, and an
  undeployed Braavos account.

## Gateway

AVNU hosts the paymaster. Mainnet is proxied through `PAYMASTER_URL`. Sepolia is
proxied through `SEPOLIA_PAYMASTER_URL` (`https://sepolia.paymaster.avnu.fi`),
and that route is never screened. The wallet posts to:

- `POST https://wallet.nodes.starknet.org/api/paymaster/mainnet`
- `POST https://wallet.nodes.starknet.org/api/paymaster/sepolia`

The host permission `https://wallet.nodes.starknet.org/*` already covers both.
The private route stays `/api/strk20/paymaster`. The AVNU key is attached only
there. Gasless services are `gasless-mainnet` and `gasless-sepolia`. They refuse
`sponsored` and `sponsored_private`.

Supported tokens, prices, the relayer, and the `buildTransaction` response are
AVNU's. The gateway does not keep a token allowlist. `gas_token` has to be a
non-zero `0x` address. The wallet ignores AVNU's price.

Gateway refusals are `{"error":"<code>"}`. Relay JSON-RPC errors come back on
HTTP 200. A relay HTTP 4xx becomes `upstream_rejected`. The gasless section does
not give that response a status, and it does not define a gasless quota. The
gateway keeps its WAF ceiling and per-client limits.

`GASLESS_MAINNET_ENABLED` and `GASLESS_SEPOLIA_ENABLED` default on. Each network
serves unless its variable is `false`. Any other value stops the gateway at
startup. `false` is `404 {"error":"gasless_disabled"}` and does not forward.
Those switches are not the wallet flag.

### Accepted calls

`paymaster_isAvailable` and `paymaster_getSupportedTokens` take no parameters.
`params` may be omitted, `[]`, or `{}`.

`paymaster_buildTransaction` and `paymaster_executeTransaction` take a `params`
object whose only keys are `parameters` and `transaction`. A top-level
`userAddress` is `400 {"error":"invalid_gasless_request"}`. The account address
lives on `transaction.invoke.user_address`.

`parameters`:

- `version`: `0x1`.
- `fee_mode`: `mode` `default` and `gas_token`. The wallet sends no `tip`. The
  gateway fills `normal`. `slow`, `fast`, and `{"custom": <u64>}` are also
  legal. `sponsored` and `sponsored_private` are not sent.
- `time_bounds`: `execute_after` and `execute_before` as JSON numbers. The
  wallet sends `execute_after: 1` and `execute_before` ten minutes on
  (`GASLESS_MAX_WINDOW_SECONDS`, 600). Omitting the bounds comes back as a
  one-hour window, which this wallet refuses. A string timestamp is a 400.
  `null` is what the relay echoes when the client omitted them.

`transaction.type` is `invoke` or `deploy_and_invoke`. This wallet builds
`invoke` only.

- A build's invoke is `user_address` plus a non-empty `calls` array. Each call
  is `to`, `selector`, and `calldata`, all `0x` felts. `calldata` may be empty.
- An execution's invoke is `user_address`, `typed_data`, and a non-empty
  `signature`. Execute sends the paymaster's typed data unchanged, and a fresh
  `default` fee mode. It does not echo the build's `parameters`.
- A deployment, which this wallet does not send, would be `address` equal to
  `user_address`, `class_hash`, `salt`, `calldata`, numeric `version` from 0
  through 255, and optional `sigdata`.

A blocklisted `0x` address anywhere in the request is
`403 {"error":"address_not_allowed"}`.

### Typed data

Execute accepts `typed_data` only in the SNIP-9 v2 shape AVNU returned. `types`
is the pinned `starknet` package's `OutsideExecutionTypesV2` (`Call`, not
`OutsideCall`). `primaryType` is `OutsideExecution`. The domain is
`Account.execute_from_outside`, version `2`, revision `1`, and `chainId` the
shortstring `SN_MAIN` or `SN_SEPOLIA`. Those shortstrings hash to
`STARKNET_NETWORKS[id].chainId`. The felt itself in the JSON is a 400, as is
the other network's shortstring.

The message has `Caller`, `Nonce`, `Execute After`, `Execute Before`, and a
non-empty `Calls`. Every message value is a `0x` felt. `Execute After` and
`Execute Before` fit in `u64`. Decimal strings, JSON numbers, names such as
`transfer`, and SNIP-9 v1 are a 400.

The wallet accepts that body only when `outsideExecutionCalls` reads the user's
calls plus one fee transfer to the pinned forwarder, the amount is within the
quoted maximum and the ceiling, and `typedData.getMessageHash` matches
`outsideExecution.getTypedData` rebuilt with the shortstring chain. The posted
body is the paymaster's object. `CallData.compile` decimals are not posted.

### Mainnet screening

While on-demand screening is on, a mainnet `paymaster_executeTransaction` is
screened like an RPC invoke. Quotes, availability, the token list, and every
Sepolia call are not. The subject is the signed `user_address`.

Before any paid screening the gateway checks `is_valid_signature` over the
SNIP-12 hash and `is_valid_outside_execution_nonce`. The window is strict:
`Execute After < now < Execute Before`. An account refusal is
`400 {"error":"invalid_screening_transaction"}`. Any other node error is
`503 {"error":"screening_unavailable"}`, which is retryable because AVNU was
not asked to submit.

`403 {"error":"screening_denied"}` stands for 24 hours and is not a blocklist
entry. A mainnet STRK invoke uses the same gate. `screening_pending` is named
and has no status in the gasless section. A mainnet `deploy_and_invoke`
execution would be `403 {"error":"screening_subject_unverifiable"}`. The wallet
does not send that execution.

## Wallet

### Config

`packages/features/transactions/src/gasless/gasless-config.ts` holds the routes,
the flag, and the forwarder. `gaslessRoute` and `gaslessRouteReady` are what
callers read. A missing forwarder or a false flag refuses the path.

```text
GASLESS_FEES_ENABLED.SN_MAIN = true
GASLESS_FEES_ENABLED.SN_SEPOLIA = false
```

Mainnet is on by the product owner's decision, with the security review still
open. Sepolia is off because it has no forwarder.

The mainnet forwarder is
`0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f`. Adrien
confirmed it. It is also the Caller and the fee recipient in the gateway's
hash fixture. `GASLESS_FORWARDER_ADDRESS.SN_SEPOLIA` is `null`.

### Ceiling

`gaslessFeeCeiling` in `gasless-ceiling.ts` is 7/2 of an independent reference,
rounded up. The reference is what the reviewed STRK estimate is worth in the
fee token, from `PriceService` prices, not from the paymaster. No price, or a
stale price, hides the token. This is not `STRK20_FEE_CEILING_MULTIPLIER` (2×).

7/2 replaced a 20% band. The paymaster's suggested maximum, which is the signed
amount, runs about three times its own estimate (7644 against 2548 on the
observed quote). A 6/5 ceiling would refuse that maximum. On the 28 October
2026 mainnet run the quote was 7078 base units and the ceiling was 9737.

### Who is offered a token

`quoteGaslessOffers` runs only when STRK is short, the route is ready, and
`accountSignsGaslessV2` is true. That is Argent 0.4.0 (including Xverse),
OpenZeppelin (`OPENZEPPELIN_ACCOUNT_CLASS_HASH`), and a deployed Braavos account
whose live class is the current implementation. At most three offers
(`MAX_GASLESS_OFFERS`). STRK is never one of them.

A paymaster token is offered only when the wallet already knows it: same
address and decimals as a held curated token. A padded registry address is not
a valid offer. strkBTC is on the paymaster's list and is not offered, because
it is not in the curated registry.

The Send review and the dapp approval card render
`Pay up to ${amount} ${symbol}` in `review-render.ts`. That control submits the
gasless invoke. A separate non-submitting token picker was not adopted. Leaving
the button unclicked submits in STRK. A refused gasless choice does not fall
back to STRK on its own.

### Errors

`GaslessRefusal` in `gasless-errors.ts` is a stated refusal. Nothing was
accepted. `screening_unavailable` is the retryable one, after the poster's own
retries. A lost execute reply is `IndeterminateRpcWriteError`, not one of these.
Shipped sentences:

- `address_not_allowed` and `screening_denied`: "This account can't pay the network fee in another token."
- `screening_pending`: "The network fee check is still pending. Nothing was submitted."
- `screening_subject_unverifiable`: "Deploying on Mainnet needs STRK."
- `screening_unavailable`: "The network fee could not be checked. Nothing was submitted."
- `gasless_disabled`, and a route or class that cannot sign: "Paying the network fee in another token is unavailable."
- a quote the wallet cannot check: "This token's network fee could not be checked."
- `above_ceiling`, `invalid_gasless_request`, `invalid_screening_transaction`,
  `upstream_rejected`, and an unrecognised code: "This network fee quote was refused. Nothing was submitted."

On execute, only a refusal that means the relay was not asked is treated as
nothing submitted. Any other execute answer is status unknown.

## Verification

Handler tests drive a send and a dapp approval through the real handlers with
the flag on and the gateway mocked
(`tests/background/transactions/gasless-handler-e2e.test.ts`,
`gasless-approval-e2e.test.ts`). The user picks USDC from Pay up to. The build
is fee mode `default`, an invoke, with numeric `time_bounds`, and no top-level
`userAddress`. Signing is SNIP-9 v2. For a reference of 5000 the ceiling is
17500, and 17501 is refused. Fetch cannot leave the process.

`bun run test:mainnet` (`scripts/gasless-mainnet-e2e.ts`) is opt-in. It is not
part of `bun run check` or CI. With no account it prints a skip and exits 0.
Setup is in `docs/GASLESS_MAINNET.md` on the implementation branch. The call is
a 1-base-unit transfer of the fee token back to the same account.

On 28 October 2026 that path was run on mainnet. Transaction
`0x3419215ccbdd7c7fbfa641eabb64e57e84d89a1eb3204198f3514b48f94860b` succeeded
in block 17070534. The account sent 7078 USDC base units to the pinned
forwarder and received 1846 back. The fee kept was 5232 units, about $0.005.
The 0.0924 STRK network fee was paid by the paymaster relayer, not the user.

## Still open

The mainnet flag is on with these gaps:

- no independent security review yet;
- Pay up to is still shown on Send when the recipient is a lookalike;
- a lost reply may not leave a pending Activity row;
- the forwarder approval is not in the allowance log;
- the forwarder class and owner are not verified on-chain.

## Decisions that are closed

- The ceiling is 7/2, not 20%.
- The choice control is a Pay up to button that submits.
- Another token is offered only when STRK is short.
- The mainnet forwarder is the address above. Sepolia has none, so that
  network stays on STRK.
