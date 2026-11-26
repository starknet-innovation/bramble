# Multisig transactions on mobile (M18)

Status: implemented on `mobile/m18-multisig-tx` (2026-11-25), on wallet-core `v0.9.0` (X1,
wallet-core #111, and its settle, #115). Scope: propose, co-sign, submit and change signers for a
saved, deployed Argent (Ready) Multisig 0.2 account, plus importing a co-signer's package. Setup,
deployment and the relay are `nostr-multisig.md`.

## 1. Who does what

The core owns every judgement. It builds the call from a named request (a transfer or a
`ConfigChange`), reviews it (`MultisigCallReview.summary`, the extension's `reviewArgentMultisigCalls`
text), freezes the invoke, stores the intent, signs the frozen hash inside itself by vault record,
and refuses anything stale. The apps move bytes and draw screens. No key, signature or calldata is
built in app code.

| Step | Core export | App code |
| --- | --- | --- |
| List | `refresh_activity(multisig_id, hash)` per submitted intent, then `multisig_intents(multisig_id)` (settles first) | `intents(of:)`, `MultisigTxDriver.settle` / `settleSubmitted` |
| Propose | `MultisigAuthorityRead`, then `propose_multisig_transaction(read, request, tokens, confirm_resend)` → `MultisigProposal` | `propose`, driven by `MultisigTxDriver` / `runPlan` |
| Co-sign | `multisig_intent_read(intent_id, now_ms)`, then `sign_multisig_intent(intent_id, signer_account_id, state)` | `sign` |
| Submit | `multisig_intent_read`, then `submit_multisig_intent(intent_id, state)` → `MultisigSubmission` | `submit` |
| Import | `MultisigStateRead::new(network, address)`, then `import_multisig_intent(package, state, tokens)` | `importIntent` |
| Card review | `MultisigAuthorityRead` of `MultisigIntent.sender`, then `multisig_intent_review(intent_id, tokens, read)` → `MultisigIntentReview` (wallet-core #146, `v0.9.0`) | `review` |

iOS: `App/CoordinationStore+Transactions.swift`, `Screens/Multisig/MultisigProposeView.swift`
(composer, signers, import), `MultisigIntentView.swift` (the card), `MultisigTxText.swift` (copy).
Android: `coordination/MultisigTransactions.kt`, `MultisigTxScreens.kt`, `MultisigIntentCard.kt`, `MultisigTxText.kt`.

Every chain read is fresh and runs over each bundled endpoint in turn until one answers
(`ChainReads.multisig` / `readState`). A plan's steps go through `RpcEndpoint`, the endpoint binding
`SendDriver` already used and now shares: the first endpoint that proves the chain serves the whole
plan, and the one write is posted once, never retried, never redirected.

## 2. Screens

Copy is the extension's (`i18n/messages/multisig*.ts`, `review-steps-multisig.ts`), byte for byte.

- **Shared account home.** "Send" and "Signers" appear once the record has a current config and
  a local signer. The second tab is "Transactions": "Co-signer updates" as before, then the open
  intents (collecting, ready, stale) under the extension's heading ("Waiting for a signature",
  "Needs attention" or "Transactions needing you"), each row the core's summary with
  "<state> · <signed> of <threshold>", then "Import transaction". The list's rows add " · N open".
- **New transaction.** Token (tracked tokens), "To", "Amount to send", "Review transaction". On
  success: "Transaction ready for multisig review" and the intent's card in place of the form.
- **Signers.** "Currently t of n", the current keys (tap one to remove it), then three proposals:
  add a key ("Approvals after adding"), remove the selected key ("Approvals after removal"), and
  "Change approvals required". Success: "Signer change ready for multisig review".
- **Import transaction.** "Intent package", the extension's import note, "Verify and import".
- **Intent card.** Its label ("Fee-updated transaction" for an open intent whose exact action a
  stale one froze, the extension's `sameAction`; "Out of date" when stale; none otherwise, since
  the page title already says "Reviewed transaction"), the core's summary, each call's summary
  from the core's review, the risk panel (Send's "Risk and recovery": the core's flags, in its
  words), "Cost" ("Maximum network fee" from `FeeAmount.display`, then "Signatures"), one action,
  "Copy transaction package" while collecting or ready, and "Technical details" (hash, sender with
  "Copy sender", chain ID, nonce, call count, each call's entrypoint, contract and calldata; iOS
  shows the hash and sender whole, Android shortened). The chain ID is the multisig network's
  (`supportedNetworks`), which the core verifies every endpoint against before it freezes an
  intent. The review is read when the card shows and whenever the intent changes, against a fresh
  authority read of the sender. Until it says the chain's signers still match
  (`hasFreshAuthority`), the card offers neither Sign nor Submit; when they do not, or the review
  cannot be read, the panel ends with "The on-chain signers no longer match this transaction.
  Signing and submission are disabled.", the note reads "The signers changed since this
  transaction was frozen. Signing and submission stay blocked.", and the one action is "Review
  current signers", which opens the multisig's Signers screen, as the extension's card. The card's
  sentences are generated from the extension (`MultisigCopy.generated.*`,
  `scripts/mobile-assets/multisig-copy.ts`).
