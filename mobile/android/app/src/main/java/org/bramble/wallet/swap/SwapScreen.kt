package org.bramble.wallet.swap

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.bramble.core.DisplayCurrency
import org.bramble.core.formatFiat
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.makeSwapModel
import org.bramble.wallet.refreshBalances
import org.bramble.wallet.send.CostBox
import org.bramble.wallet.send.Outcome
import org.bramble.wallet.send.Receipt
import org.bramble.wallet.send.ReceiptCard
import org.bramble.wallet.send.RisksPanel
import org.bramble.wallet.send.panelShape
import org.bramble.wallet.send.reviewCost

/** `QUOTE_DEBOUNCE_MS`: a quote is asked for this long after the last edit. */
private const val QUOTE_DEBOUNCE_MS = 350L

/**
 * `swapFlow` from `swap-views.ts`, port of the iOS `SwapView`: the Sell and Buy panels around the
 * flip control, the rate and fee line, Review swap; then the review on the Send review's parts
 * (receipt, Cost box, risks panel) and the receipt. Every string is the extension's ([SwapCopy],
 * generated) or the core's; the plan closes when the screen leaves. [startToken] is a tracked
 * token id to sell (a token screen's Swap), or null for ETH → STRK.
 */
@Composable
fun SwapScreen(
    store: WalletStore,
    back: () -> Unit,
    viewActivity: () -> Unit,
    startToken: String? = null,
) {
    val model = remember { store.makeSwapModel(startToken) }
    if (model == null) {
        LaunchedEffect(Unit) { back() }
        return
    }
    val scope = rememberCoroutineScope()
    DisposableEffect(model) { onDispose { model.close() } }
    LaunchedEffect(model.quoteKey) {
        if (model.stage == SwapFlowModel.Stage.EDIT) {
            delay(QUOTE_DEBOUNCE_MS)
            model.requestQuote()
        }
    }
    val leave = { exit: () -> Unit ->
        store.appScope.launch { store.refreshBalances() }
        exit()
    }
    val stepBack = {
        if (model.back()) {
            leave(back)
        } else if (model.stage == SwapFlowModel.Stage.EDIT) {
            scope.launch { model.requestQuote() }
        }
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(title(model), network = store.networkLabel, back = { stepBack() })
        when (model.stage) {
            SwapFlowModel.Stage.EDIT, SwapFlowModel.Stage.PREPARING -> EditFace(model)
            SwapFlowModel.Stage.REVIEW, SwapFlowModel.Stage.SUBMITTING -> ReviewFace(model, store.appScope)
            else -> OutcomeFace(store, model, viewActivity = { leave(viewActivity) }, back = { leave(back) })
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The header title for the face shown. */
private fun title(model: SwapFlowModel): String =
    when (model.stage) {
        SwapFlowModel.Stage.EDIT, SwapFlowModel.Stage.PREPARING -> SwapCopy.title
        SwapFlowModel.Stage.REVIEW, SwapFlowModel.Stage.SUBMITTING -> SwapCopy.reviewTitle
        SwapFlowModel.Stage.SUBMITTED -> if (model.confirmed) SwapCopy.complete else SwapCopy.submitted
        SwapFlowModel.Stage.FAILED -> SwapCopy.swapFailed
    }

/** `#swap-edit`: Sell, the flip, Buy, the rate and fee, the loss warning, the refusal, Review swap. */
@Composable
private fun EditFace(model: SwapFlowModel) {
    val scope = rememberCoroutineScope()
    val editing = model.stage == SwapFlowModel.Stage.EDIT
    val quoted = model.quote != null
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Panel(model, SwapFlowModel.Side.SELL)
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            IconButton(BrambleIconName.ARROW_DOWN, SwapCopy.flip, enabled = editing) { model.flip() }
        }
        Panel(model, SwapFlowModel.Side.BUY)
        Meta(model) { scope.launch { model.requestQuote() } }
        if (quoted && model.lossPercent >= SwapCopy.lossWarnPercent) {
            StatusLine(SwapCopy.highSlippage, StatusTone.DANGER)
        }
        when {
            !editing -> StatusLine(SwapCopy.preparing)
            model.quoting -> StatusLine(SwapCopy.finding)
            else -> StatusLine(model.note, StatusTone.DANGER)
        }
        PillButton(
            model.reviewLabel,
            kind =
                if (quoted &&
                    model.lossPercent >= SwapCopy.lossHighRiskPercent
                ) {
                    PillKind.DANGER
                } else {
                    PillKind.PRIMARY
                },
            icon = BrambleIconName.SWAP,
            busy = !editing,
            enabled = model.canReview,
        ) { scope.launch { model.reviewSwap() } }
    }
}

/** `.swap-meta`: "1 SELL = x BUY", "Fee ≈ $…", and Refresh quote. */
@Composable
private fun Meta(
    model: SwapFlowModel,
    refresh: () -> Unit,
) {
    val skin = LocalSkin.current
    val quote = model.quote
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        val style = textStyle(BrambleTypeScale.caption).copy(fontFeatureSettings = "tnum")
        Text(
            quote?.let { rateLine(it, model.sell?.symbol.orEmpty(), model.buy?.symbol.orEmpty()) }.orEmpty(),
            color = skin.muted,
            style = style,
            modifier = Modifier.weight(1f),
        )
        quote?.let {
            Text(
                SwapCopy.fee.replace("{amount}", formatFiat(it.gasFeesInUsd, DisplayCurrency.USD)),
                color = skin.muted,
                style = style,
            )
        }
        IconButton(
            BrambleIconName.REFRESH,
            SwapCopy.refreshQuote,
            tint = skin.muted,
            enabled = model.stage == SwapFlowModel.Stage.EDIT && model.amount.isNotEmpty() && !model.quoting,
            onClick = refresh,
        )
    }
}

