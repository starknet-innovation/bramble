package org.bramble.wallet.coordination

import org.bramble.core.AccountRecord
import org.bramble.core.IntentState
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigIntentReview
import org.bramble.core.MultisigTxFailure
import org.bramble.core.StaleReason
import org.bramble.core.argentSignerGuid
import org.bramble.wallet.send.SendCopy

/** The one action an intent card offers. */
internal enum class IntentAction { SIGN, SUBMIT, RETRY_UNCHANGED_FEE, COPY_PACKAGE, REVIEW_SIGNERS, NONE }

/**
 * The extension's words for multisig transactions (`i18n/messages/multisig*.ts`,
 * `review-steps-multisig.ts`), byte for byte, as the iOS `MultisigTxText`. Summaries and refusals
 * are never here: a summary is the core's review of the calls (`MultisigIntent.summary`), shown as
 * it comes, and a refusal is the core's reason through the extension's friendly copy
 * ([describeRefusal]).
 */
internal object MultisigTxText {
    const val TRANSACTIONS = "Transactions"
    const val SEND = "Send"
    const val SIGNERS = "Signers"
    const val NEW_TRANSACTION = "New transaction"
    const val REVIEW_TRANSACTION = "Review transaction"
    const val AMOUNT_TO_SEND = "Amount to send"
    const val TO = "To"
    const val TOKEN = "Token"
    const val NO_TOKENS = "No tracked tokens are available for this multisig."
    const val READY = "Transaction ready for multisig review"
    const val SEND_ANYWAY = "Send anyway"
    const val IMPORT_TRANSACTION = "Import transaction"
    const val INTENT_PACKAGE = "Intent package"
    const val IMPORT_NOTE =
        "Import only the full immutable package. The wallet re-hashes every signed field and requires this " +
            "exact account, chain, nonce, class and current signer authority."
    const val VERIFY_IMPORT = "Verify and import"
    const val VERIFIED = "Intent verified and ready to review"
    const val NOTHING_IMPORT = "Nothing to sign. Import a transaction to review it here."
    const val WAITING = "Waiting for a signature"
    const val ATTENTION = "Needs attention"
    const val NEEDING_YOU = "Transactions needing you"
    const val GONE = "This transaction is no longer available."
    const val REVIEWED = "Reviewed transaction"
    const val SIGN = "Sign reviewed transaction"
    const val SUBMIT = "Submit transaction"
    const val TRY_UNCHANGED_FEE = "Try unchanged fee again"
    const val COPY_PACKAGE = "Copy transaction package"
    const val SIGNER_SELECT = "Signer in this wallet"
    const val SIGNATURES = "Signatures"
    const val MAX_FEE = "Maximum network fee"
    const val TECHNICAL = "Technical details"
    const val HASH = "Transaction hash"
    const val NONCE = "Nonce"
    const val COPY_HASH = "Copy transaction hash"
    const val SUBMITTED_KICKER = "Submitted to Starknet"
    const val CURRENT = "Current signers"
    const val ADD_PARTICIPANT = "Add participant"
    const val ENTER_KEY = "Enter a public key"
    const val NEW_THRESHOLD = "New approval threshold"
    const val APPROVALS_AFTER_ADDING = "Approvals after adding"
    const val APPROVALS_AFTER_REMOVAL = "Approvals after removal"
    const val CHANGE_THRESHOLD = "Change approvals required"
    const val REVIEW_ADDITION = "Review signer addition"
    const val REVIEW_REMOVAL = "Review removal"
    const val REVIEW_THRESHOLD = "Review threshold change"
    const val CHANGE_READY = "Signer change ready for multisig review"
    const val FAILURE_DEFAULT = SendCopy.failureDefault
    private const val FEE_REFUSED = "The network refused this version: the fee rose above what was signed."
    private const val MAY_HAVE_BEEN_SENT = "This may already have been sent by another signer."

    fun signatureCount(intent: MultisigIntent): String = "${intent.signedPublicKeys.size} of ${intent.threshold}"

    fun signed(intent: MultisigIntent): String =
        "Exact transaction signed (${intent.signedPublicKeys.size}/${intent.threshold})"

    fun submitted(hash: String): String = "Transaction submitted to Starknet: $hash"

    fun currently(
        threshold: UInt,
        total: Int,
    ): String = "Currently $threshold of $total"

    private fun full(intent: MultisigIntent): Boolean = intent.signedPublicKeys.size == intent.threshold.toInt()

    /** A list row's supporting text (`compactIntentList`): its state, then its signatures. */
    fun status(intent: MultisigIntent): String {
        val state =
            when (intent.state) {
                IntentState.READY -> "Ready to submit"
                IntentState.STALE -> "Out of date · " + if (full(intent)) "ready to retry" else "needs review"
                IntentState.COLLECTING -> "Awaiting signatures"
                else -> SUBMITTED_KICKER
            }
        return "$state · ${signatureCount(intent)}"
    }

    /**
     * `intentAction`: what the intent card offers and the note beside it. Mobile proposes a fresh
     * transaction from the composer rather than re-pricing a stale one, so a stale card says it is
     * out of date and, when fully signed, offers the unchanged-fee retry only. [fresh] is the card's
     * review (`MultisigIntentReview.hasFreshAuthority`): false, or a review that could not be read,
     * offers nothing to sign or submit, only the current signers, as the extension's card; null
     * (still reading) offers nothing yet.
     */
    fun action(
        intent: MultisigIntent,
        canSign: Boolean,
        holdsSigner: Boolean,
        fresh: Boolean?,
    ): Pair<IntentAction, String?> =
        if (isOpen(intent) && fresh != true) {
            if (fresh ==
                false
            ) {
                IntentAction.REVIEW_SIGNERS to MultisigCopy.noteSignersChanged
            } else {
                IntentAction.NONE to null
            }
        } else {
            stateAction(intent, canSign, holdsSigner)
        }

