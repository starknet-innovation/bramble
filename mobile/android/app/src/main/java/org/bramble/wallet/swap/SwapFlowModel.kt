package org.bramble.wallet.swap

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.PriceView
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.SwapException
import org.bramble.core.SwapQuoteView
import org.bramble.core.SwapReview
import org.bramble.core.TokenConfig
import org.bramble.core.TokenPreferences
import org.bramble.core.TokenSwap
import org.bramble.core.TransferPlan
import org.bramble.core.TransferReview
import org.bramble.core.TxStatus
import org.bramble.core.WalletCore
import org.bramble.core.formatTokenAmount
import org.bramble.core.parseTokenAmount
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost
import org.bramble.wallet.portfolio.BoundedHttp
import org.bramble.wallet.portfolio.PortfolioTransport
import org.bramble.wallet.send.SendCopy
import org.bramble.wallet.send.SendDriver
import org.bramble.wallet.send.SendFailureText
import org.bramble.wallet.send.reviewRisks

/**
 * The Swap journey (`swap-ui.ts`), twin of the iOS `SwapFlowModel`: a pair, an amount, the quote,
 * then the review and the submission. Every decision is the core's `TokenSwap` (the quote and
 * build requests, their judgement, the pinned router, the reviewed floor) and then its
 * [TransferPlan] (fee, signing, broadcast), run by the same [SendDriver] as a send. This only
 * moves bytes the core described over the app's one bounded HTTP path and tracks the face shown.
 * One `TokenSwap` is one quote: any edit, a refused step, or Back from the review drops it, and a
 * reply that lands after its edit is dropped. Main-thread only.
 */
