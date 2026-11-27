# Mobile staking (M21)

Status: screens on both apps over wallet-core `v0.7.0` (X5, wallet-core #110). The core owns every
rule; the apps own the screens, the byte moving and the tests. Nothing here is new protocol.

## 1. What the core decides

| Concern | Core export | What the app does |
| --- | --- | --- |
| Where staking exists | `STAKING_POLICY` (Mainnet only), seen through `stakingDirectoryRequest` refusing another network with "Staking isn't available on this network." | `StakingModel.refusal` / `stakingRefusal` ask that call. There is no app-side network check. Where it refuses, Home and the STRK screen offer nothing and the staking screen shows the sentence and reads nothing |
| Validator directory | `stakingDirectoryRequest` → `stakingDirectoryView` (Starkscan, active validators with a pool for a tracked token) | Moves the page through the portfolio transport; "Show more" passes the cursor |
| "Your stakes" | `stakingPositionsRequest` (off when the explorer choice keeps the address from Starkscan) → `stakingPositions` → `StakingChainRead` | Drives the chain read (below), then `view(nowSeconds)` |
| One validator's pools | `stakingOverview` → `StakingChainRead` | Same |
| An action | `prepareStaking` → `StakingPreparation` (pinned pool read) → `plan(nowSeconds, feeBalance)` → `StakingPlan { plan, review }` | Runs `plan` through `SendDriver`, as Send and Deploy do |
| Every review and risk string | `StakingPlan.review`, `TransferPlan.riskFlags()` | Shown verbatim |
| Refusals | `StakingError.Refused`, a row's `refusal` | Read through the extension's friendly copy (`FriendlyError`, [friendly-errors.md](friendly-errors.md)), as the side panel's `errorLine`; an action's refusal takes "Staking failed" as its context |

A chain read (`StakingChainRead`, `StakingPreparation`) is driven by `PortfolioEndpoints.drive`
(iOS) / `PortfolioReads.drive` (Android): the first endpoint that proves the chain, replayed from
the start on the next after a transport failure. The core refuses `view` or `plan` on an
unfinished read, so a failed read always surfaces as the core's sentence, never as "no stakes".

The preparation is single use (a second `plan` is "Review this staking action again."), bound to
the session (a lock voids it, and the store cancels the tracked plan), and Confirm signs only the
plan whose review is on screen.

## 2. Screens

Matching the extension's `journeys/staking/`:

- **Entry.** Home shows a "Staking" row (the extension's Staking tab) and the STRK screen a "Stake"
  button (`canStakeToken`, STRK by address), both only where the core's policy has staking on.
- **List.** "Your stakes" (absent while loading, off, or complete and empty; "Some of your stakes
  may not be listed." when partial), then Starkscan's list ("Listed by Starkscan. Check the address
  before you stake."), then the paste field. Directory text is third-party: plain text, a website
  is never a link, and an unknown figure reads "unknown".
- **Validator.** Name and full address (what the review names), the exit window, then a row per
  tracked token: commission, the position lines (staked, rewards, reward address, pending unstake
  with its UTC unlock time, ready to withdraw), Claim / Withdraw / Cancel unstake as the state
  allows, the stake form (or "This validator is leaving staking.") and, while staked, the unstake
  form.
- **Action.** A sheet (iOS) or in-place screen (Android) built from the Send screens' parts: the
  core's sentence with the extension's "Maximum network fee" line, the Cost box only when the fee
  could not be estimated (with Retry), the shortfall note, the risks panel, and
  "Confirm · {fee}". After the node accepts it: "Staking transaction submitted" and "Submitted.
  Follow it in Activity."; Activity's observation settles the record.

Copy comes from the extension's catalogs through `scripts/mobile-assets/staking-copy.ts`
(`StakingCopy.generated.*`, checked by `tests/conformance/mobile-generated.test.ts`): `staking.*`
and the `review.staking.*` signing wrappers, plus `readFailed`: the extension's own
`STAKING_UNREADABLE` (`apps/extension/src/background/staking/staking-context.ts`), shown only when
the core throws something that is not a refusal (a wallet file it could not read).

Time is injected: the models take a Unix-seconds clock (the portfolio's clock on device), so
tests pin the position state and the unlock text.

## 3. Tests

- iOS `StakingModelTests` replays `mobile/core/tests/fixtures/extension-staking.jsonl` (the
  extension's own wire) through the real core on an offline node (`StakingFixtureNode`, which
  swaps the fixture's stand-in staking contract and account for the policy's and the test
  wallet's): Sepolia refused with no request made; the directory's order and "unknown" figures; a
  pending unstake's UTC unlock line; a stake reaching the core's review sentence with nothing
  broadcast; a refusal shown as the core's sentence with nothing signed.
- Android `StakingTextTest` (JVM) holds the wording; `StakingTest` (instrumented) covers the
  Sepolia refusal, no Stake on STRK there, and the Mainnet screen failing offline into the core's
  sentences.
- iOS `StakingTests` (UI) does the same as the Android instrumented test through the app.

## 4. Not done

- Home's "Staked {amounts}" line under the total and an inline Staking tab: the row opens the
  full screen instead.
- Localisation: the apps show English, as everywhere else on mobile.
