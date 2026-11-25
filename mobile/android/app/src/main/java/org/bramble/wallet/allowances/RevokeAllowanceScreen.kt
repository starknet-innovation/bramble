package org.bramble.wallet.allowances

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.launch
import org.bramble.core.AllowanceView
import org.bramble.wallet.WalletStore
import org.bramble.wallet.allowanceTokens
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.feeBalance
import org.bramble.wallet.makeRevokeModel
import org.bramble.wallet.refreshSendState
import org.bramble.wallet.send.CostBox
import org.bramble.wallet.send.Outcome
import org.bramble.wallet.send.Receipt
import org.bramble.wallet.send.ReceiptCard
import org.bramble.wallet.send.RisksPanel
import org.bramble.wallet.send.SendCopy
import org.bramble.wallet.send.reviewCost
import org.bramble.wallet.ui.shortAddress

/**
 * One allowance's revoke, port of the iOS `RevokeAllowanceView`, built from the Send screens
 * (receipt, Cost box, risks panel, outcome) as Deploy account is: the grant's Spender / Token /
 * Allowance rows, the core's review summary, its fee and risks, then one Revoke button. The review
 * is fetched as the screen opens, so the fee is on screen before the press. Every review, risk and
 * refusal sentence is the core's; the plan closes when the screen leaves.
 */
@Composable
fun RevokeAllowanceScreen(
    store: WalletStore,
    allowance: AllowanceView,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val model = remember { store.makeRevokeModel(allowance) }
    if (model == null) {
        // Locked: nothing to revoke from.
        LaunchedEffect(Unit) { back() }
        return
    }
    DisposableEffect(model) { onDispose { model.close() } }
    LaunchedEffect(model) { model.prepare(store.feeBalance) }
    LaunchedEffect(model.stage) {
        if (model.stage == RevokeFlowModel.Stage.SUBMITTED) store.showNotice(AllowanceCopy.SUBMITTED)
    }
    val activity = {
        store.appScope.launch { store.refreshSendState() }
        viewActivity()
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(AllowanceCopy.REVOKE, network = store.networkLabel, back = back)
        if (model.stage == RevokeFlowModel.Stage.SUBMITTED) {
            Outcome(
                BrambleIconName.CHECK,
                LocalSkin.current.positive,
                AllowanceCopy.SUBMITTED,
                message = AllowanceCopy.REVOKING.takeUnless { model.confirmed },
                detail = { ReceiptCard(store, summary = null, hash = model.hash) },
            ) {
                PillButton(SendCopy.viewActivity, icon = BrambleIconName.ACTIVITY, onClick = activity)
                PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
            }
        } else {
            RevokeForm(store, model, activity, back)
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The grant's rows, the core's review, then the one action the stage allows. */
@Composable
private fun RevokeForm(
    store: WalletStore,
    model: RevokeFlowModel,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val allowance = model.allowance
    val token = trackedToken(allowance.token, store.allowanceTokens)
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Receipt(
            listOf(
                AllowanceCopy.SPENDER_ROW to shortAddress(allowance.spender),
                AllowanceCopy.TOKEN_ROW to (token?.symbol ?: shortAddress(allowance.token)),
                AllowanceCopy.AMOUNT_ROW to amountLabel(allowance, token),
            ),
        )
        model.review?.let { review ->
            // The core's own sentence for the one call it will sign.
            Text(
                review.summary,
                color = LocalSkin.current.text,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                modifier = Modifier.testTag("revoke-summary"),
            )
            CostBox(reviewCost(review)) { scope.launch { model.retryFee() } }
            RisksPanel(model.risks)
        }
        StatusLine(revokeStatus(model), if (model.message == null) StatusTone.MUTED else StatusTone.DANGER)
        when {
            model.stage == RevokeFlowModel.Stage.REFUSED -> {
                PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
            }

            model.stage == RevokeFlowModel.Stage.FAILED && model.hash != null -> {
                // It may be on chain: follow it in Activity rather than revoke blind a second time.
                PillButton(SendCopy.viewActivity, icon = BrambleIconName.ACTIVITY, onClick = viewActivity)
                PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
            }

            model.stage == RevokeFlowModel.Stage.FAILED -> {
                PillButton(
                    SendCopy.tryAgain,
                    icon = BrambleIconName.REFRESH,
                ) { scope.launch { model.prepare(store.feeBalance) } }
                PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
            }

            else -> {
                PillButton(
                    AllowanceCopy.REVOKE,
                    Modifier.testTag("revoke-confirm"),
                    icon = BrambleIconName.CHECK,
                    busy =
                        model.stage == RevokeFlowModel.Stage.PREPARING ||
                            model.stage == RevokeFlowModel.Stage.SUBMITTING,
                    enabled = model.stage == RevokeFlowModel.Stage.REVIEW && model.review?.canConfirm == true,
                ) { scope.launch { model.confirm() } }
            }
        }
    }
}

/**
 * Estimating while the review is fetched, the fee block when it cannot be confirmed, or why the
 * revoke was refused or failed.
 */
internal fun revokeStatus(model: RevokeFlowModel): String? =
    model.message
        ?: when {
            model.stage == RevokeFlowModel.Stage.PREPARING -> {
                SendCopy.deployEstimating
            }

            model.stage == RevokeFlowModel.Stage.REVIEW && model.review?.canConfirm == false -> {
                SendCopy.feeUnavailableBlock
            }

            else -> {
                null
            }
        }
