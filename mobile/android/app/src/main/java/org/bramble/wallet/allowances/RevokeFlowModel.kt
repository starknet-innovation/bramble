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

    /** Bumped by each preparation and each pre-submit close, so a stale one drops its result. */
    private var epoch = 0

    /**
     * Prepares and reviews the revoke: on open, and again after a failure that sent nothing.
     * [feeBalance] is the STRK base units the host last read for the account; null is "unknown".
     */
    suspend fun prepare(feeBalance: String?) {
        close()
        val started = ++epoch
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
                if (started == epoch) {
                    message = shown(error)
                    stage = Stage.REFUSED
                }
                return
            }
        // A newer preparation or a close overtook this one: its plan is never tracked or shown.
        if (started != epoch) return plan.cancel()
        links.track(plan)
        val fresh = SendDriver(plan, network, links.transport).also { driver = it }
        settle(fresh, StepReply.Start)
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

    /**
     * Stops the open plan, if any. Before submitting, a preparation in flight is abandoned too;
     * once submitting, the write settles as Send's does.
     */
    fun close() {
        driver?.plan?.cancel()
        driver = null
        if (stage == Stage.PREPARING || stage == Stage.REVIEW) epoch++
    }

    private suspend fun settle(
        driver: SendDriver,
        reply: StepReply,
    ) {
        val started = epoch
        val step =
            try {
                driver.run(reply)
            } catch (ignored: SendException) {
                // Closed (a lock, dismissal) after the signed write may have left: the core says so.
                if (started == epoch) {
                    fail(driver.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null, null))
                }
                return
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
        if (SendFailureText.mayHaveReachedChain(failure.code)) hash = failure.hash ?: hash
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
                friendlyError(error.toString())
            }
    }
}