- **Not yet ported.** The extension's signer-change review (threshold and signers before and
  after, the exact additions and removals) and the class hash row: the core does not expose a
  stored intent's config snapshot or decoded change.

## 3. Guards (all the core's; the apps only show them)

- **Stale intent.** A sign or submit whose read finds the signer set or the nonce moved is refused
  and the intent stored stale. A stale card offers no signing. It reads "The network refused this
  version: the fee rose above what was signed." for a fee refusal and "This may already have been
  sent by another signer." otherwise, followed by "This version is out of date — create a new
  transaction to continue." A fully signed stale intent offers "Try unchanged fee again", which
  is the extension's retry of the same version. Mobile does not re-price a stale intent ("Update
  network fee"), because the composer proposes a fresh one.
- **Resend.** A proposal whose calls match a stale version is refused as `AlreadySent` ("This
  transaction was already sent.") or `ResendUnconfirmed` ("This may already have been sent by
  another signer. Press again to send it anyway."). The control that proposed it then reads "Send
  anyway" and proposes again with `confirm_resend`.
- **Submitted once.** An intent with a broadcast hash is refused if submitted again. One
  submission of an intent runs at a time (the core's claim).

`MultisigTxFailure` has no text in the core, so `MultisigTxText.failure` maps each variant to the
extension's sentence. Send's generated `SendCopy` covers the variants it shares with Send. Every other
refusal is the core's `InvalidInput` reason, shown through `describeRefusal`: the extension's
friendly copy (`FriendlyError`, [friendly-errors.md](friendly-errors.md), generated from
`friendly-error-copy-multisig.ts` and the tables it joins), then redacted. "Invalid Argent multisig
intent package" reads "That package isn't a valid transaction. Ask for a fresh copy."; a reason
the extension has no sentence for keeps its words.

## 4. Activity

A submission files the transaction in the core's activity log under the multisig, and the intent
is stored `Submitted` with its hash ("Submitted to Starknet" on the card). Mobile's Activity tab
lists the active account's rows only, so a multisig's transactions show in its Transactions tab
and in the list's " · N open" count.

**Settling.** Each list read (`intents(of:)` / `intents(multisigId)`) first reads the status of
every submitted intent's transaction through `refresh_activity` for the multisig id (wallet-core
#115, in `v0.8.0`), relayed by `SendDriver` like Activity's observation; the plan never signs. The
core's list read then settles the intent from the updated row: "Submitted to Starknet" becomes
accepted or rejected, and a settled intent can be evicted from the 25-intent store. A refused or
failed read leaves the intent submitted, and the next list reads it again.

## 5. Not in M18

- Relay sync still holds trusted packages without importing them (`imported` is still 0 at `v0.9.0`).
  A co-signer pastes the package into Import.
- Advanced contract calls, replace-signer, and re-pricing a stale version.
- Decoding a signer change on the card (threshold before and after, resulting signers). `v0.9.0`
  exports a stored intent's review (`multisigIntentReview`); the apps do not adopt it yet.

## 6. Tests

- iOS `BrambleTests/MultisigTransactionsTests.swift` and Android `androidTest/MultisigTransactionsTest.kt`
  replay `extension-multisig-transactions.json` through the app's own read and plan code against a
  fake node. The proposal, both co-signatures and the ready package must equal the extension's
  bytes. The submission must return the recorded hash with exactly one write. A moved nonce must
  leave the intent stale, and a repeat proposal must come back `ResendUnconfirmed` and then succeed
  with `confirm_resend`. A submitted intent must become accepted once the node reports its
  transaction accepted, through the app's settle (`MultisigTxDriver.settle` / `settleSubmitted`),
  with no further write.
- iOS `MultisigTransactionsTests` also reads the card's review through the app's authority read:
  the sender is the multisig, the transfer's call is summarised, Sign is offered while the signers
  match and withdrawn with the signers-changed sentence once the fake node's threshold moves, and
  a transfer to the multisig itself raises the core's self-transfer flag in the panel.
- Android `test/.../MultisigTxTextTest.kt` holds the card's action, note and status for each state,
  the signers-changed rule and panel, plus the failure copy.
- iOS `BrambleUITests/MultisigTransactionsFlowTests.swift` proposes and signs on the stub 1-of-1
  `0x123` (`-BrambleStubNetwork`, which now also answers the nonce, the recorded fee estimate, and
  "hash not found"), sees the intent ready in Transactions, and has a garbage package refused.
  Nothing is submitted.
