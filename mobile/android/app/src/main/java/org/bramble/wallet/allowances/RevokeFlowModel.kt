package org.bramble.wallet.allowances

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.AllowanceView
import org.bramble.core.NetworkInfo
import org.bramble.core.RevokeException
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TokenPreferences
import org.bramble.core.TransferPlan
import org.bramble.core.TransferReview
import org.bramble.core.TxStatus
import org.bramble.core.WalletCore
import org.bramble.wallet.AllowanceReads
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost
import org.bramble.wallet.drive
import org.bramble.wallet.errors.friendlyError
import org.bramble.wallet.portfolio.PortfolioReads
import org.bramble.wallet.send.SendCopy
import org.bramble.wallet.send.SendDriver
import org.bramble.wallet.send.SendFailureText

/** How a [RevokeFlowModel] reaches the chain, and who tracks its plans. */
internal data class RevokeLinks(
    /** The verified-endpoint reads the confirmation read goes over. */
    val reads: PortfolioReads,
    /** How the plan's bytes move: HTTPS in the app, a fixture node in tests. */
    val transport: RpcPost = RpcClient.https,
    /** Registers each new plan with the store, which cancels it on lock. */
    val track: (TransferPlan) -> Unit = {},
)

/**
 * One allowance revoke (`bindAllowances` + `handleRevokeAllowance`), twin of the iOS
 * `RevokeFlowModel`: the core resolves the id, reads the chain's `allowance` when the token is not
 * trusted, builds and reviews `approve(spender, 0)`, and runs it through the same plan as a send.
 * Opening the screen reviews it, so Revoke is pressed with the fee in view; one press submits
 * under that review. Every review, risk and refusal sentence shown is the core's. Main-thread only.
 */
