package org.bramble.wallet.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.AccountInfo
import org.bramble.core.NetworkInfo
import org.bramble.core.ReviewFlag
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TokenInfo
import org.bramble.core.TransferRequest
import org.bramble.core.TransferReview
import org.bramble.core.TxStatus
import org.bramble.core.WalletCore
import org.bramble.core.formatTokenAmount
import org.bramble.core.parseTokenAmount
import org.bramble.core.validateRecipient

/**
 * The Send journey's UI state, mirroring iOS `SendFlowModel`: every protocol decision is the
 * core plan's; this tracks the screen and the typed input. An edit drops the plan.
 *
 * Uncompiled: this machine has no Android SDK; written against the generated Kotlin bindings.
 */
class SendFlowModel(
    private val core: WalletCore,
    val network: NetworkInfo,
    val account: AccountInfo,
    private val balances: Map<String, String>,
    private val track: (org.bramble.core.TransferPlan) -> Unit = {},
) {
    enum class Stage { RECIPIENT, DETAILS, REVIEWING, REVIEW, AUTHORIZING, BROADCASTING, CONFIRMING, PENDING, SUBMITTED, FAILED }

    var stage by mutableStateOf(Stage.RECIPIENT); private set
    var recipientInput by mutableStateOf("")
    var recipientError by mutableStateOf<String?>(null); private set
    var recipient by mutableStateOf<String?>(null); private set
    var token by mutableStateOf(network.tokens.firstOrNull { it.symbol == "STRK" } ?: network.tokens.first()); private set
    var amount by mutableStateOf("")
    var amountError by mutableStateOf<String?>(null); private set
    var review by mutableStateOf<TransferReview?>(null); private set
    var reviewBlock by mutableStateOf<String?>(null); private set
    var hash by mutableStateOf<String?>(null); private set
    var explorerUrl by mutableStateOf<String?>(null); private set
    var failureMessage by mutableStateOf<String?>(null); private set

    private var driver: SendDriver? = null

    val title: String get() = when (stage) {
        Stage.RECIPIENT -> SendCopy.titleRecipient
        Stage.DETAILS, Stage.REVIEWING -> SendCopy.titleDetails
        Stage.REVIEW -> SendCopy.titleReview
        Stage.AUTHORIZING -> SendCopy.titleAuthorizing
        Stage.BROADCASTING -> SendCopy.titleBroadcasting
        Stage.CONFIRMING -> SendCopy.titleConfirming
        Stage.PENDING -> SendCopy.titlePending
        Stage.SUBMITTED -> SendCopy.titleSubmitted
        Stage.FAILED -> SendCopy.titleFailed
    }

    fun continueWithRecipient() {
        val canonical = validateRecipient(recipientInput)
        if (canonical == null) { recipientError = SendCopy.invalidRecipient; return }
        recipient = canonical
        dropPlan()
        stage = Stage.DETAILS
    }

    fun choose(next: TokenInfo) { token = next; amount = ""; dropPlan() }

    /** Max is the full raw balance, formatted exactly; it does nothing while unread. */
    fun fillMax() {
        val raw = balances[token.symbol] ?: return
        if (raw.all { it == '0' }) return
        amount = formatTokenAmount(raw, token.decimals, token.decimals)
    }

    suspend fun reviewSend() {
        try {
            parseTokenAmount(amount, token.decimals)
        } catch (error: SendException.InvalidAmount) {
            amountError = when (error.reason) {
                org.bramble.core.SendAmountError.NOT_POSITIVE -> SendCopy.amountGate
                org.bramble.core.SendAmountError.TOO_MANY_DECIMALS -> SendCopy.amountTooManyDecimals
                else -> SendCopy.amountInvalid
            }
            return
        }
        val to = recipient ?: run { stage = Stage.RECIPIENT; return }
        dropPlan()
        val plan = try {
            core.prepareTransfer(TransferRequest(network.network, account.index, token.address, to, amount, balances["STRK"]))
        } catch (error: SendException) {
            recipientError = SendCopy.invalidRecipient
            stage = Stage.RECIPIENT
            return
        }
        track(plan)
        val driver = SendDriver(plan, network).also { driver = it }
        stage = Stage.REVIEWING
        settle { driver.run(StepReply.Start) }
    }

    suspend fun retryFee() {
        val driver = driver ?: return
        driver.releaseEndpoint()
        stage = Stage.REVIEWING
        settle { driver.run(StepReply.RetryEstimate) }
    }

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

    suspend fun checkAgain() {
        val driver = driver ?: return
        stage = Stage.CONFIRMING
        settle { driver.run(StepReply.CheckAgain) }
    }

    fun edit() { dropPlan(); stage = Stage.DETAILS }

    /** Lock, backgrounding, dismissal. The core keeps the pending record of any sent write. */
    fun close() = dropPlan()

    private fun dropPlan() {
        driver?.plan?.close()
        driver = null
        review = null
        reviewBlock = null
    }

    private suspend fun settle(run: suspend () -> SendStep) {
        try {
            handle(run())
        } catch (error: SendException) {
            fail(SendFailure(SendFailureCode.LOCKED, null))
        }
    }

    private suspend fun handle(step: SendStep) {
        when (step) {
            is SendStep.Review -> {
                val current = driver?.plan?.currentReview() ?: return fail(SendFailure(SendFailureCode.NODE_ERROR, null))
                review = current
                reviewBlock = when {
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
                hash = step.hash
                explorerUrl = step.explorerUrl
                when (step.status) {
                    TxStatus.ACCEPTED, TxStatus.PRECONFIRMED -> stage = Stage.SUBMITTED
                    TxStatus.PENDING -> stage = Stage.PENDING
                    TxStatus.REJECTED -> { failureMessage = SendCopy.rejectedMessage; stage = Stage.FAILED }
                    TxStatus.REVERTED -> { failureMessage = SendCopy.revertedMessage; stage = Stage.FAILED }
                }
            }
            is SendStep.Failed -> fail(step.failure)
            else -> Unit
        }
    }

    private fun fail(failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        hash = failure.hash ?: hash
        driver = null
        stage = Stage.FAILED
    }
}

/** The extension's wording per failure code (`SendCopy`, generated). */
object SendFailureText {
    fun message(failure: SendFailure): String {
        val reason = when (failure.code) {
            SendFailureCode.REVIEWED_FEE_EXCEEDED -> SendCopy.reviewedFeeExceeded
            SendFailureCode.REVIEWED_FEE_REQUIRED -> SendCopy.reviewedFeeRequired
            SendFailureCode.REVIEWED_DEPLOYMENT_FEE_EXCEEDED -> SendCopy.reviewedDeploymentFeeExceeded
            SendFailureCode.REVIEWED_DEPLOYMENT_FEE_REQUIRED -> SendCopy.reviewedDeploymentFeeRequired
            SendFailureCode.POISONED_RECIPIENT -> SendCopy.poisonedRecipient
            SendFailureCode.WRONG_CHAIN -> SendCopy.failureWrongChain
            SendFailureCode.PREPARATION_UNAVAILABLE -> SendCopy.failurePreparationUnavailable
            SendFailureCode.HASH_MISMATCH -> SendCopy.failureHashMismatch
            SendFailureCode.SUBMISSION_INDETERMINATE -> SendCopy.failureIndeterminate
            SendFailureCode.DEPLOYMENT_STATUS_UNKNOWN -> SendCopy.failureDeploymentStatusUnknown
            SendFailureCode.DEPLOYMENT_UNCONFIRMED -> SendCopy.failureDeploymentUnconfirmed
            SendFailureCode.DEPLOYMENT_THEN_INVOKE_UNCONFIRMED -> SendCopy.failureDeploymentThenInvokeUnconfirmed
            SendFailureCode.AUTO_DEPLOYMENT_FAILED -> SendCopy.failureAutoDeploymentFailed
            SendFailureCode.ALREADY_DEPLOYED -> SendCopy.failureAlreadyDeployed
            SendFailureCode.UNRECOGNISED_FEE_UNIT -> SendCopy.failureUnrecognisedUnit
            else -> return SendCopy.failureDefault
        }
        return SendCopy.failurePrefix + reason.replace("{hash}", failure.hash ?: "")
    }
}
