package org.bramble.wallet.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.FeeAmount
import org.bramble.core.NetworkInfo
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.WalletCore
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost

/**
 * The standalone Deploy account flow (`deployAccountFlow`), mirroring the iOS `DeployFlowModel`:
 * review the deployment fee, confirm, and report the submission. The core's plan
 * (`prepareDeployment`) does every step exactly as for a send; this only tracks the screen. The
 * plan is bound to the session generation, so a lock voids it; [close] stops it when the screen
 * leaves. Main-thread only.
 */
class DeployFlowModel(
    private val core: WalletCore,
    private val network: NetworkInfo,
    /** The account record the core deploys (an OpenZeppelin record; the core refuses others). */
    private val accountId: String,
    /** How the plan's bytes move: HTTPS in the app, an offline fixture node in tests. */
    private val transport: RpcPost = RpcClient.https,
    /** Registers each new plan with the store, which cancels it on lock. */
    private val track: (TransferPlan) -> Unit = {},
) {
    /** The screen the flow shows. */
    enum class Stage {
        /** Nothing reviewed yet: "Review deployment". */
        IDLE,

        /** The plan is estimating the deployment fee. */
        REVIEWING,

        /** The fee is known: "Confirm deployment · <fee>". */
        REVIEWED,

        /** Confirmed; the plan is signing and posting the deployment. */
        SUBMITTING,

        /** The node accepted the deployment; [hash] names it. */
        SUBMITTED,

        /** The chain already has this account: nothing to deploy. */
        ALREADY_DEPLOYED,

        /** The plan failed or was interrupted; [failureMessage] says why. */
        FAILED,
    }

    /** The current screen. */
    var stage by mutableStateOf(Stage.IDLE)
        private set

    /** The reviewed maximum deployment fee, once the plan has estimated it. */
    var fee by mutableStateOf<FeeAmount?>(null)
        private set

    /** The deployment's transaction hash once it was sent (or a failure reports one). */
    var hash by mutableStateOf<String?>(null)
        private set

    /** The extension's failure copy, shown on [Stage.FAILED]. */
    var failureMessage by mutableStateOf<String?>(null)
        private set

    private var driver: SendDriver? = null

    /** Opens a new deployment plan and runs it to its review (the fee, or "already deployed"). */
    suspend fun review() {
        close()
        // Locked, or a record the core will not deploy: nothing was prepared.
        val plan = prepare() ?: return fail(SendFailure(SendFailureCode.LOCKED, null))
        track(plan)
        val started = SendDriver(plan, network, transport).also { driver = it }
        stage = Stage.REVIEWING
        val step = advance(started, StepReply.Start)
        // A plan closed while estimating (dismissal, a new review) reports nothing.
        if (driver === started) settleReview(plan, step)
    }

    /** Confirms the reviewed deployment: the plan signs it and posts it once. */
    suspend fun confirm() {
        val driver = driver?.takeIf { stage == Stage.REVIEWED } ?: return
        stage = Stage.SUBMITTING
        when (val step = advance(driver, StepReply.Confirm)) {
            null -> {
                // Closed after the signed write may have left: the core says so, with its hash.
                fail(driver.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null))
            }

            is SendStep.Broadcast -> {
                hash = step.hash
                stage = Stage.SUBMITTED
            }

            is SendStep.Failed -> {
                fail(step.failure)
            }

            else -> {
                fail(SendFailure(SendFailureCode.NODE_ERROR, null))
            }
        }
    }

    /** Stops the open plan, if any; the next [review] opens a new one. */
    fun close() {
        driver?.plan?.cancel()
        driver = null
    }

    /** A new deployment plan from the core, or null when it refuses (locked, or not deployable). */
    private suspend fun prepare(): TransferPlan? =
        try {
            withContext(Dispatchers.Default) { core.prepareDeployment(accountId) }
        } catch (ignored: SendException) {
            null
        }

    /** Runs [driver] from [reply]; null when the plan refused the step (`PlanClosed` after a lock). */
    private suspend fun advance(
        driver: SendDriver,
        reply: StepReply,
    ): SendStep? =
        try {
            driver.run(reply)
        } catch (ignored: SendException) {
            null
        }

    /** Turns the plan's answer to Start into the review stage, "already deployed", or a failure. */
    private fun settleReview(
        plan: TransferPlan,
        step: SendStep?,
    ) {
        val review = plan.currentReview()
        val deploymentFee = review?.deploymentFee
        when {
            step == null -> {
                fail(plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null))
            }

            step is SendStep.Failed -> {
                fail(step.failure)
            }

            step !is SendStep.Review || review == null -> {
                fail(SendFailure(SendFailureCode.NODE_ERROR, null))
            }

            review.alreadyDeployed -> {
                stage = Stage.ALREADY_DEPLOYED
            }

            deploymentFee == null -> {
                fail(SendFailure(SendFailureCode.NODE_ERROR, null))
            }

            else -> {
                fee = deploymentFee
                stage = Stage.REVIEWED
            }
        }
    }

    private fun fail(failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        hash = failure.hash
        driver = null
        stage = Stage.FAILED
    }
}