    /**
     * The card's risk panel (`reviewPanel`): the core's flags, then, unless the chain's signers
     * still match the intent, the extension's signers-changed sentence. A review that could not be
     * read says the same, since nothing proves the signers still match.
     */
    fun risks(review: MultisigIntentReview?): List<String> =
        review?.riskFlags.orEmpty().map { it.message } +
            if (review?.hasFreshAuthority == true) emptyList() else listOf(MultisigCopy.cardSignersChanged)

    private fun stateAction(
        intent: MultisigIntent,
        canSign: Boolean,
        holdsSigner: Boolean,
    ): Pair<IntentAction, String?> =
        when (intent.state) {
            IntentState.READY -> {
                IntentAction.SUBMIT to null
            }

            IntentState.STALE -> {
                // Only a fee refusal at an unmoved nonce reads as refused; anything else may have been
                // sent by a co-signer (audit M3). Neither sentence says nothing was sent.
                val lead = if (intent.staleReason == StaleReason.FEE) FEE_REFUSED else MAY_HAVE_BEEN_SENT
                val note = "$lead This version is out of date — create a new transaction to continue."
                (if (full(intent)) IntentAction.RETRY_UNCHANGED_FEE else IntentAction.NONE) to note
            }

            IntentState.COLLECTING -> {
                if (canSign) {
                    IntentAction.SIGN to null
                } else {
                    IntentAction.COPY_PACKAGE to
                        if (holdsSigner) {
                            "This wallet has already signed. Share the package to collect the remaining signature."
                        } else {
                            "No eligible signer is available in this wallet. Share the package with a signer."
                        }
                }
            }

            else -> {
                IntentAction.NONE to "Nothing left to do here."
            }
        }

    /**
     * How a plan ended, in the extension's words: Send's generated copy where the failure is the
     * same, the multisig table (`friendly-error-copy-multisig.ts`) where it is the multisig's own.
     */
    fun failure(failure: MultisigTxFailure): String =
        when (failure) {
            MultisigTxFailure.WRONG_CHAIN -> SendCopy.failureWrongChain
            MultisigTxFailure.PREPARATION_UNAVAILABLE -> SendCopy.failurePreparationUnavailable
            MultisigTxFailure.HASH_MISMATCH -> SendCopy.failureHashMismatch
            MultisigTxFailure.SUBMISSION_INDETERMINATE -> SendCopy.failureIndeterminate
            MultisigTxFailure.FEE_EXPIRED -> FEE_REFUSED
            MultisigTxFailure.ALREADY_SENT -> "This transaction was already sent."
            MultisigTxFailure.RESEND_UNCONFIRMED -> "$MAY_HAVE_BEEN_SENT Press again to send it anyway."
            MultisigTxFailure.NOT_STORED -> "This transaction could not be saved for the signers."
            MultisigTxFailure.LOCKED -> "The wallet is locked"
            MultisigTxFailure.NODE_ERROR, MultisigTxFailure.BOUNDS_OUT_OF_RANGE -> SendCopy.failureDefault
        }
}

/** The GUID of a Stark public key, or null when it is not one. */
private fun guid(key: String): String? = runCatching { argentSignerGuid(key) }.getOrNull()

/**
 * This wallet's [records] that may still sign [intent]: members of the snapshot it was frozen
 * against that have not signed it. The core checks membership again when it signs.
 */
fun availableSigners(
    intent: MultisigIntent,
    records: List<AccountRecord>,
): List<AccountRecord> {
    val signed = intent.signedPublicKeys.mapNotNull(::guid).toSet()
    return records.filter { record ->
        guid(record.publicKey)?.let { it in intent.signerGuids && it !in signed } == true
    }
}

/** Whether any of this wallet's [records] is in [intent]'s signer snapshot. */
fun holdsSigner(
    intent: MultisigIntent,
    records: List<AccountRecord>,
): Boolean = records.any { record -> guid(record.publicKey)?.let { it in intent.signerGuids } == true }

/** Collecting, ready and stale intents still need someone; the rest are done or on chain. */
fun isOpen(intent: MultisigIntent): Boolean =
    intent.state == IntentState.COLLECTING || intent.state == IntentState.READY || intent.state == IntentState.STALE

/**
 * The card's label (`intentCard`'s kicker): a fee-updated version of an attempt that went
 * stale, or a stale one; null for an ordinary reviewed transaction, which the page title
 * already names.
 */
internal fun intentKicker(
    intent: MultisigIntent,
    among: List<MultisigIntent>,
): String? =
    when {
        isFeeReplacement(intent, among) -> MultisigCopy.cardFeeUpdated
        intent.state == IntentState.STALE -> MultisigCopy.staleLabel
        else -> null
    }

/**
 * `isFeeReplacementIntent`: an open intent whose exact action a stale one of the same multisig
 * already froze (`sameAction`). The core stores calls, nonce and signer GUIDs canonical, so
 * plain equality is the extension's felt comparison.
 */
private fun isFeeReplacement(
    intent: MultisigIntent,
    among: List<MultisigIntent>,
): Boolean =
    (intent.state == IntentState.COLLECTING || intent.state == IntentState.READY) &&
        among.any { stale ->
            stale.state == IntentState.STALE &&
                stale.id != intent.id &&
                stale.multisigId == intent.multisigId &&
                stale.threshold == intent.threshold &&
                stale.signerGuids == intent.signerGuids &&
                stale.nonce == intent.nonce &&
                stale.calls == intent.calls
        }
