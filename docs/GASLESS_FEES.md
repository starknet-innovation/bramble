---
layout: default
title: Gasless fees (pay gas in other tokens)
permalink: /gasless-fees/
---

# Gasless fees: pay gas in tokens other than STRK

Design for issue #752. Status: **backend shipped, wallet not started**. The contract
below is what [mc-backend #55](https://github.com/starknet-innovation/mc-backend/pull/55)
deployed ("Add gasless paymaster routes for public transactions"). The wallet work
is not in this pull request. It stays behind a wallet flag that is off until that
work is reviewed. The backend switches are already on.

This revision could not read mc-backend `INTEGRATION.md`. The codes below are the
ones named with the #55 deployment. If `INTEGRATION.md` disagrees, it wins, and the
wallet parser should be locked to that file before it hard-codes a status or a JSON
shape.

## Goal

A user who holds a supported token and no STRK cannot send, swap, or deploy today.
`resolveFeeAffordability` in `packages/features/transactions/src/routing/fee-funds.ts`
compares every fee with the STRK balance alone. This design lets the user pay a
public transaction's network fee in another token through AVNU's hosted SNIP-29
paymaster, reached via the bramble gateway. The approval card shows the fee token
and the maximum.

**In scope:**

- public `invoke` on mainnet and Sepolia;
- `deploy_and_invoke` on Sepolia, so a new Sepolia account with no STRK can deploy
  and act in one step.

**Out of scope.** These keep paying in STRK, or they are refused outright:

- private STRK20 transactions, which stay on `sponsored_private`;
- sponsored deployment (#431 / #768);
- Argent multisigs and read-only accounts;
- accounts that can only sign SNIP-9 v1;
- mainnet `deploy_and_invoke` while on-demand screening is on. The gateway refuses
  it. A new mainnet account with no STRK still cannot deploy.

## Paymaster

AVNU hosts the SNIP-29 paymaster. The bramble gateway proxies to it: mainnet through
the backend's existing `PAYMASTER_URL`, Sepolia through
`https://sepolia.paymaster.avnu.fi`. The wallet calls the gateway routes below and
does not call those AVNU hosts itself. Supported tokens, prices, the relayer, the
forwarder address, and the `buildTransaction` response shape are AVNU's. SNF does
not configure them.

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
| `paymaster_executeTransaction` | same object; execution is the returned typed data |

`build` and `execute` use the same JSON-RPC `params` nesting as
`buildStrk20PaymasterPlan`: `parameters` carries `version`, `fee_mode`, and any
`time_bounds`; `transaction` carries `type` plus the invoke, and the deployment
when the type is `deploy_and_invoke`.

- `version`: `0x1`.
- `fee_mode`: `mode` `default`, `gas_token` a `0x` felt, optional `tip`. Omit
  `tip`. The private `feeMode` helper in `paymaster.ts` sends `sponsored_private`
  and `tip: "normal"`, and it stays on that route.
- `time_bounds`: optional. Omit them unless a reviewed wallet change sets the
  window itself. Every value in them is a `0x` felt.
- transaction `type`: `invoke` or `deploy_and_invoke`.

A deployment deploys the invoking `user_address`. Build it with `accountDeployment`
in `packages/platform/starknet/src/transactions/deployment.ts`, which throws when
the payload does not reproduce the stored address. The deployment address and the
invoke `user_address` are that address.

Anything else is `400 invalid_gasless_request`. That includes `sponsored`,
`sponsored_private`, `paymaster_getSupportedTokensAndPrices`, revision 0 typed
data, a decimal or named felt, and a deployment of any other address.

A blocklisted address is `403 address_not_allowed`.

### Sponsor key (shipped)

The AVNU key is attached only to the strk20 `paymaster` service. The gasless
services do not receive it, and `sponsored` / `sponsored_private` on these routes
are refused. The wallet still sends only `default`, and it posts gasless calls
only to the two routes above.

### Execution: SNIP-9 v2 only

`paymaster_executeTransaction` accepts an outside execution only when it is the
SNIP-9 v2 body AVNU's `buildTransaction` returned:

- SNIP-12 revision 1. In this repo that is `TypedDataRevision.ACTIVE`, the v2
  branch of `packages/features/transactions/src/routing/outside-execution-terms.ts`.
- Domain name `Account.execute_from_outside` (`OUTSIDE_EXECUTION_DOMAIN` in that
  file), version 2.
- Domain chain `SN_MAIN` on the mainnet route and `SN_SEPOLIA` on the Sepolia
  route. Those are `STARKNET_NETWORKS.SN_MAIN.chainId` (`0x534e5f4d41494e`) and
  `STARKNET_NETWORKS.SN_SEPOLIA.chainId` (`0x534e5f5345504f4c4941`).
- Five message fields: `Caller`, `Nonce`, `Execute After`, `Execute Before`,
  `Calls`. Those are the v2 names the private parser and `outsideExecutionCalls`
  already read.
- Every value a `0x` felt.

Revision 0, any other schema, and decimal, numeric, or named values are `400`.
An account that cannot sign v2 pays in STRK through `submitInvokeTransaction`.
The wallet does not call the gasless route for it.

The body that goes to `paymaster_executeTransaction` is AVNU's typed data, after
the local hash matches. `outsideExecution.getTypedData` can emit a decimal or a
shortstring that hashes the same and still draws a 400, so the wallet does not
submit that rewrite. A body that is not already this shape is a refused quote.

### Mainnet screening

While on-demand screening is on, a mainnet `paymaster_executeTransaction` is
screened the way an RPC invoke is. The subject is the signed `user_address`.

The gateway checks that the signed Execute After / Execute Before window contains
now, then makes one batched `starknet_call` of `is_valid_signature` (the result
must be `VALID`) and `is_valid_outside_execution_nonce`. That happens before AVNU
is asked to submit.

An account refusal — no contract, no entrypoint, a revert, a spent nonce, a
closed window — is `400 invalid_screening_transaction`. Any other node error is
`503 screening_unavailable`. That 503 is retryable: screening did not finish, so
nothing was submitted. Other screening failures use the same codes as a screened
RPC invoke. This repository does not branch on those codes in the public invoke
path. Confirm the list in `INTEGRATION.md`. Until the client knows that list, an
unrecognised screening code is a determinate refusal: no retry, and no lost-write
marker.

**Mainnet `deploy_and_invoke` is `403 screening_subject_unverifiable`.** The
account does not exist yet, so screening has no subject. A new mainnet account
cannot deploy gaslessly while screening is on. The same call works on Sepolia.

### Switches, limits, monitoring (shipped)

- `GASLESS_MAINNET_ENABLED` and `GASLESS_SEPOLIA_ENABLED` default on. A disabled
  network answers `404 gasless_disabled`.
- Rate limit: 20 requests per minute per IP per network. The HTTP status for that
  limit was not in the summary available here. Back off, and confirm the status
  in `INTEGRATION.md` before hard-coding it. An execute is retried on that
  response only once the status is known to mean the gateway refused before
  forwarding.
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

`rpc` in `paymaster-rpc.ts` is the wrong classifier for these codes. On
`paymaster_executeTransaction` (`BROADCAST_PAYMASTER_METHOD`) every 5xx becomes
`IndeterminateRpcWriteError`, and every 4xx becomes
`WalletError(STRK20_SUBMISSION_UNAVAILABLE)` with the body unread. A gasless
`503 screening_unavailable` would then look like a lost broadcast. The gasless
poster reads the status and the code first. The strk20 gateway in this repo
answers `{ error: code }` from `reject` in `apps/terminal/api/_lib/security.ts`;
confirm that shape against `INTEGRATION.md` before locking the parser. An
unreadable body on a 4xx is a determinate refusal.

- **`400 invalid_gasless_request`.** The body is outside the contract above.
  Determinate: the wallet does not retry that body and does not sign. On execute,
  nothing was accepted.
- **`403 address_not_allowed`.** The address is blocklisted. Tell the user. The
  wallet does not retry and does not switch token on its own. STRK stays available
  when the STRK balance covers the fee.
- **`403 screening_subject_unverifiable`.** Mainnet `deploy_and_invoke` for an
  account that does not exist yet. Tell the user. The wallet does not retry that
  call. Sepolia is unaffected. A STRK deploy still goes through
  `submitReviewedAccountDeployment`.
- **`400 invalid_screening_transaction`.** The account refused the execution.
  Determinate: the wallet does not resubmit that signature. A closed window is a
  new quote. A spent nonce stops.
- **`503 screening_unavailable`.** A node error during screening, before AVNU.
  Retry with backoff. Nothing was submitted.
- **Other screening codes.** The same codes as a screened RPC invoke. Determinate
  refusal until `INTEGRATION.md` lists them. No retry, and no lost-write marker.
- **`404 gasless_disabled`.** That network's switch is off. Hide gasless and pay
  in STRK.
- **v1-only, multisig, read-only, or an unknown class.** A v1 execution would be a
  400. The wallet does not call the route. Pay in STRK.
- **Rate limit, 20 per minute per IP per network.** The HTTP status was not in the
  summary available here. Back off. Until that status is confirmed to be a refusal
  from before AVNU was called, the wallet does not automatically retry an execute.
- **Lost execute answer.** A timeout, an unreadable body, or a 5xx other than
  `screening_unavailable`, after the request was sent.
  `IndeterminateRpcWriteError` with `INDETERMINATE_RPC_WRITE_MESSAGE`. No blind
  retry.

Proposed copy, for the approval-copy review, not shipped strings:

- `address_not_allowed`: "This account can't pay the network fee in another token."
- `screening_subject_unverifiable`: "Deploying on Mainnet needs STRK."

`INDETERMINATE_RPC_WRITE_MESSAGE` lives in `packages/platform/starknet/src/rpc/provider.ts`.
The panel already maps that sentence through
`packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy.ts`.
A 400 or a 403 on execute must not throw `IndeterminateRpcWriteError`.

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

1. `paymaster_isAvailable`, then `paymaster_getSupportedTokens`, both with no
   parameters. The token list is that method's result. Parse it fail-closed, the
   way `isQuoteFee` refuses an unknown quote. Leave the private `FEE_KEYS` list
   on the private quote. A failure here hides gasless; STRK still works.
2. `paymaster_buildTransaction` for the user's calls, with `version` `0x1` and
   `fee_mode.mode` `default`.
3. A v2-only check in front of `bindPaymasterTypedData`
   (`paymaster-typed-data.ts`). That function accepts v1
   (`domain.version === "1"`) and numbers (`isJsonNumberish`). Gasless rejects
   both before it hashes. Require revision 1, `OUTSIDE_EXECUTION_DOMAIN`, version
   2, the route's chain felt, and the five v2 message fields.
   `typedData.getMessageHash` on AVNU's body must equal the hash of
   `outsideExecution.getTypedData` rebuilt from the user's calls plus the one fee
   transfer. Sign only on a match.
4. Read the calls with `outsideExecutionCalls`
   (`packages/features/transactions/src/routing/outside-execution-calls.ts`), the
   v2 branch (`Calls`). Accept the quote only when those calls are the user's
   calls plus one fee transfer: the chosen token, the reviewed forwarder, and an
   amount within the quoted maximum and the independent ceiling. A quote that
   adds, reorders, or changes a call is refused.
5. The forwarder is AVNU's. Pin it per network as a reviewed constant. A
   recipient taken only from the quote would accept a substituted payee. The
   address itself is an open input.
6. The ceiling uses `PriceService.getPrices`
   (`packages/features/portfolio/src/tokens/prices.ts`) against the STRK estimate
   from `estimateInvokeApprovalFee`
   (`apps/extension/src/background/approvals/invoke-fee-review.ts`). It does not
   use AVNU's price. No price means that token is not offered. Wording is the
   public equivalent of `STRK20_FEE_UNVERIFIABLE`, and it does not say "strk20".
7. `isPaymasterAuthorizationLive` must still see a live window before the
   signature is sent, with the ten-second floor `signedPublicInvoke` uses. The
   gateway repeats the window check and returns
   `400 invalid_screening_transaction` when it is closed.
8. Sign the way `official-sdk-service.ts` signs a relay approval:
   `typedData.getMessageHash`, then `signHash`. `paymaster_executeTransaction`
   sends AVNU's typed data and that signature.

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

Sepolia only, and only while the Sepolia wallet flag is on.

`accountDeployment` supplies the payload. Mainnet does not offer the call. A
mainnet deploy that the user can pay in STRK stays on
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
  body, a decimal felt, or the other network's chain felt;
- a price that pushes the fee past the reviewed maximum;
- a client sending `sponsored` or `sponsored_private`, or posting to the strk20
  paymaster URL (the gateway refuses this; the wallet still must not send it);
- a `deploy_and_invoke` whose deployment address is not the invoke `user_address`;
- a mainnet `deploy_and_invoke` sent where screening returns
  `screening_subject_unverifiable`;
- storing the receipt's STRK fee as the user's token fee.

## Rollout

1. The gateway is live on both networks. The switches default on.
2. Wallet implementation behind the flag, still off. QA on Sepolia, including
   `deploy_and_invoke`.
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
- AVNU's forwarder address on each network, pinned before the fee-transfer check
  is strict.
- A new mainnet account with no STRK. Gasless deploy cannot cover it while
  screening is on. Sponsored deployment (#768) is the other open path, and it is
  out of scope here.
- The rate-limit HTTP status, and the JSON body of the error codes, against
  mc-backend `INTEGRATION.md`.
- Whether Argent 0.3.0 and 0.3.1 can sign SNIP-9 v2. Until that is checked they
  pay in STRK.

## Backend asks, and where they landed

These were the open asks. They are shipped, or they are no longer ours to set.

1. **Route.** The two `POST /api/paymaster/*` routes. Private routes unchanged.
2. **Sponsor key.** Separate services. The key stays on the strk20 paymaster
   service. Sponsored modes are refused.
3. **Pause switch.** `GASLESS_MAINNET_ENABLED` / `GASLESS_SEPOLIA_ENABLED`,
   default on. `404 gasless_disabled` when off.
4. **Rate limit.** 20 requests per minute per IP per network.
5. **Monitoring.** In place in mc-backend, with alarms and a dashboard.
6. **Sepolia.** Shipped, and it is where `deploy_and_invoke` works while mainnet
   screening is on.
7. **Token list, prices, forwarder, relayer, response shape.** AVNU's.
   `paymaster_getSupportedTokens` is the token list. The relayer fronts STRK;
   what it loses on a revert is AVNU's exposure.
