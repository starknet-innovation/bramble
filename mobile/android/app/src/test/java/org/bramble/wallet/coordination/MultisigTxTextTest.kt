package org.bramble.wallet.coordination

import org.bramble.core.IntentState
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigIntentReview
import org.bramble.core.MultisigTxFailure
import org.bramble.core.ReviewText
import org.bramble.core.RiskFlag
import org.bramble.core.RiskFlagCode
import org.bramble.core.StaleReason
import org.bramble.wallet.send.SendCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What an intent card offers and says for each state (`intentAction`, `compactIntentList`), and
 * the failure copy: the extension's words, and never a retry that could send a version twice.
 */
class MultisigTxTextTest {
    private fun intent(
        state: IntentState,
        signed: Int,
        stale: StaleReason? = null,
    ) = MultisigIntent(
        id = "SN_SEPOLIA:0x1:0x2",
        multisigId = "SN_SEPOLIA:0x1",
        state = state,
        staleReason = stale,
        summary = "Transfer 1.5 STRK to 0x1234…5678",
        transactionHash = "0x2",
        sender = "0x1",
        nonce = "0x5",
        threshold = 2u,
        signerGuids = listOf("0xa", "0xb"),
        signedPublicKeys = List(signed) { "0x$it" },
        maxFee = null,
        calls = emptyList(),
        broadcastTransactionHash = null,
        `package` = "{}",
    )

    @Test
    fun collectingSignsOrShares() {
        val collecting = intent(IntentState.COLLECTING, 1)
        assertEquals(
            IntentAction.SIGN to null,
            MultisigTxText.action(collecting, canSign = true, holdsSigner = true, fresh = true),
        )
        val (action, note) = MultisigTxText.action(collecting, canSign = false, holdsSigner = true, fresh = true)
        assertEquals(IntentAction.COPY_PACKAGE, action)
        assertEquals("This wallet has already signed. Share the package to collect the remaining signature.", note)
        assertEquals("Awaiting signatures · 1 of 2", MultisigTxText.status(collecting))
    }

    @Test
    fun readySubmits() {
        val ready = intent(IntentState.READY, 2)
        assertEquals(
            IntentAction.SUBMIT,
            MultisigTxText.action(ready, canSign = false, holdsSigner = true, fresh = true).first,
        )
        assertEquals("Ready to submit · 2 of 2", MultisigTxText.status(ready))
    }

    /** A stale version is never signed again; only a fully signed one may retry its own fee. */
    @Test
    fun staleNeverSigns() {
        val moved = intent(IntentState.STALE, 1, StaleReason.NONCE)
        val (action, note) = MultisigTxText.action(moved, canSign = true, holdsSigner = true, fresh = true)
        assertEquals(IntentAction.NONE, action)
        assertEquals(
            "This may already have been sent by another signer. " +
                "This version is out of date — create a new transaction to continue.",
            note,
        )
        assertEquals("Out of date · needs review · 1 of 2", MultisigTxText.status(moved))
        val refused = intent(IntentState.STALE, 2, StaleReason.FEE)
        val (retry, lead) = MultisigTxText.action(refused, canSign = true, holdsSigner = true, fresh = true)
        assertEquals(IntentAction.RETRY_UNCHANGED_FEE, retry)
        assertTrue(lead!!.startsWith("The network refused this version"))
        assertTrue(isOpen(refused))
        assertFalse(isOpen(intent(IntentState.SUBMITTED, 2)))
    }

    /**
     * The card's review (`MultisigIntentReview`): while the chain's signers match, its flags and
     * the state's action; once they moved, or when the review could not be read, nothing to sign
     * or submit and the extension's signers-changed sentence after the flags.
     */
    @Test
    fun signersThatMovedOfferNothing() {
        val flag =
            RiskFlag(
                RiskFlagCode.SELF_TRANSFER,
                "Sending to yourself",
                ReviewText("review.flag.selfTransfer", emptyList()),
            )
        val fresh = MultisigIntentReview(calls = emptyList(), riskFlags = listOf(flag), hasFreshAuthority = true)
        val moved = fresh.copy(hasFreshAuthority = false)
        val collecting = intent(IntentState.COLLECTING, 1)
        assertEquals(listOf("Sending to yourself"), MultisigTxText.risks(fresh))
        assertEquals(IntentAction.SIGN to null, MultisigTxText.action(collecting, true, true, fresh = true))
        assertEquals(
            listOf(
                "Sending to yourself",
                "The on-chain signers no longer match this transaction. Signing and submission are disabled.",
            ),
            MultisigTxText.risks(moved),
        )
        assertEquals(listOf(MultisigCopy.cardSignersChanged), MultisigTxText.risks(null))
        for (state in listOf(IntentState.COLLECTING, IntentState.READY, IntentState.STALE)) {
            val (action, note) = MultisigTxText.action(intent(state, 2), true, true, fresh = false)
            assertEquals(IntentAction.REVIEW_SIGNERS, action)
            assertEquals(MultisigCopy.noteSignersChanged, note)
            assertEquals(IntentAction.NONE to null, MultisigTxText.action(intent(state, 2), true, true, fresh = null))
        }
    }

    /**
     * The card's label: an open intent whose exact action a stale one froze is the fee-updated
     * version; a stale one is out of date; any other intent is the page title's alone.
     */
    @Test
    fun aFeeRetryIsFeeUpdated() {
        val stale = intent(IntentState.STALE, 0)
        val retry = stale.copy(id = "retry", state = IntentState.COLLECTING)
        val all = listOf(stale, retry)
        assertEquals(MultisigCopy.cardFeeUpdated, intentKicker(retry, all))
        assertEquals(MultisigCopy.staleLabel, intentKicker(stale, all))
        assertEquals(null, intentKicker(retry, listOf(retry)))
        assertEquals("a new nonce is a new action", null, intentKicker(retry.copy(nonce = "0x6"), all))
    }

    @Test
    fun failureCopyIsTheExtensions() {
        assertEquals("This transaction was already sent.", MultisigTxText.failure(MultisigTxFailure.ALREADY_SENT))
        assertEquals(
            "This may already have been sent by another signer. Press again to send it anyway.",
            MultisigTxText.failure(MultisigTxFailure.RESEND_UNCONFIRMED),
        )
        assertEquals(SendCopy.failureIndeterminate, MultisigTxText.failure(MultisigTxFailure.SUBMISSION_INDETERMINATE))
        assertEquals(SendCopy.failureDefault, MultisigTxText.failure(MultisigTxFailure.NODE_ERROR))
    }
}
