package org.bramble.wallet.staking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.core.PositionState
import org.bramble.core.RowFigures
import org.bramble.core.StakingAction
import org.bramble.core.StakingRowView
import org.bramble.core.accountLabel
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.errors.friendlyError
import org.bramble.wallet.send.CostBox
import org.bramble.wallet.send.Outcome
import org.bramble.wallet.send.ReceiptCard
import org.bramble.wallet.send.RisksPanel
import org.bramble.wallet.send.SendCopy
import org.bramble.wallet.send.reviewCost

/** Starts an action on a row: the action, the row, and the amount typed (stake and unstake). */
internal typealias StakingAct = (StakingAction, StakingRowView, String?) -> Unit

/**
 * `validatorSection`: All validators, the name and full address (what the review names), the
 * exit window the staking contract reports, then one row per tracked token.
 */
@Composable
internal fun ValidatorSection(
    model: StakingModel,
    validator: StakingValidator,
    act: StakingAct,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        PillButton(StakingCopy.validatorAllValidators, kind = PillKind.GHOST) { model.closeValidator() }
        Text(
            validator.name ?: StakingCopy.validatorName,
            color = skin.text,
            style = textStyle(BrambleTypeScale.row, BrambleWeight.bold),
        )
        SelectionContainer {
            Text(validator.staker, color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true))
        }
        when (val pools = model.pools) {
            is StakingLoad.Failed -> {
                StatusLine(pools.message, StatusTone.DANGER)
            }

            is StakingLoad.Loaded -> {
                Text(
                    exitWindowLine(pools.value.exitWindowSeconds),
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.body),
                )
                if (pools.value.rows.isEmpty()) StatusLine(StakingCopy.validatorNoTokens)
                pools.value.rows.forEach { PoolRow(it, act) }
            }

            else -> {
                StatusLine(StakingCopy.validatorLoading)
            }
        }
    }
}

/** `stakingRow`: symbol, commission, position, action buttons, then the stake and unstake forms. */
@Composable
private fun PoolRow(
    row: StakingRowView,
    act: StakingAct,
) {
    val skin = LocalSkin.current
    RowPanel("staking-row-${row.symbol}") {
        Text(row.symbol, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
        val figures = row.figures
        if (figures == null) {
            row.refusal?.let {
                Text(
                    friendlyError(it),
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.caption),
                )
            }
        } else {
            PoolActions(row, figures, act)
        }
    }
}

