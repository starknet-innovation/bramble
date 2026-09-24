package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import org.bramble.core.FeeAffordability
import org.bramble.core.ReviewFlag
import org.bramble.core.TransferReview
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleShadow
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.brambleShadow
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.AddressClipboard

// The review, working and outcome stages of `SendScreen` (split by stage to stay readable; the
// shapes are `SendScreen.kt`'s). Uncompiled: checked by reading against the generated bindings.

@Composable
internal fun ReviewStage(store: WalletStore, model: SendFlowModel, review: TransferReview, retry: () -> Unit, confirm: () -> Unit) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    var detailsOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        // The flow header titles the stage; the head row keeps only Edit.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Box(Modifier.width(BrambleSize.tile + BrambleSize.mark)) {
                PillButton(SendCopy.edit, kind = PillKind.GHOST) { model.edit() }
            }
        }
        // `.send-review-summary`: token hero over the recipient fact.
        Column(Modifier.fillMaxWidth().background(skin.panel, cardShape).padding(BrambleSpace.lg)) {
            Row(Modifier.padding(bottom = BrambleSpace.lg), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md), verticalAlignment = Alignment.CenterVertically) {
                TokenMark(model.token.address, review.tokenSymbol)
                Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                    Text("${review.amountDisplay} ${review.tokenSymbol}", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
                    Text(SendCopy.fiatUnavailable, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                }
            }
            Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            Row(Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact), verticalAlignment = Alignment.CenterVertically) {
                Text(SendCopy.recipientRowLabel, color = skin.muted, style = textStyle(BrambleTypeScale.label), modifier = Modifier.weight(1f))
                Text(review.recipientShort, color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true))
                IconButton(BrambleIconName.COPY, SendCopy.copyRecipient, tint = skin.muted) {
                    AddressClipboard.copy(context, review.recipient, store.appScope)
                }
            }
        }
        FeeSection(review, retry)
        // `.send-review-disclosure`: technical details behind a full-width summary row.
        Column(Modifier.fillMaxWidth().clip(panelShape).background(skin.panel, panelShape)) {
            Row(
                Modifier.fillMaxWidth()
                    .fillPress(Color.Transparent, skin.softPress, panelShape, pressedScale = 1f) { detailsOpen = !detailsOpen }
                    .heightIn(min = BrambleSize.rowCompact)
                    .padding(horizontal = BrambleSpace.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(SendCopy.technicalDetails, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold), modifier = Modifier.weight(1f))
                BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, modifier = Modifier.rotate(if (detailsOpen) 180f else 0f))
            }
            if (detailsOpen) {
                Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
                Column(Modifier.padding(BrambleSpace.md), verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                    Eyebrow(SendCopy.whatWillHappen)
                    Text(review.summary, color = skin.text, style = textStyle(BrambleTypeScale.body))
                    Eyebrow(SendCopy.riskAndRecovery)
                    flagMessages(review).forEach { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.body)) }
                }
            }
        }
        StatusLine(model.reviewBlock, StatusTone.DANGER)
        Text(SendCopy.reviewNote, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        PillButton(SendCopy.confirmLabel, icon = BrambleIconName.CHECK, enabled = review.canConfirm, onClick = confirm)
    }
}

private fun flagMessages(review: TransferReview): List<String> {
    val messages = review.flags.map { if (it == ReviewFlag.SELF_TRANSFER) SendCopy.selfTransfer else SendCopy.poisonedRecipient }.toMutableList()
    if (review.requiresDeployment) messages += SendCopy.deployNote
    return messages.ifEmpty { listOf(SendCopy.noWarnings) }
}

