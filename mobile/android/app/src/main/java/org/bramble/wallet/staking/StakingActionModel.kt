package org.bramble.wallet.staking

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.FeeAffordability
import org.bramble.core.PositionState
import org.bramble.core.RowFigures
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StakingAction
import org.bramble.core.StakingException
import org.bramble.core.StakingRowView
import org.bramble.core.StepReply
import org.bramble.core.TransferReview
import org.bramble.wallet.WalletStore
import org.bramble.wallet.portfolio.rawBalances
import org.bramble.wallet.send.SendCopy
import org.bramble.wallet.send.SendDriver
import org.bramble.wallet.send.SendFailureText

/**
 * One staking action, twin of the iOS `StakingActionModel` (`staking-ui.ts` over
 * `wallet.stakingPrepare` / `wallet.stakingExecute`): the host names the action, validator, token
 * and amount, never a call. The core reads the pool at one pinned block, builds and reviews the
 * calls, and hands back a `TransferPlan` with the sentence to confirm; this runs that plan through
 * [SendDriver] exactly as Send and Deploy do. The preparation is single use, the plan is bound to
 * the session (a lock voids it), and Confirm signs only the plan whose review is on screen.
 * Main-thread only.
 */
class StakingActionModel internal constructor(
    /** The store: the core, the transport, the fee balance and the plan tracking. */
    private val store: WalletStore,
    /** The staking screen the action was started from: account, network, reads and clock. */
    private val model: StakingModel,
    /** The action this screen prepares. */
    val action: StakingAction,
    /** The pool's row: validator and token. */
    private val row: StakingRowView,
    /** The amount typed, for stake and unstake. */
    private val amount: String?,
) {
    /** Where the action stands. */
    enum class Stage {
        /** The pinned read, the plan and its fee estimate. */
        PREPARING,

        /** The core's sentence and fee are on screen; Confirm signs this plan. */
        REVIEW,

        /** The core refused before anything was signed; [message] is its sentence. */
        REFUSED,

        /** Confirm was pressed: the plan signs and posts once. */
        SUBMITTING,

        /** The node accepted the transaction; Activity follows it from here. */
        SUBMITTED,

        /** Signing or submission failed, or its outcome is unknown; [message] says which. */
        FAILED,
    }

    /** The current stage. */
    var stage by mutableStateOf(Stage.PREPARING)
        private set

    /** The core's review sentence (`StakingPlan.review`), shown verbatim. */
    var sentence by mutableStateOf<String?>(null)
        private set

    /** The plan's review: fee, affordability, whether Confirm is allowed. */
    var review by mutableStateOf<TransferReview?>(null)
        private set

    /** Each risk flag's message from the core's batch review, then the first-send note. */
    val risks = mutableStateListOf<String>()

    /** The refusal or failure sentence. */
    var message by mutableStateOf<String?>(null)
        private set

    /** The submitted transaction's hash. */
    var hash by mutableStateOf<String?>(null)
        private set

    private var driver: SendDriver? = null

    /** The pool's token symbol, the screen's subtitle. */
    val symbol: String get() = row.symbol

    /** The sentence with the extension's fee line; the sentence alone while there is no figure. */
    val reviewLine: String?
        get() {
            val said = sentence ?: return null
            val fee = review?.fee ?: return said
            return fill(StakingCopy.reviewReview, "review" to said, "fee" to fee.display)
        }

    /** "Confirm · 0.01 STRK", or the action's own label while there is no figure. */
    val confirmLabel: String
        get() = review?.fee?.let { fill(StakingCopy.reviewConfirm, "fee" to it.display) } ?: actionLabel(action)

    /** True when the account's STRK does not cover the reviewed fee. */
    val shortfall: Boolean get() = review?.affordability == FeeAffordability.INSUFFICIENT

    /** Prepares the action and runs its plan to the review. */
    suspend fun prepare() {
        close()
        stage = Stage.PREPARING
        val plan =
            try {
                val core = store.walletCore
                val preparation =
                    withContext(Dispatchers.Default) {
                        core.prepareStaking(model.accountId, action, row.staker, row.tokenId, amount, model.tokens)
                    }
                val steps = StakingSteps(preparation::nextCalls, preparation::accept, preparation::restart)
                model.reads.drive(steps, model.network)
                val feeBalance = store.portfolio.rawBalances(model.network)["STRK"]
                val staking = withContext(Dispatchers.Default) { preparation.plan(model.clock(), feeBalance) }
                sentence = staking.review
                staking.plan
            } catch (refused: StakingException) {
                message = stakingMessage(refused, StakingCopy.reviewFailed)
                stage = Stage.REFUSED
                return
            }
        store.plans += plan
        val started = SendDriver(plan, model.network, store.rpc.transport).also { driver = it }
        show(advance(started, StepReply.Start))
    }

    /** The Cost box's Retry after a failed estimate. */
    suspend fun retryFee() {
        val current = driver ?: return
        if (stage != Stage.REVIEW) return
        current.releaseEndpoint()
        stage = Stage.PREPARING
        show(advance(current, StepReply.RetryEstimate))
    }

    /** Confirms the plan on screen: the core re-reads, re-checks the reviewed fee, and signs. */
    suspend fun confirm() {
        val current = driver ?: return
        if (stage != Stage.REVIEW || review?.canConfirm != true) return
        stage = Stage.SUBMITTING
        when (val step = advance(current, StepReply.Confirm)) {
            is SendStep.Broadcast -> {
                hash = step.hash
                stage = Stage.SUBMITTED
            }

            is SendStep.Failed -> {
                fail(step.failure)
            }

            null -> {
                fail(current.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null, null))
            }

            else -> {
                fail(SendFailure(SendFailureCode.NODE_ERROR, null, null))
            }
        }
    }

    /** Dismissal or lock; a submitted transaction keeps its pending Activity record. */
    fun close() {
        driver?.plan?.cancel()
        driver = null
    }

    private suspend fun advance(
        driver: SendDriver,
        reply: StepReply,
    ): SendStep? =
        try {
            driver.run(reply)
        } catch (ignored: SendException) {
            null
        }

    private fun show(step: SendStep?) {
        val plan = driver?.plan
        val current = plan?.currentReview()
        if (step !is SendStep.Review || current == null) {
            fail(
                (step as? SendStep.Failed)?.failure
                    ?: plan?.interruptedFailure()
                    ?: SendFailure(SendFailureCode.NODE_ERROR, null, null),
            )
            return
        }
        review = current
        risks.clear()
        risks += plan.riskFlags().map { it.message }
        if (current.requiresDeployment) risks += SendCopy.deployNote
        stage = Stage.REVIEW
    }

    private fun fail(failure: SendFailure) {
        message = SendFailureText.message(failure)
        hash = failure.hash ?: hash
        close()
        stage = Stage.FAILED
    }
}

/** The action buttons a verified row offers (`rowActions`), in the extension's order. */
fun rowButtons(figures: RowFigures?): List<StakingAction> {
    if (figures == null) return emptyList()
    val exiting = figures.state == PositionState.EXIT_PENDING || figures.state == PositionState.WITHDRAWABLE
    return listOfNotNull(
        StakingAction.CLAIM.takeIf { figures.unclaimed.isNotEmpty() && figures.unclaimed != "0" },
        StakingAction.WITHDRAW.takeIf { figures.state == PositionState.WITHDRAWABLE },
        StakingAction.CANCEL_UNSTAKE.takeIf { exiting },
    )
}

/** The control's label for [action]. */
fun actionLabel(action: StakingAction): String =
    when (action) {
        StakingAction.STAKE -> StakingCopy.actionStake
        StakingAction.CLAIM -> StakingCopy.actionClaim
        StakingAction.UNSTAKE -> StakingCopy.actionUnstake
        StakingAction.CANCEL_UNSTAKE -> StakingCopy.actionCancelUnstake
        StakingAction.WITHDRAW -> StakingCopy.actionWithdraw
    }
