# Allowance manager and revoke (M19)

Status: implemented on `mobile/m19-allowances` (2026-11-25), on wallet-core `v0.7.0`. The
extension's allowance manager (`journeys/portfolio/allowance-{views,ui}.ts`, background
`portfolio/allowance-{ops,recording}.ts`) is the parity target; the mechanism is wallet-core's
`allowances` module (X3, wallet-core #106/#109), exported by `bramble-core`.

## 1. What the core does, and what the apps do

| Step | Core export (v0.7.0) | App |
| --- | --- | --- |
| List | `WalletCore.allowanceListing(accountId, tokens)` → `AllowanceListing` (`nextCalls`/`accept`/`restart`/`giveUp`/`finish`) | Moves the RPC bytes over the portfolio's chain-id-verified endpoints (`PortfolioEndpoints.drive` / `PortfolioReads.drive`). A read no endpoint answers is given up once, so the core lists what it can and adds `scanIncomplete`. |
| Settle | inside `finish()`: pending revokes settle on a zero reading or on their own activity row | Nothing. |
| Revoke | `WalletCore.prepareRevoke(accountId, allowanceId, tokens)` → `AllowanceRevoke`; its confirmation read (untrusted contracts only), then `plan(feeBalance)` → `TransferPlan` | Drives the read like the listing, then runs the plan through the Send driver (`SendDriver`), exactly as Deploy account does. |
| Review | `TransferPlan.currentReview()` (`summary`, fee, `canConfirm`), `riskFlags()` (`message` each) | Shows the summary, the Cost box (`SendReviewCopy.cost` / `reviewCost`) and each flag's message verbatim. |

The host never names a call: it hands the core an `AllowanceView.id` and the core builds
`approve(spender, 0)` itself. Nothing is signed outside the plan.

## 2. Screens

- **Settings › Access & permissions › Token allowances** opens the manager (the extension's
  `settings.dock.allowances` row, `coins` icon).
- **Allowances** (`AllowancesView` / `AllowancesScreen`): the header's count ("N outstanding",
  "Not loaded" without an answer), the lede, Refresh, the "What this list includes" disclosure,
  then each notice the core raised, above the rows and above "No allowances on tokens you track."
  too. A row is the spender (truncated, copyable), then one line: amount, the contract when the
  token is not tracked, and the source; then the unconfirmed-contract and pending-revoke notes.
  Revoke is withheld for a multisig's grant and an unconfirmed contract, as in the extension.
  The list is read again each time it shows (after a revoke, it marks the grant pending).
- **Revoke** (`RevokeAllowanceView` / `RevokeAllowanceScreen`): built from the Send screens as
  Deploy account is (receipt rows, Cost box, risks panel, outcome). The review is fetched as the
  screen opens, so the fee is in view before the one Revoke press. After broadcast: "Revoke
  submitted", the transaction row, View in Activity tab and Back. A failure that may have reached
  the chain offers Activity, never a blind second revoke.

Mobile shows the revoke as its own screen where the extension reviews inline in the row; the
words are the extension's (`portfolio.allowance.*`), and every review, risk and refusal sentence
is the core's.

## 3. Gaps in v0.7.0 (host-side stand-ins, to remove when the core exports them)

- **Refusal sentences.** `RevokeError`'s `#[error]` text does not cross UniFFI except for
  `Refused { reason }`. `RevokeFlowModel.refusal` mirrors the eight fixed sentences from
  `send/revoke.rs` byte for byte; a core export (a `message()` or a flat error) should replace it.
- **Unlimited cut-off.** `isUnlimitedAllowance` is not exported; `AllowanceCopy.isUnlimited`
  holds 2^128 - 1 and is pinned to the `unlimited` block of `extension-allowances.jsonl` on both
  platforms.
- **Retention number.** `ALLOWANCE_POLICY.entries_per_scope` (50) is not exported; the
  `retentionFull` notice holds it as `entriesPerScope`.
- **Spender labels.** The core names no spender (no contact or dapp label on `AllowanceView`), so
  the row shows the truncated address with its copy control, as the extension does.
- **Lookalike spenders.** v0.7.0 refuses a revoke whose spender mimics a trusted address before a
  plan exists (`RevokeError.Refused`, shown verbatim). The extension's draft fix (#1038) exempts
  revoke from that refusal; mobile picks it up with the core release that carries it.
- **Multisig grants.** The core lists none on mobile yet (`AllowanceSource.multisig` is never
  produced; `multisigUnread` is raised when a watched multisig exists on the network).

## 4. Tests

- iOS `BrambleTests/AllowanceFlowTests`: the real core over canned nodes. The listing names a
  seeded grant; the revoke reviews with nothing written, sends exactly one
  `starknet_addInvokeTransaction` on Revoke and confirms; a zero reading then settles it; a
  refusal reads in the core's words; an unanswered listing keeps the stored grant and says it is
  partial; the row copy and the unlimited cut-off match the extension and the fixture.
- iOS `BrambleUITests/AllowancesTests`: Settings opens the manager on the offline fixture node.
- Android `test/AllowanceCopyTest` (JVM): row copy, notices, the revoke control, the fixture's
  unlimited block. `androidTest/AllowancesTest`: on `FixtureNode`, a seeded grant is listed, the
  review shows its fee with nothing written, and Revoke posts one write (which the node refuses).
