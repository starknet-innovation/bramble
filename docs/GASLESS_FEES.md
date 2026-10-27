---
layout: default
title: Gasless fees (pay gas in other tokens)
permalink: /gasless-fees/
---

# Gasless fees: pay gas in tokens other than STRK

Design for issue #752. Status: **backend shipped, wallet not started**. The contract
below is mc-backend's `docs/INTEGRATION.md` ("Gasless paymaster") and
`src/gateway/gasless.rs`, as deployed by
[mc-backend #55](https://github.com/starknet-innovation/mc-backend/pull/55). The
wallet work is not in this pull request. It stays behind a wallet flag that is off
until that work is reviewed. The backend switches are already on.

## Goal

A user who holds a supported token and no STRK cannot send, swap, or deploy today.
`resolveFeeAffordability` in `packages/features/transactions/src/routing/fee-funds.ts`
compares every fee with the STRK balance alone. This design lets the user pay a
public transaction's network fee in another token through AVNU's hosted SNIP-29
paymaster, reached via the bramble gateway. The approval card shows the fee token
and the maximum.

**In scope:**

- public `invoke` on mainnet, where the forwarder is pinned.

**Out of scope.** These keep paying in STRK, or they are refused outright:

- Sepolia, including `deploy_and_invoke`. The route exists and is not screened,
  and there is no Sepolia forwarder. The wallet does not offer gasless there;
- private STRK20 transactions, which stay on `sponsored_private`;
- sponsored deployment (#431 / #768);
- Argent multisigs and read-only accounts;
- accounts that can only sign SNIP-9 v1;
- mainnet `deploy_and_invoke` while on-demand screening is on. The gateway refuses
  it. A new mainnet account with no STRK still cannot deploy.

## Paymaster

AVNU hosts the SNIP-29 paymaster. The bramble gateway proxies to it: mainnet through
the backend's existing `PAYMASTER_URL`, Sepolia through `SEPOLIA_PAYMASTER_URL`
(`https://sepolia.paymaster.avnu.fi`). That Sepolia host must serve Sepolia, because
the Sepolia route is never screened. The wallet calls the gateway routes below and
does not call those AVNU hosts itself. Supported tokens, prices, the relayer, the
forwarder, the `buildTransaction` response, and relay error codes are AVNU's. The
gateway does not configure a token allowlist: `gas_token` only has to be a non-zero
`0x` address, and AVNU accepts or refuses the token.

Gasless mode is `fee_mode.mode` `default`. The user pays in `gas_token`. AVNU's
relayer submits the transaction and fronts the STRK. The signed calls include the
fee transfer.

The private route is unchanged: `https://wallet.nodes.starknet.org/api/strk20/paymaster`.
`packages/features/privacy/src/config.ts` builds it as `STRK20_GATEWAY_BASE` plus
`/paymaster`, on `DEFAULT_STRK20_NETWORKS.SN_MAIN`. That route still rejects these
methods with `invalid_paymaster_request`. It is the only route that carries the
AVNU API key.

### Routes

Same origin as the wallet gateway (`https://wallet.nodes.starknet.org`), and a
different prefix from `/api/strk20`:

- `POST /api/paymaster/mainnet`
- `POST /api/paymaster/sepolia`

JSON-RPC 2.0, the envelope `rpc` in
`packages/features/privacy/src/paymaster/paymaster-rpc.ts` already posts. The host
permission `https://wallet.nodes.starknet.org/*` in `apps/extension/public/manifest.json`
already covers both paths. No new origin.

The gasless services are `gasless-mainnet` and `gasless-sepolia`. They are separate
from the strk20 `paymaster` service. `DEFAULT_STRK20_NETWORKS` has no Sepolia entry;
the Sepolia gasless URL does not wait on one.

### Accepted calls

| Method | Parameters |
| --- | --- |
| `paymaster_isAvailable` | none |
| `paymaster_getSupportedTokens` | none |
| `paymaster_buildTransaction` | the object below |
| `paymaster_executeTransaction` | same `parameters`; invoke carries `typed_data` and `signature` |

`paymaster_isAvailable` and `paymaster_getSupportedTokens` take no parameters.
`params` may be omitted, `[]`, or `{}`. Anything else is
`400 {"error":"invalid_gasless_request"}`.

`build` and `execute` use the JSON-RPC `params` object `gasless.rs` checks.
`parameters` and `transaction` are the only keys.

`parameters`:

- `version`: the string `0x1`.
- `fee_mode`: exactly `mode` and `gas_token`, plus optional `tip`. `mode` is
  `default`. `gas_token` is a non-zero `0x` address. `tip` is `slow`, `normal`,
  or `fast`, or `{"custom": <u64>}`. Omitting `tip` is valid. `sponsored`,
  `sponsored_private`, a zero or decimal `gas_token`, and any other key (including
  an API key) are `400 {"error":"invalid_gasless_request"}`. The private `feeMode`
  helper in `paymaster.ts` sends `sponsored_private` and stays on that route. Its
  `tip: "normal"` string is a legal gasless tip only when `mode` is `default`.
- `time_bounds`: optional. Absent is valid. `null` is valid, because the relay
  echoes an absent window that way and the client may send that object back. An
  object has exactly `execute_after` and `execute_before`, each a JSON number
  that fits in `u64`, not a `0x` felt and not a string.

`transaction.type` is `invoke` or `deploy_and_invoke`. No other keys.

- `invoke` carries `user_address`, a non-zero `0x` address.
- A build's invoke also carries `calls`, and nothing else. `calls` is a non-empty
  array. Each call is exactly `to`, `selector`, and `calldata`, all `0x` felts.
  `to` is non-zero. `calldata` may be empty. An entrypoint name is rejected.
- An execution's invoke also carries `typed_data` and `signature`, and nothing
  else. `signature` is a non-empty array of `0x` felts. A build that already
  includes `typed_data`, or an execution that still includes `calls`, is a 400.
- `deploy_and_invoke` adds `deployment` with `address`, `class_hash`, `salt`,
  `calldata`, and `version`. `address` is the invoking `user_address`.
  `class_hash`, `salt`, and `calldata` are `0x` felts (`calldata` may be empty).
  `version` is a JSON number from 0 through 255; the gateway's own fixture uses
  `1`. Optional `sigdata` is `null` or an array of `0x` felts.

Build the deployment from `accountDeployment` in
`packages/platform/starknet/src/transactions/deployment.ts`, which throws when the
payload does not reproduce the stored address. Map `contractAddress` to
`address`, `classHash` to `class_hash`, `addressSalt` to `salt`, and
`constructorCalldata` to `calldata`.

A blocklisted `0x` address anywhere in the request, including a quoted call or a
signed `Calls` entry, is `403 {"error":"address_not_allowed"}`. The scan reads
`0x` values only, which is why any other encoding is a 400.

### Sponsor key (shipped)

The AVNU key is attached only to the strk20 `paymaster` service. The gasless
services do not receive it, and `sponsored` / `sponsored_private` on these routes
are refused. The wallet still sends only `default`, and it posts gasless calls
only to the two routes above.

### Execution: SNIP-9 v2 only

`paymaster_executeTransaction` accepts `typed_data` only when it is exactly the
SNIP-9 v2 object AVNU's `buildTransaction` returned. The gateway compares `types`,
`primaryType`, and `domain` for equality, so the wallet passes that object back
unchanged.

`types` is the pinned `starknet` package's `OutsideExecutionTypesV2`: `StarknetDomain`
of shortstrings, `OutsideExecution` with `Calls: Call*`, and `Call` (not
`OutsideCall`) of `To`, `Selector`, `Calldata`.
`primaryType` is `OutsideExecution`. The domain is

```json
{"name": "Account.execute_from_outside", "version": "2", "chainId": "SN_MAIN", "revision": "1"}
```

`chainId` is the shortstring `SN_MAIN` on the mainnet route and `SN_SEPOLIA` on
the Sepolia route. It is not `STARKNET_NETWORKS[id].chainId`. Those felts
(`0x534e5f4d41494e`, `0x534e5f5345504f4c4941`) are what the shortstrings hash to.
A felt, or the other network's shortstring, is
`400 {"error":"invalid_gasless_request"}`, so a mainnet signature cannot be
relayed through the unscreened Sepolia route.

The message has exactly five fields: `Caller`, `Nonce`, `Execute After`,
`Execute Before`, `Calls`. `Calls` is non-empty. Every message value, including
each call's `To`, `Selector`, and `Calldata`, is a `0x` felt string. `Execute After`
and `Execute Before` must also fit in `u64`. Decimal strings, JSON numbers, and
names such as `transfer` are `400 {"error":"invalid_gasless_request"}`. So is
SNIP-9 v1 (revision 0, `StarkNetDomain`, snake_case fields).

The gateway hashes that struct the way the account does: selectors stay raw felts
and are not hashed again as function names, and the domain's version and revision
are the felts 2 and 1. `typedData.getMessageHash` on this v2 object follows that
rule. `outsideExecution.getTypedData` is for the local comparison only.
`CallData.compile` emits decimals, and passing `STARKNET_NETWORKS[id].chainId`
into `getTypedData` puts a felt in `domain.chainId`. Either one is a body the
gateway rejects, even when the hash matches. An account that cannot sign v2 pays
in STRK through `submitInvokeTransaction`.

### Mainnet screening

While on-demand screening is on, a mainnet `paymaster_executeTransaction` is
screened the way an RPC invoke is. Quotes, `paymaster_isAvailable`,
`paymaster_getSupportedTokens`, and every Sepolia call are not screened. The
subject is the signed `user_address`, canonicalized without leading zeros.

Before any paid screening the gateway asks the configured mainnet node whether
`is_valid_signature` accepts the signature over that SNIP-12 hash and whether
`is_valid_outside_execution_nonce` still holds. The signed window must contain
now strictly: `Execute After < now < Execute Before`. That stands in for the RPC
path's simulation. An expired or already-spent signature is not replayed to
screen someone else's wallet.

An account refusal — no contract, no entrypoint, a reverted call, a failed
unspent-nonce check, or a closed window — is
`400 {"error":"invalid_screening_transaction"}`. Any other node error is
`503 {"error":"screening_unavailable"}`. That 503 is retryable: screening did not
finish, and AVNU was not asked to submit.

The other screening outcomes are the RPC path's: `address_not_allowed`,
`screening_denied`, `screening_pending`, and `screening_unavailable`.
`403 {"error":"screening_denied"}` means the account's evidence was not approved.
The denial stands for 24 hours, is not a blocklist entry, and retrying sooner
returns the same answer without a new screening. A mainnet STRK invoke goes
through the same gate, so it is not a way around this denial. The gasless section
names `screening_pending` and does not give it a separate HTTP status; the wallet
keys off `{"error":"screening_pending"}` and treats it as not submitted.

**A mainnet `deploy_and_invoke` execution is
`403 {"error":"screening_subject_unverifiable"}`.** The account is not on chain
yet, so it cannot vouch for its signature. It has to be deployed another way
first. The same call is accepted on Sepolia, which is not screened. A quote of
`deploy_and_invoke` is not an execution and is not refused for this reason.

### Switches, limits, monitoring (shipped)

- `GASLESS_MAINNET_ENABLED` and `GASLESS_SEPOLIA_ENABLED` default on. Each network
  serves unless its variable is `false`. Any value other than `true` or `false`
  stops the gateway at startup. `false` answers `404 {"error":"gasless_disabled"}`
  and does not forward.
- The gasless section defines no per-route quota and no throttle status.
  `docs/INTEGRATION.md` and `gasless.rs` are the contract checked here; neither
  states one. The gateway as a whole sits behind its WAF ceiling and per-client
  application rate limits. The wallet does not hard-code a gasless quota. A
  throttle that is not one of the codes below is not a submitted execution.
- Relay JSON-RPC errors are returned verbatim with HTTP 200. A relay HTTP 4xx
  becomes the code `upstream_rejected`, in the same `{"error"}` body as the other
  refusals. The gasless section does not give that response a status code. Both
  are stated refusals: the relay did not accept the call.
- Monitoring, alarms, and a dashboard are in place in mc-backend. This repo's
  `.github/workflows` does not gain a gasless probe.

## Accounts

The "signs" column is the original mainnet class check. The gateway accepts v2
only, so a class that also signs v1 still builds v2 here.

| Account | Signs | Gasless |
| --- | --- | --- |
| Argent / Ready 0.4.0, including Xverse | v1 and v2 | v2 only |
| OpenZeppelin (`OPENZEPPELIN_ACCOUNT_CLASS_HASH`) | v2 | yes |
| Braavos, current implementation | v2 | yes, once deployed |
| Argent 0.3.0 and 0.3.1 | not established | STRK until v2 is verified |
| Ledger-held accounts of these classes | as the class | same path as the class |
| Argent multisig, read-only | — | out of scope |

Class hashes for the Argent 0.4.0 and Xverse rows live in `ACCOUNT_CLASSES`
(`packages/foundation/wallet-model/src/accounts/account-families.ts`). Bramble's
OpenZeppelin class is `OPENZEPPELIN_ACCOUNT_CLASS_HASH` in
`packages/foundation/wallet-model/src/accounts/accounts.ts`.

An undeployed Braavos stays on `UNDEPLOYED_BRAAVOS_REFUSAL`.
`refuseUndeployedBraavos`, which `submitInvokeTransaction` already calls, is not
bypassed by a gasless `deploy_and_invoke`.

Ledger signs the outside-execution hash, not a transaction hash. Hash with
`typedData.getMessageHash`, then `signHash`. On the extension `signHash` is
`accountHashSigner` (`apps/extension/src/background/ledger/account-hash-signer.ts`),
which is the path `packages/features/privacy/src/sdk/official-sdk-service.ts`
already uses for a private-relay approval. It is a different path from the dapp
`wallet.signTypedData` queue in `apps/extension/src/background/transactions/chain-ops.ts`.

## How the wallet handles each code

Gateway refusals are `{"error":"<code>"}`. `rpc` maps every
`paymaster_executeTransaction` 5xx to `IndeterminateRpcWriteError` and every 4xx
to `STRK20_SUBMISSION_UNAVAILABLE` without reading the body, so a retryable
`503 {"error":"screening_unavailable"}` would look like a lost broadcast. The
gasless poster reads the JSON code, and a JSON-RPC `error` on HTTP 200, which is
how AVNU refuses. An unreadable 4xx body is a determinate refusal. A 400 or 403
on execute must not throw `IndeterminateRpcWriteError`
(`INDETERMINATE_RPC_WRITE_MESSAGE` in `packages/platform/starknet/src/rpc/provider.ts`,
already mapped by `friendly-error-copy.ts`).

- `400 {"error":"invalid_gasless_request"}`: do not retry that body or sign. Nothing was accepted.
- `403 {"error":"address_not_allowed"}`: a blocklisted address is in the request, or screening refused the subject. Tell the user. Do not retry or switch token.
- `403 {"error":"screening_denied"}`: stands for 24 hours and is not a blocklist entry. Do not retry sooner. A mainnet STRK invoke uses the same gate, so it is not a workaround.
- `{"error":"screening_pending"}`: a screening outcome with no HTTP status in the gasless section. Treat it as not submitted.
- `403 {"error":"screening_subject_unverifiable"}`: mainnet `deploy_and_invoke` execution. Tell the user. Do not retry. The gateway would accept it on Sepolia; the wallet does not offer that, because there is no Sepolia forwarder. STRK deploy stays on `submitReviewedAccountDeployment`.
- `400 {"error":"invalid_screening_transaction"}`: the account refused. Do not resubmit that signature. A closed window is a new quote. A spent nonce stops.
- `503 {"error":"screening_unavailable"}`: node error before AVNU. Retry with backoff. Nothing was submitted.
- `404 {"error":"gasless_disabled"}`: that network's switch is off. Hide gasless and pay in STRK.
- HTTP 200 with the relay's JSON-RPC `error`, or `{"error":"upstream_rejected"}`: AVNU refused. Determinate. A new quote is allowed; the same body is not.
- v1-only, multisig, read-only, or an unknown class: do not call the route. Pay in STRK.
- Lost execute answer: timeout, unreadable body, or a 5xx other than `screening_unavailable` after the request was sent. `IndeterminateRpcWriteError`. No blind retry.

Proposed copy, for the approval-copy review, not shipped strings:
`address_not_allowed` "This transaction can't be paid in another token.";
`screening_subject_unverifiable` "Deploying on Mainnet needs STRK.";
`screening_denied` "This transaction wasn't approved."

## Wallet plan

Not implemented here. The private client keeps its route. Gasless is new modules
beside it, plus a branch at the public submit callers.

### Private client stays put

These keep their current behaviour:

- `buildStrk20PaymasterPlan` and `submitStrk20PaymasterPlan`
  (`packages/features/privacy/src/paymaster/paymaster.ts`) stay on
  `sponsored_private`, `apply_action`, and `invoke_and_apply_action`.
- `quoteStrk20RelayPlan` (`relay-quote.ts`) and `resolveStrk20FeeBound`
  (`fee-bound.ts`) stay on the STRK20 pool fee.
- `strk20ConvertedFeeCeiling` stays on that pool fee. Its multiplier is
  `STRK20_FEE_CEILING_MULTIPLIER` (2×) in
  `packages/features/privacy/src/policy/fee-policy.ts`. The public margin is a
  separate decision, below.
- `rpc` stays the private transport, including `PAYMASTER_TIMEOUT_MS`.
  `tests/conformance/paymaster-deadline-order.test.ts` pins that constant under
  the STRK20 gateway deadline. A gasless poster may share the constant and the
  response size bound. It must not change the constant, and it must not use
  `rpc`'s 5xx rule.

`paymaster.ts` is already near the 500-line file budget. Gasless does not grow
it. New modules live next to `packages/features/privacy/src/paymaster/`. Felt
checks go through `canonicalFelt` in
`packages/foundation/wallet-model/src/networks/networks.ts`. The private
`paymasterCall` helper normalizes call felts to `0x`, and a public caller that
reuses that idea uses its own error: a public send must not surface
`STRK20_SUBMISSION_UNAVAILABLE`.

### Flag and URLs

A per-network wallet flag, off by default. It is independent of
`GASLESS_MAINNET_ENABLED` and `GASLESS_SEPOLIA_ENABLED`. Those default on; the
wallet still does not call the routes until its own flag is on.

Constants next to `STRK20_GATEWAY_BASE` in `packages/features/privacy/src/config.ts`:

- `https://wallet.nodes.starknet.org/api/paymaster/mainnet`
- `https://wallet.nodes.starknet.org/api/paymaster/sepolia`

### Quote, verify, sign

1. `paymaster_isAvailable`, then `paymaster_getSupportedTokens`, with no
   parameters. The token list is that result, parsed fail-closed the way
   `isQuoteFee` refuses an unknown quote. Leave `FEE_KEYS` on the private quote.
   A failure here hides gasless; STRK still works.
2. `paymaster_buildTransaction` with the call shape above, `version` `0x1`, and
   `fee_mode.mode` `default`.
3. A v2-only check in front of `bindPaymasterTypedData`
   (`paymaster-typed-data.ts`), which today accepts v1 and numbers
   (`isJsonNumberish`). Require the typed-data object in the contract above,
   including the route's chain shortstring. `typedData.getMessageHash` on AVNU's
   body must equal `outsideExecution.getTypedData` rebuilt from the user's calls
   plus one fee transfer. Sign only on a match. Execute sends AVNU's object, not
   the rebuild.
4. Read the calls with `outsideExecutionCalls` (the v2 `Calls` branch). Accept
   the quote only when they are the user's calls plus one fee transfer, in the
   chosen token, to the reviewed forwarder, within the quoted maximum and the
   independent ceiling.
5. The mainnet forwarder is confirmed as
   `0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f`.
   Adrien confirmed that address; it is also the Caller and the fee recipient
   in the gateway's mainnet hash fixture. There is no Sepolia forwarder, so the
   wallet does not offer gasless on Sepolia and those fees stay on STRK. Do not
   take a recipient from the quote in place of the pin.
6. The ceiling uses `PriceService.getPrices`
   (`packages/features/portfolio/src/tokens/prices.ts`) against
   `estimateInvokeApprovalFee`
   (`apps/extension/src/background/approvals/invoke-fee-review.ts`), not AVNU's
   price. No price means that token is not offered. The refusal must not say
   "strk20".
7. `isPaymasterAuthorizationLive` must see a live window before signing, with
   the ten-second floor `signedPublicInvoke` uses. The gateway's check is the
   strict window above.
8. Sign as `official-sdk-service.ts` does: `typedData.getMessageHash`, then
   `signHash`. Execute sends AVNU's typed data and that signature.

### Affordability and the approval card

`resolveFeeAffordability` compares a `FRI` fee with the STRK balance and returns
`"unknown"` for any other unit. STRK behaviour stays byte-for-byte the same. A
gasless fee is the chosen token's base units, so the predicate takes a token or
gains a sibling. Send calls it from
`packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-submit.ts`.

STRK stays the default. Another token is offered when the paymaster lists it, the
account holds enough, and a price exists. The wallet never switches token by
itself. Proposed: offer another token only when STRK is short.

`formatFeeEstimate`, `estimatedFeeText`, and `reviewFeeSection` in
`packages/presentation/wallet-ui/src/sidepanel/shared/review-render.ts` render
`FRI` through `formatFri`. A token maximum is formatted in that token.
`shell-bindings.ts` carries the "Maximum network fee" line. Proposed copy, for
the approval-copy review: "Network fee: up to 1.20 USDC".

`requiredFeeReview` (`apps/extension/src/background/transactions/fee-review.ts`)
returns a `FeeEstimate`. A token amount stays out of `reviewedFee`, so the
ceiling check inside `submitInvokeTransaction` cannot compare it as STRK.

### Where submission branches

`submitInvokeTransaction` (`packages/platform/starknet/src/rpc/rpc-submit.ts`)
signs `account.execute`, pays STRK, and deploys an undeployed account first via
`ensureAccountDeployed` (`packages/platform/starknet/src/transactions/deployment.ts`).
Gasless is a separate submit function. The signature is typed data, and there is
no STRK resource bound.

Public invokes reach `submitInvokeTransaction` from:

- `submitErc20Transfer` in `packages/platform/starknet/src/rpc/rpc.ts` (sends);
- `apps/extension/src/background/provider/provider-ops.ts` (dapp invokes);
- `apps/extension/src/background/transactions/swap-ops.ts`;
- `apps/extension/src/background/portfolio/allowance-ops.ts`;
- `apps/extension/src/background/portfolio/nft-transfer-submit.ts`.

When the reviewed choice is gasless, those callers use the new function. The
card stays `reviewFeeSection`, so each of them can show the token maximum
without a second fee renderer.

### Deploy and invoke

Not offered. Mainnet executions are `screening_subject_unverifiable`. Sepolia
has no pinned forwarder, so that deploy stays on STRK too. The gateway would
accept a Sepolia `deploy_and_invoke`; the wallet does not send one.

`accountDeployment` supplies the address, class hash, salt, and constructor
calldata. The request uses the deployment object in the contract above, with
`version` `1`, the number in the gateway's fixture, and never a value above 255.
Mainnet does not offer the call. The gateway accepts a mainnet quote of that
type and refuses the execution; the wallet offers neither. A mainnet deploy that
the user can pay in STRK stays on
`submitReviewedAccountDeployment`
(`apps/extension/src/background/accounts/deployment-ops.ts`) and
`submitAccountDeployment`.

`recordAutoDeployment` records a separate `DEPLOY_ACCOUNT` under
`DEPLOY_ACTIVITY_SUMMARY`. `failedSubmissionDeployment` recovers that hash when
the following invoke fails. A gasless `deploy_and_invoke` is one transaction and
has no such hash. Activity records that one hash.

### Activity

`ActivityEntry.feePaid` (`packages/features/transactions/src/activity/activity-entry.ts`)
is a `TransactionFee` (`FRI` or `WEI`) filled from the receipt by `readReceiptFee`
(`packages/platform/starknet/src/rpc/transaction-fee.ts`). On a paymaster
transaction that fee is the relayer's STRK. Storing it in `feePaid` would count
the relayer's STRK as the user's and drop the token they paid.

Record the signed fee transfer (token and amount) on the row
`recordSubmittedActivity` writes
(`apps/extension/src/background/transactions/activity-recording.ts`). Receipt
reconciliation leaves that row alone. Activity summaries are load-bearing for
dedup, so a gasless row gets its own summary naming the fee token, and every
test that matches on summaries moves with it.

## Security review

The change touches signing, so it gets an independent non-Anthropic review before
the wallet flag turns on. The review covers:

- a quote that adds calls, changes the token or the recipient, or inflates the fee;
- typed-data substitution and replay across networks or accounts, including a v1
  body, a decimal felt, or the other network's chain shortstring;
- a price that pushes the fee past the reviewed maximum;
- a client sending `sponsored` or `sponsored_private`, or posting to the strk20
  paymaster URL (the gateway refuses this; the wallet still must not send it);
- a `deploy_and_invoke` whose deployment address is not the invoke `user_address`;
- a mainnet `deploy_and_invoke` sent where screening returns
  `screening_subject_unverifiable`;
- storing the receipt's STRK fee as the user's token fee.

## Rollout

1. The gateway is live on both networks. The switches default on.
2. Wallet implementation behind the flag, still off. QA is mainnet `invoke`.
   Sepolia stays on STRK until a forwarder is pinned.
3. The mainnet flag enables `invoke` only, for as long as screening refuses
   `deploy_and_invoke`.
4. The flag turns on in a reviewed release. Release notes name the tokens
   `paymaster_getSupportedTokens` returned then.

## Open questions

- Which of AVNU's tokens the wallet offers. The list is
  `paymaster_getSupportedTokens`. It is no longer a proposal of STRK, USDC, and ETH
  for SNF to configure.
- The price-ceiling margin. Proposed: 20% over the independent price. Reusing
  `STRK20_FEE_CEILING_MULTIPLIER` (2×) would be a separate decision.
- Whether another token is offered when the user has enough STRK, or only when
  STRK is short. Proposed: only when short.
- A new mainnet account with no STRK. Gasless deploy cannot cover it while
  screening is on. Sponsored deployment (#768) is the other open path, and it is
  out of scope here.
- Whether Argent 0.3.0 and 0.3.1 can sign SNIP-9 v2. Until that is checked they
  pay in STRK.

## Backend asks, and where they landed

The route, the sponsor-key split, the `GASLESS_*_ENABLED` pause switch, Sepolia,
and monitoring are shipped and described above. The integration contract defines
no gasless-specific quota; the gateway keeps its WAF ceiling and per-client
limits. Tokens, prices, the forwarder, the relayer, and the response shape are
AVNU's. `paymaster_getSupportedTokens` is the token list.