/**
 * `#swap-confirm`: what is sold and received with the enforced minimum the core decoded from the
 * frozen route, the core's line for each call it will sign, the Cost box, the risks, Confirm swap.
 * Both actions run on [scope], the store's app scope: each changes the stage, which disposes this
 * face, and a face's own scope would cancel the fee retry and the chain status with it. The
 * model's driver guard drops a result for a plan the user left.
 */
@Composable
private fun ReviewFace(
    model: SwapFlowModel,
    scope: CoroutineScope,
) {
    val skin = LocalSkin.current
    val review = model.review
    val judged = model.swapReview
    val quote = model.quote
    if (review == null || judged == null || quote == null) return
    val sell = model.sell?.symbol.orEmpty()
    val buy = model.buy?.symbol.orEmpty()
    val submitting = model.stage == SwapFlowModel.Stage.SUBMITTING
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Receipt(
            listOf(
                SwapCopy.reviewSell to "${quote.sellAmount} $sell",
                SwapCopy.reviewReceive to "${quote.buyAmount} $buy",
                SwapCopy.minimumReceived to "${judged.minBuyAmount} $buy",
            ),
        )
        Column(
            Modifier.fillMaxWidth().background(skin.panel, panelShape).padding(BrambleSpace.lg),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            judged.summaries.forEach { Text(it, color = skin.text, style = textStyle(BrambleTypeScale.caption)) }
        }
        CostBox(reviewCost(review)) { scope.launch { model.retryFee() } }
        RisksPanel(model.risks)
        PillButton(
            if (submitting) SwapCopy.submitting else SwapCopy.confirm,
            icon = BrambleIconName.CHECK,
            busy = submitting,
            enabled = review.canConfirm,
        ) { scope.launch { model.confirm() } }
    }
}

/** `#swap-success`, or the failure, with the hash and the ways out. */
@Composable
private fun OutcomeFace(
    store: WalletStore,
    model: SwapFlowModel,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val skin = LocalSkin.current
    val failed = model.stage == SwapFlowModel.Stage.FAILED
    Outcome(
        if (failed) BrambleIconName.ALERT else BrambleIconName.CHECK,
        if (failed) skin.danger else skin.positive,
        title(model),
        message = if (failed) model.failureMessage else SwapCopy.notConfirmed.takeUnless { model.confirmed },
        detail = { ReceiptCard(store, summary = null, hash = model.hash) },
    ) {
        PillButton(SwapCopy.viewActivity, icon = BrambleIconName.ACTIVITY, onClick = viewActivity)
        PillButton(SwapCopy.back, kind = PillKind.SECONDARY, onClick = back)
    }
}
