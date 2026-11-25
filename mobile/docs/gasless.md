# Gasless and sponsored transactions

Paying a send's network fee in another token, and showing the rows a sponsor or a token paid
for. The extension's `transactions/src/gasless/` and `background/transactions/gasless-*.ts`, ported
to wallet-core as P14 and exported in `v0.8.0` (`TransferPlan::gasless_offers`, `GaslessFee`).
The apps add no rule of their own: they move the paymaster's bytes and draw what the core decides.

## What the person sees

- **Send review.** When the review finds the account's STRK short of the fee
  (`affordability == .insufficient`, the existing shortfall line), the Cost box lists up to three
  more controls under that line, one per token the core offers: "Pay up to 1.25 USDC" (the
  extension's `cost.fee.payUpTo`). The amount is the most the signed execution can take, as the
  core checked it against the wallet's own prices. Confirm stays as it is: it still sends with STRK.
- **Choosing a token** sends the transfer through the wallet gateway's paymaster instead of
  Confirm. The journey goes through the same working screen and outcome screens as any send.
- **After the relay accepts it**, the journey reads the transaction's status once through the
  core (`refreshActivity`), so it ends on "Send complete" or "Confirmation pending" like any send;
  "Check confirmation" reads it again.
- **Refused** (the route, the account, the paymaster or the core's check said no): "Transaction
  not sent" with "The transaction was not sent. " and the core's sentence, such as "This network
  fee quote was refused. Nothing was submitted.". A choice made against an older review (a retried
  estimate, a second tap) reads the extension's "The fee changed while you were reviewing. Check
  it and submit again.".
- **Lost** (the execute's answer could not be read): "Status unknown" and the core's sentence
  ("Transaction submission status is unknown. Check activity and on-chain state before
  retrying."), with View activity and Back, not Try again, as the extension's unknown outcome
  offers no re-send.
- **Activity.** A sponsored row's "Network fee" reads "Sponsored"; a gasless row's reads the fee
  it signed in the token ("0.42 USDC"), and its summary names it. Both come from
  `activityFeeText` and the row's stored summary; neither app formats them.

Mainnet only: `GASLESS_POLICY` turns Sepolia off (no forwarder), so the core offers nothing there.

## How it runs

```
review (TransferPlan) ──gaslessOffers(prices, balances, now)──▶ GaslessOffers{fee, step}
  step: Post ──perform──▶ fee.acceptOfferReply ──▶ … ──▶ Done(offers)       (offer round)
tap "Pay up to …" ──fee.choose(offer, prices, now)──▶ Post | Wait | Submitted
  Post ──perform──▶ fee.acceptSubmitReply(outcome, now)   (the core signs inside, after its check)
  Wait(delayMs) ──sleep──▶ fee.resume()                    (posts again only if still unlocked)
  Submitted(hash, explorerUrl) ──▶ refreshActivity(hash) ──▶ the usual outcome
```

- `GaslessDriver` (`ios/Bramble/Send/GaslessDriver.swift`,
  `android/.../send/GaslessDriver.kt`) is the whole host half: it sleeps the delays the core asks
  for and moves each `HttpRequest` through `BoundedHttp` (HTTPS only, no redirects, size and time
  bounds). It never reads a reply.
- The journey's half is `SendFlowModel`'s gasless extension (iOS, in `SendFlowModel.swift`) and
  `send/SendGasless.kt` (Android): `offerGasless` after each review, `payFee`, and `watch`.
- **Prices** are the wallet's own USD answer for STRK and the network's tokens, from the portfolio
  `PriceBook` (`gaslessPrices`): served from cache when fresh, else fetched once into the cache
  (iOS also writes `prices.json` then; Android leaves that to the next price refresh). No price,
  no offer: the core hides a token it cannot price, and `choose` refuses one priced too long ago.
- **Balances** are the host's last read of the network's tokens, by address; an unread one is
  passed as unread and the core skips it.
- The offer round only starts when the review already shows the shortfall, so an ordinary send
  makes no paymaster or price request.

## What the core enforces (not restated here)

- Offers only for a reviewed, unpoisoned, single ERC-20 transfer whose STRK is short of an FRI
  fee, on a deployed account whose class signs SNIP-9 v2, with no other signed execution pending.
- The gateway's outside execution is checked against the reviewed call, the fee transfer, the
  ceiling (7/2 of the reference) and the window before the core signs its hash; the signature
  never leaves Rust except inside the execute.
- `choose` is single use: it closes the STRK plan, so Confirm can never also send it. A second
  choice, an offer the round did not make, or a choice after a new estimate is `NotFound`.
- The row is filed before the execute is posted (`INVOKE_NOT_JOURNALED` refuses otherwise), under
  the signed message's hash with the execution's nonce and deadline (`relay`); the relay's answer
  settles it to the transaction hash. Such a row is never observed by status reads
  (`activityNeedsObservation`) and blocks a second gasless offer until its deadline.
- A screening repeat for the execute is a `Wait`: the core re-checks the session before posting.

## Copy

All strings are generated (`scripts/mobile-send-copy.ts` → `SendCopy`): `payUpTo` from
`cost.fee.payUpTo`, `feeMoved` from the friendly-error table, `statusUnknownTitle` from
`send.failure.title.unknown`. Refusal and loss sentences are the core's. No string is retyped.

## Not here

- **Sponsored deploy and sponsored shield** (`privacy/src/paymaster/sponsored-*.ts`) belong to the
  STRK20 paymaster and P15; the core exports neither. Mobile shows their rows if a vault carries
  them, and nothing starts one.
- **The "Signed for relay" dock** (`relay-rows.ts`) lists messages signed for a dapp; mobile signs
  none (P16).
- A relay row awaiting its hash links its signed message's hash to the explorer like any row; the
  core's row appearance does not yet drop that link (flagged for wallet-core).

## Tests

No test reaches a paymaster: the drivers run over a scripted `PortfolioTransport`.

- iOS `GaslessDriverTests`, Android `GaslessDriverTest`, over a scripted `GaslessFee`
  (`GaslessFeeProtocol` / `GaslessFeeInterface`): the offer round posting each request and
  ending on the core's offers, a refused round offering nothing, a choice ending on the relay's
  hash, a `Wait` resumed through the core (and a lock then posting nothing), an unoffered choice
  sending nothing, refusal and loss keeping the core's sentence, and the "Pay up to" label.
- Not covered: the model and screens end to end. A real `GaslessFee` needs a Mainnet review and
  a paymaster whose replies pass the core's checks; G7h's replies are bound to their own accounts
  and clock, so no UI test drives one.
- The core's own suites (`gasless_parity.rs`, `gasless_journal.rs`, `gasless_reads_parity.rs`)
  replay G7h's fixture (`core/tests/fixtures/extension-gasless.jsonl`) against the extension.
