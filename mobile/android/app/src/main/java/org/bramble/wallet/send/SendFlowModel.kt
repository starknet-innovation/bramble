package org.bramble.wallet.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.AccountRecord
import org.bramble.core.NetworkInfo
import org.bramble.core.ReviewFlag
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TokenInfo
import org.bramble.core.TransferPlan
import org.bramble.core.TransferRequest
import org.bramble.core.TransferReview
import org.bramble.core.TxStatus
import org.bramble.core.WalletCore
import org.bramble.core.formatTokenAmount
import org.bramble.core.parseTokenAmount
import org.bramble.core.validateRecipient
import org.bramble.wallet.design.BrambleCopy

/**
 * The Send journey's UI state, mirroring iOS `SendFlowModel`: every protocol decision is the
 * core plan's; this tracks the screen and the typed input. An edit drops the plan.
 *
 * [SendHooks.notice] carries the outcome toast: `true` for a confirmation (the store's success
 * tone), `false` for a transaction that was not confirmed (an error).
 *
 * Uncompiled: this machine has no Android SDK; checked by reading against the generated bindings.
 */
class SendFlowModel(
    private val core: WalletCore,
    /** The network the journey sends on; its tokens are the ones offered. */
    val network: NetworkInfo,
    /** The sending account; the core signs by its id and refuses Braavos and Ready records. */
    val account: AccountRecord,
    /** This network's other accounts, offered as recipients. */
    val otherAccounts: List<AccountRecord>,
    private val balances: Map<String, String>,
    private val hooks: SendHooks = SendHooks(),
) {
    /** The screen the journey shows, in the extension's order. */
    enum class Stage {
        /** Typing or picking the recipient. */
        RECIPIENT,

        /** Choosing the token. */
        ASSET,

        /** Entering the amount. */
        DETAILS,

        /** The core plan is estimating the fee for review. */
        REVIEWING,

        /** The plan's review, waiting for Confirm. */
        REVIEW,

        /** Confirmed; the plan is signing. */
        AUTHORIZING,

        /** The signed write is being posted. */
        BROADCASTING,

        /** Sent; waiting for the chain to accept it. */
        CONFIRMING,

        /** Sent, but not yet confirmed when the plan stopped checking. */
        PENDING,

        /** Accepted or pre-confirmed by the chain. */
        SUBMITTED,

        /** Refused, rejected, reverted or interrupted; [failureMessage] says which. */
        FAILED,
    }

    /** The current screen. */
    var stage by mutableStateOf(Stage.RECIPIENT)
        private set

    /** The recipient field's text, as typed (untrusted until the core validates it). */
    var recipientInput by mutableStateOf("")
        private set

    /** Why the typed recipient was refused, or null. */
    var recipientError by mutableStateOf<String?>(null)
        private set

    /** The core-canonicalised recipient address, once accepted. */
    var recipient by mutableStateOf<String?>(null)
        private set

    /** The token to send: STRK by default, else the network's first token. */
    var token by mutableStateOf(network.tokens.firstOrNull { it.symbol == "STRK" } ?: network.tokens.first())
        private set

    /** The amount field's text, with a decimal comma turned into a point. */
    var amount by mutableStateOf("")
        private set

    /** Why the amount was refused, or null. */
    var amountError by mutableStateOf<String?>(null)
        private set

    /** The core plan's review of the transfer, while one is open. */
    var review by mutableStateOf<TransferReview?>(null)
        private set

    /** Why the review cannot be confirmed (a poisoned address, no fee), or null. */
    var reviewBlock by mutableStateOf<String?>(null)
        private set

    /** The transaction hash once a write has been sent (or the core reports one). */
    var hash by mutableStateOf<String?>(null)
        private set

    /** The explorer link for [hash] from the finished plan, or null. */
    var explorerUrl by mutableStateOf<String?>(null)
        private set

    /** The failure copy shown on [Stage.FAILED]. */
    var failureMessage by mutableStateOf<String?>(null)
        private set

    private var driver: SendDriver? = null

    /** The flow header's title for [stage]. */
    val title: String get() =
        when (stage) {
            Stage.RECIPIENT -> SendCopy.titleRecipient
            Stage.ASSET -> SendCopy.titleAsset
            Stage.DETAILS, Stage.REVIEWING -> SendCopy.titleDetails
            Stage.REVIEW -> SendCopy.titleReview
            Stage.AUTHORIZING -> SendCopy.titleAuthorizing
            Stage.BROADCASTING -> SendCopy.titleBroadcasting
            Stage.CONFIRMING -> SendCopy.titleConfirming
            Stage.PENDING -> SendCopy.titlePending
            Stage.SUBMITTED -> SendCopy.titleSubmitted
            Stage.FAILED -> SendCopy.titleFailed
        }

    /** Base-unit balance of the selected token, or null while unread. */
    val rawBalance: String? get() = balances[token.symbol]

    /** "Balance <amount> SYMBOL", or "Balance unavailable" while unread. */
    val balanceLine: String get() {
        val raw = rawBalance ?: return SendCopy.balanceUnavailable
        val text =
            runCatching { formatTokenAmount(raw, token.decimals, 4u) }.getOrNull() ?: return SendCopy.balanceUnavailable
        return "${SendCopy.balancePrefix}$text ${token.symbol}"
    }

    /** Typing clears the recipient error, as the iOS `didSet`. */
    fun updateRecipient(text: String) {
        recipientInput = text
        recipientError = null
    }

    /** Typing clears the amount error and drops any plan: an edit always needs a new review. */
    fun updateAmount(text: String) {
        val next = text.replace(',', '.')
        if (next == amount) return
        amount = next
        amountError = null
        dropPlan()
    }

    /** Picks one of the person's own accounts as the recipient, then continues as typed input would. */
    fun useRecipient(address: String) {
        recipientInput = address
        continueWithRecipient()
    }

    /** Has the core validate the typed recipient; on success moves to the amount, else shows why. */
    fun continueWithRecipient() {
        val canonical = validateRecipient(recipientInput)
        if (canonical == null) {
            recipientError = SendCopy.invalidRecipient
            return
        }
        recipient = canonical
        dropPlan()
        stage = Stage.DETAILS
    }

    /** Opens the token list. */
    fun pickAsset() {
        stage = Stage.ASSET
    }

    /** Selects [next] as the token, clears the amount, and drops any plan. */
    fun choose(next: TokenInfo) {
        token = next
        amount = ""
        amountError = null
        dropPlan()
        stage = Stage.DETAILS
    }

    /**
     * Half and Max use the full raw balance (Max does not reserve the fee), formatted exactly, as
     * the extension's `balanceShortcut`; both do nothing while the balance is unread.
     */
    fun fill(half: Boolean) {
        val raw = rawBalance ?: return
        val selected = if (half) halve(raw) else raw
        val formatted =
            if (selected.all { it == '0' }) {
                null
            } else {
                runCatching { formatTokenAmount(selected, token.decimals, token.decimals) }.getOrNull()
            }
        if (formatted != null) {
            amount = formatted
            amountError = null
            dropPlan()
        }
    }

    /**
     * Checks the amount, has the core prepare a transfer plan, and runs it to its review. A
     * refused amount, recipient or account shows why and opens no plan.
     */
    suspend fun reviewSend() {
        val invalidAmount = amountProblem(amount, token.decimals)
        val to = recipient
        when {
            invalidAmount != null -> {
                amountError = invalidAmount
            }

            to == null -> {
                stage = Stage.RECIPIENT
            }

            else -> {
                dropPlan()
                val plan = prepare(to) ?: return
                hooks.track(plan)
                val driver = SendDriver(plan, network).also { this.driver = it }
                stage = Stage.REVIEWING
                settle { driver.run(StepReply.Start) }
            }
        }
    }

    /** A new core plan for sending [amount] to [to], or null after showing why the core refused. */
    private fun prepare(to: String): TransferPlan? =
        try {
            core.prepareTransfer(
                TransferRequest(network.network, account.id, token.address, to, amount, balances["STRK"]),
            )
        } catch (error: SendException) {
            when (error) {
                is SendException.InvalidRecipient -> {
                    recipientError = SendCopy.invalidRecipient
                    stage = Stage.RECIPIENT
                }

                is SendException.ViewOnlyAccount -> {
                    hooks.notice(BrambleCopy.sendViewOnlyAccount, false)
                }

                is SendException.UnsupportedAccount -> {
                    hooks.notice(BrambleCopy.sendUnsupportedAccount, false)
                }

                else -> {
                    amountError = SendCopy.amountInvalid
                }
            }
            null
        }

    /** Re-probes the endpoints and asks the plan for a new fee estimate. */
    suspend fun retryFee() {
        val driver = driver ?: return
        driver.releaseEndpoint()
        stage = Stage.REVIEWING
        settle { driver.run(StepReply.RetryEstimate) }
    }

    /** Confirms the reviewed transfer: the plan signs and posts it once, then watches it. */
    suspend fun confirm() {
        val driver = driver ?: return
        if (stage != Stage.REVIEW || review?.canConfirm != true) return
        stage = Stage.AUTHORIZING
        settle {
            driver.run(StepReply.Confirm) { step ->
                if (step is SendStep.Rpc && step.isWrite && stage == Stage.AUTHORIZING) stage = Stage.BROADCASTING
            }
        }
    }

    /** Asks the plan to check a pending transaction's status again. */
    suspend fun checkAgain() {
        val driver = driver ?: return
        stage = Stage.CONFIRMING
        settle { driver.run(StepReply.CheckAgain) }
    }

    /** Drops the plan and returns to the amount. */
    fun edit() {
        dropPlan()
        stage = Stage.DETAILS
    }

    /** Back from a stage: recipient ← details ← review/failure. */
    fun back() {
        when (stage) {
            Stage.REVIEW, Stage.FAILED -> {
                dropPlan()
                stage =
                    if (recipient == null) Stage.RECIPIENT else Stage.DETAILS
            }

            Stage.ASSET -> {
                stage = if (recipient == null) Stage.RECIPIENT else Stage.DETAILS
            }

            Stage.DETAILS -> {
                dropPlan()
                stage = Stage.RECIPIENT
            }

            else -> {
                // No step back inside the flow from here; the screen decides whether to leave.
            }
        }
    }

    /** Lock, backgrounding, dismissal. The core keeps the pending record of any sent write. */
    fun close() = dropPlan()

    private fun dropPlan() {
        driver?.plan?.close()
        driver = null
        review = null
        reviewBlock = null
    }

    private suspend fun settle(run: suspend () -> SendStep) {
        // Held here because a lock or dismissal drops `driver` while the step is in flight.
        val plan = driver?.plan
        try {
            handle(run())
        } catch (error: SendException) {
            // A refused step (`PlanClosed` after a lock, `OutOfOrder`) ends the journey closed. If
            // a signed write may already have left, the core says which and with what hash.
            fail(plan?.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null))
        }
    }

    private suspend fun handle(step: SendStep) {
        when (step) {
            is SendStep.Review -> {
                val current =
                    driver?.plan?.currentReview() ?: return fail(SendFailure(SendFailureCode.NODE_ERROR, null))
                review = current
                reviewBlock =
                    when {
                        current.flags.contains(ReviewFlag.ADDRESS_POISONING) -> SendCopy.poisonedBlock
                        !current.canConfirm -> SendCopy.feeUnavailableBlock
                        else -> null
                    }
                stage = Stage.REVIEW
            }

            is SendStep.Broadcast -> {
                hash = step.hash
                stage = Stage.CONFIRMING
                driver?.let { handle(it.run(StepReply.Proceed)) }
            }

            is SendStep.Finished -> {
                finish(step)
            }

            is SendStep.Failed -> {
                fail(step.failure)
            }

            else -> {
                // Rpc and Wait steps never reach here: the driver handles them.
            }
        }
    }

    private fun finish(step: SendStep.Finished) {
        hash = step.hash
        explorerUrl = step.explorerUrl
        when (step.status) {
            TxStatus.ACCEPTED -> {
                stage = Stage.SUBMITTED
                hooks.notice(SendCopy.toastConfirmed, true)
            }

            TxStatus.PRECONFIRMED -> {
                stage = Stage.SUBMITTED
                hooks.notice(SendCopy.toastPreconfirmed, true)
            }

            TxStatus.PENDING -> {
                stage = Stage.PENDING
            }

            TxStatus.REJECTED -> {
                failureMessage = SendCopy.rejectedMessage
                stage = Stage.FAILED
                hooks.notice(SendCopy.toastNotConfirmed, false)
            }

            TxStatus.REVERTED -> {
                failureMessage = SendCopy.revertedMessage
                stage = Stage.FAILED
                hooks.notice(SendCopy.toastNotConfirmed, false)
            }
        }
    }

    private fun fail(failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        hash = failure.hash ?: hash
        driver = null
        stage = Stage.FAILED
    }
}

/**
 * Why [amount] is not a sendable amount of a token with [decimals], or null when the core parses
 * it. Only `InvalidAmount` is mapped; any other core refusal propagates.
 */
private fun amountProblem(
    amount: String,
    decimals: UByte,
): String? =
    try {
        parseTokenAmount(amount, decimals)
        null
    } catch (error: SendException.InvalidAmount) {
        when (error.reason) {
            org.bramble.core.SendAmountError.NOT_POSITIVE -> SendCopy.amountGate
            org.bramble.core.SendAmountError.TOO_MANY_DECIMALS -> SendCopy.amountTooManyDecimals
            else -> SendCopy.amountInvalid
        }
    }

/**
 * What a Send journey reports back to its owner (the store).
 *
 * @property track receives every plan the journey opens, so a lock can close it.
 * @property notice shows the outcome toast: `true` for a confirmation, `false` for an error.
 */
data class SendHooks(
    val track: (TransferPlan) -> Unit = {},
    val notice: (message: String, success: Boolean) -> Unit = { _, _ -> },
)