class SwapFlowModel(
    private val core: WalletCore,
    private val network: NetworkInfo,
    /** The vault record the core signs for. */
    private val accountId: String,
    private val preferences: TokenPreferences,
    /** Base units per tracked token id, from the portfolio's loaded balances. */
    private val balances: Map<String, String>,
    /** The wallet's own price feed for the quote's value check; null leaves the price unverified. */
    private val prices: PriceView?,
    openingToken: String? = null,
    /** Moves the quote and build requests: the bounded HTTPS path, or a fixture in tests. */
    private val http: PortfolioTransport = BoundedHttp,
    /** Moves the plan's JSON-RPC: HTTPS, or a fixture node in tests. */
    private val rpc: RpcPost = RpcClient.https,
    /** Registers each plan with the store, which cancels it on lock. */
    private val track: (TransferPlan) -> Unit = {},
) {
    /** The face the journey shows. */
    enum class Stage {
        /** The pair, the amount and the quote. */
        EDIT,

        /** The build is fetched, judged and planned to its fee. */
        PREPARING,

        /** The review: Confirm swap. */
        REVIEW,

        /** The plan signs and posts the swap once. */
        SUBMITTING,

        /** Broadcast; [confirmed] follows the chain. */
        SUBMITTED,

        /** The plan failed; [failureMessage] says what the core knows. */
        FAILED,
    }

    /** One side of the pair. */
    enum class Side {
        /** The token sold. */
        SELL,

        /** The token bought. */
        BUY,
    }

    /** The tracked tokens on the account's network. */
    val tokens: List<TokenConfig> = preferences.tracked(network.network).map { it.token }

    /** The current face. */
    var stage by mutableStateOf(Stage.EDIT)
        private set

    /** The token sold. */
    var sell by mutableStateOf<TokenConfig?>(null)
        private set

    /** The token bought. */
    var buy by mutableStateOf<TokenConfig?>(null)
        private set

    private var typed by mutableStateOf("")

    /** The amount sold, as typed ("," read as "."); any edit drops the quote. */
    var amount: String
        get() = typed
        set(text) {
            val next = text.replace(',', '.')
            if (next != typed) {
                typed = next
                close()
            }
        }

    /** The judged quote, or null. */
    var quote by mutableStateOf<SwapQuoteView?>(null)
        private set

    /** True while a quote is in flight. */
    var quoting by mutableStateOf(false)
        private set

    /** Why the last quote or build was refused (the core's sentence), or why a review fell back. */
    var note by mutableStateOf<String?>(null)
        private set

    /** The judged build: the core's call lines and the enforced minimum. */
    var swapReview by mutableStateOf<SwapReview?>(null)
        private set

    /** The plan's review: fee and affordability. */
    var review by mutableStateOf<TransferReview?>(null)
        private set

    /** True once the chain accepted or pre-confirmed the swap. */
    var confirmed by mutableStateOf(false)
        private set

    /** The swap's transaction hash once sent (or a failure reports one). */
    var hash by mutableStateOf<String?>(null)
        private set

    /** The failure line once [Stage.FAILED]. */
    var failureMessage by mutableStateOf<String?>(null)
        private set

    private var swap: TokenSwap? = null
    private var driver: SendDriver? = null
    private var generation = 0

    private val feeBalance: String?
        get() = tokens.firstOrNull { it.symbol == STRK }?.let { balances[it.id] }

    init {
        val (opening, against) = openingPair(openingToken, tokens)
        sell = opening
        buy = against
    }

    /** What a quote is keyed on: the screen re-quotes (debounced) whenever it changes. */
    val quoteKey: String get() = "${sell?.id}|${buy?.id}|$amount"

    /** The selling token's base-unit balance, null while unread. */
    val rawBalance: String? get() = sell?.let { balances[it.id] }

    /** The amount is more than the balance (an unknown balance never blocks, as the extension). */
    val insufficient: Boolean
        get() {
            val token = sell ?: return false
            val raw = rawBalance ?: return false
            val wanted = runCatching { parseTokenAmount(amount, token.decimals) }.getOrNull() ?: return false
            return decimalGreater(wanted, raw)
        }

    /** The quote's loss in percent (0 for a gain or no figure). */
    val lossPercent: Double get() = quote?.let(::valueDelta)?.let { maxOf(0.0, -it) } ?: 0.0

    /** Review swap's label: the shortfall, "Swap anyway" at a high loss, or Review swap. */
    val reviewLabel: String get() = reviewLabel(sell?.symbol?.takeIf { insufficient }, quote?.let { lossPercent })

    /** Review swap can be pressed. */
    val canReview: Boolean get() = stage == Stage.EDIT && quote != null && !insufficient

    /** The review's warnings: the core's risk flags for the batch, then the plan's own. */
    val risks: List<String>
        get() = swapReview?.flags.orEmpty().map { it.message } + review?.let { reviewRisks(it) }.orEmpty()

    /** The whole balance, exactly, for Max; null while it is unread. */
    val maxAmount: String?
        get() {
            val token = sell ?: return null
            val raw = rawBalance ?: return null
            return runCatching { formatTokenAmount(raw, token.decimals, token.decimals) }.getOrNull()
        }

    /** A token picked for one side; picking the other side's token swaps the pair. */
    fun choose(
        token: TokenConfig,
        side: Side,
    ) {
        if (side == Side.SELL) {
            if (token.id == buy?.id) buy = sell
            sell = token
        } else {
            if (token.id == sell?.id) sell = buy
            buy = token
        }
        close()
    }

    /** Swaps the sides; a quoted buy amount becomes the amount sold. */
    fun flip() {
        val bought = quote?.buyAmount
        sell = buy.also { buy = sell }
        bought?.let { amount = it }
        close()
    }

    /** A fresh quote of the pair and amount on screen; a refusal shows the core's sentence. */
    suspend fun requestQuote() {
        close()
        val mine = generation
        val text = amount.trim()
        val from = sell
        val to = buy
        if (stage != Stage.EDIT || text.isEmpty()) return
        if (from == null || to == null) return
        quoting = true
        try {
            val started =
                withContext(Dispatchers.Default) { core.prepareSwap(accountId, from.id, to.id, text, preferences) }
            val outcome = http.perform(started.quoteRequest())
            if (mine == generation) {
                quote = withContext(Dispatchers.Default) { started.acceptQuote(outcome, prices) }
                swap = started
            }
        } catch (error: SwapException) {
            if (mine == generation) note = reason(error)
        } finally {
            if (mine == generation) quoting = false
        }
    }

    /** Builds the quoted swap, judges the build, and runs its plan to the review. */
    suspend fun reviewSwap() {
        val pending = swap?.takeIf { canReview } ?: return
        val mine = generation
        stage = Stage.PREPARING
        val plan =
            try {
                val outcome = http.perform(pending.buildRequest(null))
                if (mine == generation && stage == Stage.PREPARING) {
                    swapReview = withContext(Dispatchers.Default) { pending.acceptBuild(outcome) }
                    withContext(Dispatchers.Default) { pending.plan(feeBalance) }
                } else {
                    null
                }
            } catch (error: SwapException) {
                backToEdit(reason(error))
                null
            } ?: return
        swap = null
        track(plan)
        val started = SendDriver(plan, network, rpc).also { driver = it }
        showReview(started, StepReply.Start)
    }

    /** Re-probes the endpoints and asks the plan for a new fee estimate. */
    suspend fun retryFee() {
        val current = driver?.takeIf { stage == Stage.REVIEW } ?: return
        current.releaseEndpoint()
        stage = Stage.PREPARING
        showReview(current, StepReply.RetryEstimate)
    }

    /** Confirms the reviewed plan; the core re-checks, signs and posts it once. */
    suspend fun confirm() {
        val current = driver ?: return
        if (stage != Stage.REVIEW || review?.canConfirm != true) return
        stage = Stage.SUBMITTING
        failureMessage = null
        val failure =
            when (val step = current.step(StepReply.Confirm)) {
                null -> {
                    current.plan.interruptedFailure() ?: SendFailure(SendFailureCode.LOCKED, null, null)
                }

                is SendStep.Broadcast -> {
                    hash = step.hash
                    stage = Stage.SUBMITTED
                    val status = (current.step(StepReply.Proceed) as? SendStep.Finished)?.status
                    confirmed = status == TxStatus.ACCEPTED || status == TxStatus.PRECONFIRMED
                    failureMessage = statusFailure(status)
                    null
                }

                is SendStep.Failed -> {
                    step.failure
                }

                else -> {
                    SendFailure(SendFailureCode.NODE_ERROR, null, null)
                }
            }
        failure?.let {
            failureMessage = SendFailureText.message(it)
            it.hash?.let { sent -> hash = sent }
        }
        if (failureMessage != null) {
            driver = null
            stage = Stage.FAILED
        }
    }

    /**
     * Back: from the review (or a failure) to the edit face, and true when the journey should
     * leave instead. Ignored while submitting.
     */
    fun back(): Boolean =
        when (stage) {
            Stage.EDIT, Stage.SUBMITTED -> {
                true
            }

            Stage.SUBMITTING -> {
                false
            }

            Stage.PREPARING, Stage.REVIEW, Stage.FAILED -> {
                backToEdit(null)
                false
            }
        }

    /**
     * Drops the quote and any open plan: an edit, dismissal or lock. The core keeps the pending
     * record of any write that already left.
     */
    fun close() {
        generation += 1
        quote = null
        swap = null
        note = null
        quoting = false
        driver?.plan?.cancel()
        driver = null
    }

    private suspend fun showReview(
        current: SendDriver,
        reply: StepReply,
    ) {
        val step = current.step(reply)
        if (driver !== current) return
        val card = current.plan.currentReview()
        when {
            step is SendStep.Review && card != null -> {
                review = card
                stage = Stage.REVIEW
            }

            step is SendStep.Failed -> {
                backToEdit(SendFailureText.message(step.failure))
            }

            else -> {
                backToEdit(SendFailureText.message(SendFailure(SendFailureCode.NODE_ERROR, null, null)))
            }
        }
    }

    private fun backToEdit(reason: String?) {
        close()
        swapReview = null
        review = null
        stage = Stage.EDIT
        note = reason
    }

    private companion object {
        const val STRK = "STRK"
    }
}

/** Runs [this] driver from [reply]; null when the plan refused the step (`PlanClosed` after a lock). */
private suspend fun SendDriver.step(reply: StepReply): SendStep? =
    try {
        run(reply)
    } catch (ignored: SendException) {
        null
    }

/** The failure line for a chain answer that is not a success; null for any other. */
private fun statusFailure(status: TxStatus?): String? =
    when (status) {
        TxStatus.REJECTED -> SendCopy.rejectedMessage
        TxStatus.REVERTED -> SendCopy.revertedMessage
        else -> null
    }

/** The core's refusal sentence, as written; the lock's own line for a lock. */
internal fun reason(error: SwapException): String =
    when (error) {
        is SwapException.Refused -> error.reason
        is SwapException.Locked -> SendFailureText.message(SendFailure(SendFailureCode.LOCKED, null, null))
        else -> SwapCopy.swapFailed
    }
