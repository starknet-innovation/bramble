# Mobile swap (M20)

Status: screens on wallet-core `v0.7.0` (X4, wallet-core #109). The core owns the swap; the apps
own the screens, the store wiring and the tests.

## What the core does

`WalletCore.prepareSwap(accountId, sellTokenId, buyTokenId, amount, tokens)` returns a `TokenSwap`,
one quote's worth of state that runs each step once, in order:

| Step | Export | What the app does |
| --- | --- | --- |
| Quote | `quoteRequest()` → `acceptQuote(outcome, prices)` | Performs the GET over `PortfolioTransport`, hands back the `HttpOutcome` and the portfolio's `PriceView` (the value check) |
| Build | `buildRequest(slippage: nil)` → `acceptBuild(outcome)` | Performs the POST; gets `SwapReview` (call lines, enforced minimum, risk flags) |
| Plan | `plan(feeBalance)` | Runs the `TransferPlan` with `SendDriver`, exactly as a send |

The core pins AVNU's base URL and router per network (`SWAP_POLICY`), judges every reply as
hostile, and refuses a build that approves anything but the exact sell amount to the pinned router,
calls any other contract, pays another account, or promises less than the reviewed floor. The app
never builds, edits or forwards a call. A refusal ends that `TokenSwap`; the next quote is new.

## Screens

iOS `Screens/Swap/SwapView.swift` and `SwapReviewSection.swift` over `Swap/SwapFlowModel.swift`;
Android `swap/SwapScreen.kt` over `swap/SwapFlowModel.kt`. Entry points, as the extension's: the
Home action row (opens ETH → STRK) and a token's screen (sells that token, `swapPresetPair`).

- **Edit.** Sell panel (amount, Max, token menu), flip, Buy panel (the quoted amount), the rate and
  "Fee ≈ $…", Refresh quote, and Review swap. A quote is asked for 350 ms after the last edit
  (`QUOTE_DEBOUNCE_MS`); a reply that lands after a newer edit is dropped. The loss tiers are the
  extension's (`SWAP_LOSS_WARN_PERCENT` 5: "High slippage risk"; `SWAP_LOSS_HIGH_RISK_PERCENT` 15:
  "Swap anyway (−x%)" on a danger button), over the worse of the core's feed delta and AVNU's own
  figures (`swapValueDeltaPercent`). An amount over a known balance blocks Review.
- **Review.** You sell / You receive / Minimum received (the minimum the core decoded from the
  frozen route), the core's line for each signed call, then the Send review's Cost box
  (`SendCostBox` / `CostBox`) and risks panel (`SendRisksPanel` / `RisksPanel`) and Confirm swap.
  Back returns to a fresh quote of the same amount.
- **Outcome.** "Swap submitted" with "Not confirmed yet. Follow it in Activity." until the chain
  answers, then "Swap complete"; a failure reads `SendFailureText`, which never says "not sent" for
  a write that may have left.

## Copy

Strings come from the extension's catalog through `SwapCopy.generated.{swift,kt}`
(`scripts/mobile-assets/swap-copy.ts`, held by `tests/conformance/mobile-generated.test.ts`). One is
mobile-only: "Refresh quote", the refresh control's accessible name. Review lines, risk flags and
refusal reasons are the core's own sentences, shown unedited; the extension maps refusals to
friendlier copy (`friendly-error-copy.ts`), which mobile does not yet do.

## Not done

- **Quote expiry.** Neither the core (`v0.7.0`) nor the extension exposes one. A stale quote fails
  at the build ("swap build failed", the core's sentence) and the person refreshes.
- **Slippage control.** The extension has none ("slippage comes from a fixed control"); mobile
  passes `nil`, the core's 0.5% default.
- **Token catalog.** The extension's picker also offers verified untracked tokens; mobile lists
  the tracked tokens only.

## Tests

iOS `SwapFlowModelTests` (canned AVNU and node: quote → review → one write; a planted spender
refused before any plan; an unanswered quote; edits, pair, balance, loss tiers) and the UI test
`SwapFlowTests`. Android `SwapQuoteTextTest` (JVM) and the instrumented `SwapFlowTest` (quote and
review on the fixture node with nothing written; an unanswered quote).