/** `.send-review-fee` with the extension's four fee states, first match wins. */
@Composable
private fun FeeSection(review: TransferReview, retry: () -> Unit) {
    val skin = LocalSkin.current
    val fee = review.fee
    val deployment = review.deploymentFee
    Column(
        Modifier.fillMaxWidth().background(skin.panel, panelShape).padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Eyebrow(SendCopy.maximumCost)
        val line = @Composable { text: String -> Text(text, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold)) }
        val failed = @Composable { text: String ->
            StatusLine(text, StatusTone.DANGER)
            PillButton(SendCopy.retryFee, kind = PillKind.SECONDARY, icon = BrambleIconName.REFRESH, onClick = retry)
        }
        when {
            review.requiresDeployment && fee != null && deployment != null -> {
                line(SendCopy.transactionFeePrefix + fee.display)
                line(SendCopy.deploymentFeePrefix + deployment.display)
            }
            review.requiresDeployment -> failed(SendCopy.feesFailed)
            fee != null -> line(SendCopy.feePrefix + fee.display)
            else -> failed(SendCopy.feeFailed)
        }
        if (fee != null && review.affordability == FeeAffordability.INSUFFICIENT) {
            Text(SendCopy.shortfall, color = skin.warning, style = textStyle(BrambleTypeScale.caption))
        }
    }
}

/** `#send-working`: centred progress, the stage's copy, and the task list. */
@Composable
internal fun WorkingStage(stage: SendFlowModel.Stage) {
    val skin = LocalSkin.current
    val (title, copy, liveness) = when (stage) {
        SendFlowModel.Stage.BROADCASTING -> Triple(SendCopy.workingBroadcastingTitle, SendCopy.workingBroadcastingCopy, SendCopy.keepAppOpen)
        SendFlowModel.Stage.CONFIRMING -> Triple(SendCopy.workingConfirmingTitle, SendCopy.workingConfirmingCopy, SendCopy.workingConfirmingLiveness)
        else -> Triple(SendCopy.workingAuthorizingTitle, SendCopy.workingAuthorizingCopy, SendCopy.keepAppOpen)
    }
    val (labels, active) = when (stage) {
        SendFlowModel.Stage.BROADCASTING -> listOf(SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm) to 2
        SendFlowModel.Stage.CONFIRMING -> listOf(SendCopy.taskReviewLocked, SendCopy.taskAuthorized, SendCopy.taskBroadcastComplete, SendCopy.taskConfirm) to 3
        else -> listOf(SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm) to 1
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        Box(Modifier.size(BrambleSize.brand), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = skin.accent, strokeWidth = BrambleLayout.checkStroke, modifier = Modifier.size(BrambleSpace.xl))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Text(title, color = skin.text, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold), modifier = Modifier.semantics { heading() })
            Text(copy, color = skin.muted, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.body))
        }
        // `.send-task-list`: the panel with the xs elevation, hairlines inset past the dot.
        Column(
            Modifier.fillMaxWidth().brambleShadow(BrambleShadow.xs, panelShape).background(skin.panel, panelShape)
                .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.sm),
        ) {
            labels.forEachIndexed { index, label ->
                if (index > 0) {
                    Box(Modifier.fillMaxWidth().padding(start = BrambleLayout.sendTaskHairlineInset).height(BrambleLayout.hairline).background(skin.hairline))
                }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = BrambleControl.hit),
                    horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val dot = when {
                        index < active -> skin.positive
                        index == active -> skin.accent
                        else -> skin.hairlineStrong
                    }
                    Box(Modifier.size(BrambleSpace.sm).background(dot, CircleShape))
                    Text(
                        label,
                        color = if (index > active) skin.muted else skin.text,
                        style = textStyle(BrambleTypeScale.label, if (index == active) BrambleWeight.semibold else BrambleWeight.regular),
                    )
                }
            }
        }
        Text(liveness, color = skin.muted, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.caption))
    }
}

/** `.send-outcome`: a centred mark, kicker, title, copy and hash, then the stage's actions. */
@Composable
internal fun Outcome(
    icon: BrambleIconName,
    tint: Color,
    kicker: String,
    title: String,
    message: String?,
    hash: String?,
    actions: @Composable ColumnScope.() -> Unit,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        Box(Modifier.size(BrambleLayout.sendOutcomeMark), contentAlignment = Alignment.Center) {
            BrambleIcon(icon, tint, BrambleSize.mark)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Text(kicker, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
            Text(title, color = skin.text, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold, BrambleTracking.display), modifier = Modifier.semantics { heading() })
            if (message != null) Text(message, color = skin.muted, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.body))
            if (hash != null) {
                Text(hash, color = skin.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = textStyle(BrambleTypeScale.mono, mono = true))
            }
        }
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm), content = actions)
    }
}
