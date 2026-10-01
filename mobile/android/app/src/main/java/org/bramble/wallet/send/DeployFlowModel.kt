package org.bramble.wallet.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.DeploymentState
import org.bramble.core.FeeAmount
import org.bramble.core.NetworkInfo
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.TxStatus
import org.bramble.core.WalletCore
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost

/**
 * The standalone Deploy account flow, mirroring the extension's `bindDeploy`: the fee is quoted as
 * soon as the screen opens, so Deploy is a decision made with the figure in view. One press
 * submits under the quoted fee; with no figure in hand (the quote failed, or a submission was
 * refused) the press quotes again and the next press submits, so no fee the person never saw is
 * spent. After submission the receipt says "submitted" and firms up to "deployed" once the chain
 * answers. The core's plan (`prepareDeployment`) does every step exactly as for a send; this only
 * tracks the screen. The plan is bound to the session generation, so a lock voids it; [close]
 * stops it when the screen leaves. Main-thread only.
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
        /** The plan is estimating the deployment fee: on open, or on a press with no figure. */
        QUOTING,

        /** Waiting for Deploy: [fee] is the quoted figure, or null after a failure ([problem]). */
        READY,

        /** Deploy was pressed with a figure: the plan signs and posts the deployment once. */
        SUBMITTING,

        /** The node accepted the deployment; [hash] names it and [confirmed] follows the chain. */
        SUBMITTED,

        /** The chain already has this account: nothing to deploy. */
        ALREADY_DEPLOYED,
    }

    /** The current screen. */
    var stage by mutableStateOf(Stage.QUOTING)
        private set

    /** The quoted maximum deployment fee; null until quoted, and after a failure. */
    var fee by mutableStateOf<FeeAmount?>(null)
        private set

    /** Why the last quote or submission failed, in the extension's copy; null otherwise. */
    var problem by mutableStateOf<String?>(null)
        private set

    /** The deployment's transaction hash once it was sent (or a failure reports one). */
    var hash by mutableStateOf<String?>(null)
        private set

    /** True once the chain accepted or pre-confirmed the submitted deployment. */
    var confirmed by mutableStateOf(false)
        private set

    private var driver: SendDriver? = null

    /**
     * Opens the screen: an account the store already judged [DeploymentState.DEPLOYED] has
     * nothing to quote, as the extension's disabled "Account already deployed"; any other state
     * is quoted at once.
     */
    suspend fun open(deployment: DeploymentState) {
        if (deployment == DeploymentState.DEPLOYED) {
            stage = Stage.ALREADY_DEPLOYED
        } else {
            quote()
        }
    }

    /** The Deploy button: submits under the quoted fee, or quotes again when there is none. */
    suspend fun deploy() {
        when {
            stage != Stage.READY -> return
            fee == null -> quote()
            else -> submit()
        }
    }

    /** Stops the open plan, if any; the next quote opens a new one. */
    fun close() {
        driver?.plan?.cancel()
        driver = null
    }

    /** Opens a new deployment plan and runs it to its review: the fee, or "already deployed". */
    private suspend fun quote() {
        close()
        fee = null
        problem = null
        stage = Stage.QUOTING
        // Locked, or a record the core will not deploy: nothing was prepared.
        val plan = prepare() ?: return failQuote()
        track(plan)
        val started = SendDriver(plan, network, transport).also { driver = it }
        val step = advance(started, StepReply.Start)
        // A plan closed while estimating (dismissal, a lock) reports nothing.
        if (driver !== started) return
        val review = plan.currentReview()
        val quoted = review?.deploymentFee
        when {
            step !is SendStep.Review || review == null -> {
                failQuote()
            }

            review.alreadyDeployed -> {
                stage = Stage.ALREADY_DEPLOYED
            }

            quoted == null -> {
                failQuote()
            }

            else -> {
                fee = quoted
                stage = Stage.READY
            }
        }
    }

    /** Confirms the quoted deployment: the plan signs it, posts it once, then watches the chain. */
    private suspend fun submit() {
        val driver = driver ?: return quote()
        stage = Stage.SUBMITTING
        when (val step = advance(driver, StepReply.Confirm)) {
            null -> {
                // Closed after the signed write may have left: the core says so, with its hash.
                failSubmission(driver.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null, null))
            }

            is SendStep.Broadcast -> {
                hash = step.hash
                stage = Stage.SUBMITTED
                watch(driver)
            }

            is SendStep.Failed -> {
                failSubmission(step.failure)
            }

            else -> {
                failSubmission(SendFailure(SendFailureCode.NODE_ERROR, null, null))
            }
        }
    }

    /** Runs the plan's confirmation checkpoints; only the chain's acceptance firms up the receipt. */
    private suspend fun watch(driver: SendDriver) {
        val step = advance(driver, StepReply.Proceed) as? SendStep.Finished ?: return
        if (this.driver !== driver) return
        when (step.status) {
            TxStatus.ACCEPTED, TxStatus.PRECONFIRMED -> confirmed = true
            TxStatus.REJECTED -> problem = SendCopy.rejectedMessage
            TxStatus.REVERTED -> problem = SendCopy.revertedMessage
            TxStatus.PENDING -> Unit
        }
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

    /** The quote could not be fetched: the screen says so and Deploy quotes again. */
    private fun failQuote() {
        close()
        problem = SendCopy.deployEstimateFailed
        stage = Stage.READY
    }

    /** The submission was refused: its reason shows, and the next press quotes afresh. */
    private fun failSubmission(failure: SendFailure) {
        close()
        fee = null
        problem = SendFailureText.message(failure)
        hash = failure.hash
        stage = Stage.READY
    }
}