internal class RevokeFlowModel(
    private val core: WalletCore,
    private val network: NetworkInfo,
    private val accountId: String,
    /** The listed allowance being revoked; the core re-resolves it by id. */
    val allowance: AllowanceView,
    private val tokens: TokenPreferences,
    private val links: RevokeLinks,
) {
    /** The screen the flow shows. */
    enum class Stage {
        /** Resolving, reading and reviewing the revoke. */
        PREPARING,

        /** The core's review is on screen; Revoke submits under it. */
        REVIEW,

        /** The core refused the revoke before any plan existed; [message] is its sentence. */
        REFUSED,

        /** Revoke was pressed: the plan signs and posts it once. */
        SUBMITTING,

        /** Broadcast; [confirmed] follows the chain. */
        SUBMITTED,

        /** The submission failed; [message] says why, [hash] names it if it may be on chain. */
        FAILED,
    }

    /** The current screen. */
    var stage by mutableStateOf(Stage.PREPARING)
        private set

    /** The core's review of the one call, once prepared. */
    var review by mutableStateOf<TransferReview?>(null)
        private set

    /** The batch's flags as the card lists them, in the core's words, then the deployment note. */
    var risks by mutableStateOf(emptyList<String>())
        private set

    /** The refusal or failure sentence; null otherwise. */
    var message by mutableStateOf<String?>(null)
        private set

    /** The revoke's transaction hash once it was sent (or a failure reports one). */
    var hash by mutableStateOf<String?>(null)
        private set

    /** True once the chain accepted or pre-confirmed the revoke. */
    var confirmed by mutableStateOf(false)
        private set

    private var driver: SendDriver? = null

    /**
     * Prepares and reviews the revoke: on open, and again after a failure that sent nothing.
     * [feeBalance] is the STRK base units the host last read for the account; null is "unknown".
     */
    suspend fun prepare(feeBalance: String?) {
        close()
        review = null
        risks = emptyList()
        message = null
        hash = null
        stage = Stage.PREPARING
        val plan =
            try {
                val revoke =
                    withContext(Dispatchers.Default) { core.prepareRevoke(accountId, allowance.id, tokens) }
                // Unanswered, the read stays unfinished and `plan` refuses an untrusted contract.
                links.reads.drive(AllowanceReads(revoke::nextCalls, revoke::accept, revoke::restart), network)
                withContext(Dispatchers.Default) { revoke.plan(feeBalance) }
            } catch (error: RevokeException) {
                message = shown(error)
                stage = Stage.REFUSED
                return
            }
        links.track(plan)
        val started = SendDriver(plan, network, links.transport).also { driver = it }
        settle(started, StepReply.Start)
    }

    /** The Cost box's retry: re-estimates on a freshly proven endpoint. */
    suspend fun retryFee() {
        val driver = driver ?: return
        if (stage != Stage.REVIEW) return
        driver.releaseEndpoint()
        stage = Stage.PREPARING
        settle(driver, StepReply.RetryEstimate)
    }

    /** Revoke: the core re-reads chain state, re-checks the reviewed fee, signs and posts once. */
    suspend fun confirm() {
        val driver = driver ?: return
        if (stage != Stage.REVIEW || review?.canConfirm != true) return
        stage = Stage.SUBMITTING
        settle(driver, StepReply.Confirm)
    }

    /** Stops the open plan, if any. */
    fun close() {
        driver?.plan?.cancel()
        driver = null
    }

    private suspend fun settle(
        driver: SendDriver,
        reply: StepReply,
    ) {
        val step =
            try {
                driver.run(reply)
            } catch (ignored: SendException) {
                // Closed (a lock, dismissal) after the signed write may have left: the core says so.
                return fail(driver.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null, null))
            }
        if (this.driver !== driver) return
        when (step) {
            is SendStep.Review -> showReview(driver.plan)
            is SendStep.Broadcast -> broadcast(driver, step.hash)
            is SendStep.Finished -> finish(step.status)
            is SendStep.Failed -> fail(step.failure)
            else -> fail(SendFailure(SendFailureCode.NODE_ERROR, null, null))
        }
    }

    private fun showReview(plan: TransferPlan) {
        val current = plan.currentReview() ?: return fail(SendFailure(SendFailureCode.NODE_ERROR, null, null))
        review = current
        // As Send's risks panel: the flags, then that a first transaction also deploys.
        risks =
            plan.riskFlags().map { it.message } +
            listOfNotNull(SendCopy.deployNote.takeIf { current.requiresDeployment })
        stage = Stage.REVIEW
    }

    private suspend fun broadcast(
        driver: SendDriver,
        sent: String,
    ) {
        hash = sent
        stage = Stage.SUBMITTED
        settle(driver, StepReply.Proceed)
    }

    /** The chain's answer: pending keeps the receipt; rejected or reverted is never "confirmed". */
    private fun finish(status: TxStatus) {
        when (status) {
            TxStatus.ACCEPTED, TxStatus.PRECONFIRMED -> confirmed = true
            TxStatus.PENDING -> Unit
            TxStatus.REJECTED -> failAfterBroadcast(SendCopy.rejectedMessage)
            TxStatus.REVERTED -> failAfterBroadcast(SendCopy.revertedMessage)
        }
    }

    private fun failAfterBroadcast(text: String) {
        message = text
        driver = null
        stage = Stage.FAILED
    }

    private fun fail(failure: SendFailure) {
        message = SendFailureText.message(failure)
        hash = failure.hash ?: hash
        driver = null
        stage = Stage.FAILED
    }

    /** The refusal wording, shared with the tests. */
    companion object {
        /**
         * What the screen shows for a refusal: Send's lock line for a lock (the extension's lookup
         * would read "wallet is locked" as the generic fallback), else the core's sentence through
         * the extension's friendly copy.
         */
        fun shown(error: RevokeException): String =
            if (error is RevokeException.Locked) {
                SendFailureText.message(SendFailure(SendFailureCode.LOCKED, null, null))
            } else {
                friendlyError(refusal(error))
            }

        /**
         * The core's sentence for a refusal: `RevokeError`'s `#[error]` text in wallet-core v0.7.0
         * (`send/revoke.rs`), byte for byte. The bindings carry only `Refused`'s sentence (the batch
         * review's own); the other variants reach Kotlin without their text, so it is mirrored here
         * until the core exports it. The screen shows it through the extension's friendly copy
         * ([friendlyError]), as the side panel does.
         */
        fun refusal(error: RevokeException): String =
            when (error) {
                is RevokeException.Refused -> {
                    error.reason
                }

                is RevokeException.Locked -> {
                    "wallet is locked"
                }

                is RevokeException.UnknownAccount -> {
                    "unknown account"
                }

                is RevokeException.Storage -> {
                    "a wallet file could not be read"
                }

                is RevokeException.InvalidRequest -> {
                    "invalid revoke request"
                }

                is RevokeException.OtherAccount -> {
                    "switch to the account that granted this allowance"
                }

                is RevokeException.NotFound -> {
                    "allowance not found"
                }

                is RevokeException.Collection -> {
                    "this contract is an NFT collection, not a token; revoke it from the dapp"
                }

                is RevokeException.UnconfirmedToken -> {
                    "this wallet could not confirm that contract is a token, so it will not send a revoke " +
                        "that could approve an NFT instead; revoke it from the dapp"
                }
            }
    }
}