/** A verified row's commission, position, action buttons and amount forms. */
@Composable
private fun PoolActions(
    row: StakingRowView,
    figures: RowFigures,
    act: StakingAct,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        val lines = listOf(commissionLine(row, figures)) + positionLines(row, ::coreAmount, ::accountLabel)
        lines.forEach { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
        rowButtons(figures).forEach { action ->
            val kind = if (action == StakingAction.WITHDRAW) PillKind.PRIMARY else PillKind.SECONDARY
            PillButton(actionLabel(action), kind = kind) { act(action, row, null) }
        }
        if (figures.accepting) {
            AmountForm(row, StakingAction.STAKE, act)
        } else {
            Text(StakingCopy.validatorLeaving, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
        if (figures.state == PositionState.STAKED) AmountForm(row, StakingAction.UNSTAKE, act)
    }
}

/** An amount field and its button; an empty field does nothing, as the extension focuses it. */
@Composable
private fun AmountForm(
    row: StakingRowView,
    action: StakingAction,
    act: StakingAct,
) {
    var amount by remember { mutableStateOf("") }
    val label = if (action == StakingAction.STAKE) StakingCopy.actionStakeAmount else StakingCopy.actionUnstakeAmount
    Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        org.bramble.wallet.design.BrambleField(
            label = null,
            placeholder = "0 ${row.symbol}",
            value = amount,
            onValueChange = { amount = it },
            modifier = Modifier.weight(1f),
            kind = SecretKind.AMOUNT,
            spokenLabel = fill(label, "symbol" to row.symbol),
        )
        PillButton(
            actionLabel(action),
            kind = if (action == StakingAction.STAKE) PillKind.PRIMARY else PillKind.SECONDARY,
        ) { amount.trim().takeIf { it.isNotEmpty() }?.let { act(action, row, it) } }
    }
}

/**
 * One staking action's review and outcome, in place of the staking screen while it is open.
 * Built from the Send screens' parts (Cost box, risks panel, outcome), so a staking confirm reads
 * like every other confirm. The sentence is the core's with the extension's fee line; Confirm
 * carries the fee it signs under. Leaving cancels an unsigned plan.
 */
@Composable
internal fun StakingActionScreen(
    store: WalletStore,
    model: StakingActionModel,
    viewActivity: () -> Unit,
    close: () -> Unit,
) {
    CloseOnLeave(model)
    LaunchedEffect(model) { model.prepare() }
    LaunchedEffect(model.stage) {
        if (model.stage == StakingActionModel.Stage.SUBMITTED) {
            store.showToast(StakingCopy.reviewSubmitted, positive = true)
        }
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(actionLabel(model.action), subtitle = model.symbol, network = store.networkLabel, back = close)
        when (model.stage) {
            StakingActionModel.Stage.PREPARING -> {
                StatusLine(StakingCopy.reviewEstimating)
                PillButton(actionLabel(model.action), busy = true) {}
            }

            StakingActionModel.Stage.REVIEW, StakingActionModel.Stage.SUBMITTING -> {
                ActionReview(model)
            }

            StakingActionModel.Stage.REFUSED -> {
                StatusLine(model.message, StatusTone.DANGER)
                PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = close)
            }

            StakingActionModel.Stage.SUBMITTED, StakingActionModel.Stage.FAILED -> {
                ActionOutcome(store, model, viewActivity, close)
            }
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The core's sentence with the fee line, the Cost box when there is no fee, risks, Confirm. */
@Composable
private fun ActionReview(model: StakingActionModel) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val submitting = model.stage == StakingActionModel.Stage.SUBMITTING
    model.reviewLine?.let { line ->
        RowPanel("staking-review") {
            SelectionContainer { Text(line, color = skin.text, style = textStyle(BrambleTypeScale.body)) }
        }
    }
    model.review?.takeIf { it.fee == null }?.let { review ->
        CostBox(reviewCost(review)) { scope.launch { model.retryFee() } }
    }
    if (model.shortfall) Text(SendCopy.shortfall, color = skin.warning, style = textStyle(BrambleTypeScale.caption))
    RisksPanel(model.risks)
    if (submitting) StatusLine(StakingCopy.reviewSubmitting)
    PillButton(
        model.confirmLabel,
        icon = BrambleIconName.CHECK,
        busy = submitting,
        enabled = model.review?.canConfirm == true,
    ) { scope.launch { model.confirm() } }
}

/** Submitted (Activity follows it) or failed (the reason, and the hash if one exists). */
@Composable
private fun ActionOutcome(
    store: WalletStore,
    model: StakingActionModel,
    viewActivity: () -> Unit,
    close: () -> Unit,
) {
    val skin = LocalSkin.current
    val submitted = model.stage == StakingActionModel.Stage.SUBMITTED
    Outcome(
        if (submitted) BrambleIconName.CHECK else BrambleIconName.ALERT,
        if (submitted) skin.positive else skin.danger,
        if (submitted) StakingCopy.reviewSubmitted else StakingCopy.reviewFailed,
        message = if (submitted) StakingCopy.reviewSubmittedFollow else model.message,
        detail = { ReceiptCard(store, summary = null, hash = model.hash) },
    ) {
        PillButton(SendCopy.viewActivity, icon = BrambleIconName.ACTIVITY) {
            close()
            viewActivity()
        }
        PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = close)
    }
}