/**
 * What the deploy form shows for one moment of [DeployFlowModel]: the status line under the
 * button, the Cost box's line, and the button itself.
 *
 * @property status "Estimating fee…" or "Submitting deployment…" while the plan works, else null.
 * @property cost the quoted "Maximum network fee: …", or the reason there is none; null for nothing.
 * @property costFailed true when [cost] is a failure, shown in the danger tone.
 * @property button the one button's label: Deploy, or "Account already deployed".
 * @property enabled whether the button can be pressed.
 * @property busy whether the button shows its spinner.
 */
data class DeployView(
    val status: String?,
    val cost: String?,
    val costFailed: Boolean,
    val button: String,
    val enabled: Boolean,
    val busy: Boolean,
)

/** The form for [stage], with the quoted [fee] or the [problem] that stands in for it. */
fun deployView(
    stage: DeployFlowModel.Stage,
    fee: FeeAmount?,
    problem: String?,
): DeployView {
    val quoting = stage == DeployFlowModel.Stage.QUOTING
    val submitting = stage == DeployFlowModel.Stage.SUBMITTING
    val cost = fee?.let { SendCopy.maximumFeePrefix + it.display } ?: problem
    if (stage == DeployFlowModel.Stage.ALREADY_DEPLOYED) {
        return DeployView(null, null, false, SendCopy.alreadyDeployed, enabled = false, busy = false)
    }
    return DeployView(
        status =
            when {
                quoting -> SendCopy.deployEstimating
                submitting -> SendCopy.deploySubmitting
                else -> null
            },
        cost = cost.takeUnless { quoting },
        costFailed = fee == null && problem != null,
        button = SendCopy.deployButton,
        enabled = stage == DeployFlowModel.Stage.READY,
        busy = quoting || submitting,
    )
}

/** The receipt's title and body: "submitted" until the chain confirms, then "deployed". */
fun deployReceipt(confirmed: Boolean): Pair<String, String?> =
    if (confirmed) {
        SendCopy.deployConfirmedTitle to SendCopy.deployConfirmedBody
    } else {
        SendCopy.deploySubmittedTitle to null
    }
