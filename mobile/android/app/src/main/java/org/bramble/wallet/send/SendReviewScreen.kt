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
// shapes are `SendScreen.kt`'s).

/** The review stage: the plan's summary, fee, technical details, and Confirm. */
@Composable
internal fun ReviewStage(
    store: WalletStore,
    model: SendFlowModel,
    review: TransferReview,
    retry: () -> Unit,
    confirm: () -> Unit,
) {
    val skin = LocalSkin.current
    var detailsOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        // The flow header titles the stage; the head row keeps only Edit.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Box(Modifier.width(BrambleSize.tile + BrambleSize.mark)) {
                PillButton(SendCopy.edit, kind = PillKind.GHOST) { model.edit() }
            }
        }
        ReviewSummary(store, model, review)
        FeeSection(review, retry)
        TechnicalDetails(review, detailsOpen) { detailsOpen = !detailsOpen }
        StatusLine(model.reviewBlock, StatusTone.DANGER)
        Text(SendCopy.reviewNote, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        PillButton(SendCopy.confirmLabel, icon = BrambleIconName.CHECK, enabled = review.canConfirm, onClick = confirm)
    }
}

/** `.send-review-summary`: token hero over the recipient fact. */
@Composable
private fun ReviewSummary(
    store: WalletStore,
    model: SendFlowModel,
    review: TransferReview,
) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().background(skin.panel, cardShape).padding(BrambleSpace.lg)) {
        Row(
            Modifier.padding(bottom = BrambleSpace.lg),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TokenMark(model.token.address, review.tokenSymbol)
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                Text(
                    "${review.amountDisplay} ${review.tokenSymbol}",
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display),
                )
                Text(SendCopy.fiatUnavailable, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
            }
        }
        Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
        Row(
            Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                SendCopy.recipientRowLabel,
                color = skin.muted,
                style = textStyle(BrambleTypeScale.label),
                modifier = Modifier.weight(1f),
            )
            Text(review.recipientShort, color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true))
            IconButton(BrambleIconName.COPY, SendCopy.copyRecipient, tint = skin.muted) {
                AddressClipboard.copy(context, review.recipient, store.appScope)
            }
        }
    }
}

/** `.send-review-disclosure`: technical details behind a full-width summary row. */
@Composable
private fun TechnicalDetails(
    review: TransferReview,
    open: Boolean,
    onToggle: () -> Unit,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().clip(panelShape).background(skin.panel, panelShape)) {
        Row(
            Modifier
                .fillMaxWidth()
                .fillPress(Color.Transparent, skin.softPress, panelShape, pressedScale = 1f, onClick = onToggle)
                .heightIn(min = BrambleSize.rowCompact)
                .padding(horizontal = BrambleSpace.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                SendCopy.technicalDetails,
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                modifier = Modifier.weight(1f),
            )
            BrambleIcon(
                BrambleIconName.CHEVRON_DOWN,
                skin.muted,
                modifier = Modifier.rotate(if (open) CHEVRON_OPEN_DEGREES else 0f),
            )
        }
        if (open) {
            Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            Column(Modifier.padding(BrambleSpace.md), verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                Eyebrow(SendCopy.whatWillHappen)
                Text(review.summary, color = skin.text, style = textStyle(BrambleTypeScale.body))
                Eyebrow(SendCopy.riskAndRecovery)
                flagMessages(
                    review,
                ).forEach { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.body)) }
            }
        }
    }
}

/** The disclosure chevron's turn while the details are open. */
private const val CHEVRON_OPEN_DEGREES = 180f

private fun flagMessages(review: TransferReview): List<String> {
    val messages =
        review.flags
            .map {
                if (it ==
                    ReviewFlag.SELF_TRANSFER
                ) {
                    SendCopy.selfTransfer
                } else {
                    SendCopy.poisonedRecipient
                }
            }.toMutableList()
    if (review.requiresDeployment) messages += SendCopy.deployNote
    return messages.ifEmpty { listOf(SendCopy.noWarnings) }
}

/** `.send-review-fee` with the extension's four fee states, first match wins. */
@Composable
private fun FeeSection(
    review: TransferReview,
    retry: () -> Unit,
) {
    val skin = LocalSkin.current
    val fee = review.fee
    val deployment = review.deploymentFee
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                skin.panel,
                panelShape,
            ).padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Eyebrow(SendCopy.maximumCost)
        val line = @Composable { text: String ->
            Text(text, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
        }
        val failed = @Composable { text: String ->
            StatusLine(text, StatusTone.DANGER)
            PillButton(SendCopy.retryFee, kind = PillKind.SECONDARY, icon = BrambleIconName.REFRESH, onClick = retry)
        }
        when {
            review.requiresDeployment && fee != null && deployment != null -> {
                line(SendCopy.transactionFeePrefix + fee.display)
                line(SendCopy.deploymentFeePrefix + deployment.display)
            }

            review.requiresDeployment -> {
                failed(SendCopy.feesFailed)
            }

            fee != null -> {
                line(SendCopy.feePrefix + fee.display)
            }

            else -> {
                failed(SendCopy.feeFailed)
            }
        }
        if (fee != null && review.affordability == FeeAffordability.INSUFFICIENT) {
            Text(SendCopy.shortfall, color = skin.warning, style = textStyle(BrambleTypeScale.caption))
        }
    }
}

/** What the working stage shows for one stage: its copy, and the task list with the active task. */
private data class WorkingCopy(
    val title: String,
    val copy: String,
    val liveness: String,
    val tasks: List<String>,
    val active: Int,
)

/** Task indices in the working list: review, sign (authorize), broadcast, confirm. */
private const val TASK_SIGN = 1
private const val TASK_BROADCAST = 2
private const val TASK_CONFIRM = 3

private fun workingCopy(stage: SendFlowModel.Stage): WorkingCopy =
    when (stage) {
        SendFlowModel.Stage.BROADCASTING -> {
            WorkingCopy(
                SendCopy.workingBroadcastingTitle,
                SendCopy.workingBroadcastingCopy,
                SendCopy.keepAppOpen,
                listOf(SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm),
                TASK_BROADCAST,
            )
        }

        SendFlowModel.Stage.CONFIRMING -> {
            WorkingCopy(
                SendCopy.workingConfirmingTitle,
                SendCopy.workingConfirmingCopy,
                SendCopy.workingConfirmingLiveness,
                listOf(
                    SendCopy.taskReviewLocked,
                    SendCopy.taskAuthorized,
                    SendCopy.taskBroadcastComplete,
                    SendCopy.taskConfirm,
                ),
                TASK_CONFIRM,
            )
        }

        else -> {
            WorkingCopy(
                SendCopy.workingAuthorizingTitle,
                SendCopy.workingAuthorizingCopy,
                SendCopy.keepAppOpen,
                listOf(SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm),
                TASK_SIGN,
            )
        }
    }

/** `#send-working`: centred progress, the stage's copy, and the task list. */
@Composable
internal fun WorkingStage(stage: SendFlowModel.Stage) {
    val skin = LocalSkin.current
    val working = workingCopy(stage)
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        Box(Modifier.size(BrambleSize.brand), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                color = skin.accent,
                strokeWidth = BrambleLayout.checkStroke,
                modifier = Modifier.size(BrambleSpace.xl),
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            Text(
                working.title,
                color = skin.text,
                textAlign = TextAlign.Center,
                style =
                    textStyle(
                        BrambleTypeScale.title,
                        BrambleWeight.bold,
                    ),
                modifier =
                    Modifier.semantics {
                        heading()
                    },
            )
            Text(
                working.copy,
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.body),
            )
        }
        TaskList(working.tasks, working.active)
        Text(
            working.liveness,
            color = skin.muted,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.caption),
        )
    }
}

/** `.send-task-list`: the panel with the xs elevation, hairlines inset past the dot. */
@Composable
private fun TaskList(
    labels: List<String>,
    active: Int,
) {
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .brambleShadow(BrambleShadow.xs, panelShape)
            .background(skin.panel, panelShape)
            .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.sm),
    ) {
        labels.forEachIndexed { index, label ->
            if (index > 0) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(
                            start = BrambleLayout.sendTaskHairlineInset,
                        ).height(BrambleLayout.hairline)
                        .background(skin.hairline),
                )
            }
            TaskRow(label, index, active)
        }
    }
}

/** One task: done (positive dot), active (accent dot, semibold), or still to come (muted). */
@Composable
private fun TaskRow(
    label: String,
    index: Int,
    active: Int,
) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleControl.hit),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val dot =
            when {
                index < active -> skin.positive
                index == active -> skin.accent
                else -> skin.hairlineStrong
            }
        Box(Modifier.size(BrambleSpace.sm).background(dot, CircleShape))
        Text(
            label,
            color = if (index > active) skin.muted else skin.text,
            style =
                textStyle(
                    BrambleTypeScale.label,
                    if (index == active) BrambleWeight.semibold else BrambleWeight.regular,
                ),
        )
    }
}

/**
 * The copy of an [Outcome]: the muted [kicker], the [title], and an optional [message].
 *
 * @property kicker the small line above the title.
 * @property title the outcome's heading.
 * @property message the explanation under the title, or null for none.
 */
internal data class OutcomeCopy(
    val kicker: String,
    val title: String,
    val message: String?,
)

/** `.send-outcome`: a centred mark, kicker, title, copy and hash, then the stage's actions. */
@Composable
internal fun Outcome(
    icon: BrambleIconName,
    tint: Color,
    copy: OutcomeCopy,
    hash: String?,
    actions: @Composable ColumnScope.() -> Unit,
) {
    val skin = LocalSkin.current
    val message = copy.message
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        Box(Modifier.size(BrambleLayout.sendOutcomeMark), contentAlignment = Alignment.Center) {
            BrambleIcon(icon, tint, BrambleSize.mark)
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            Text(copy.kicker, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
            Text(
                copy.title,
                color = skin.text,
                textAlign = TextAlign.Center,
                style =
                    textStyle(
                        BrambleTypeScale.headline,
                        BrambleWeight.bold,
                        BrambleTracking.display,
                    ),
                modifier =
                    Modifier.semantics {
                        heading()
                    },
            )
            if (message !=
                null
            ) {
                Text(
                    message,
                    color = skin.muted,
                    textAlign = TextAlign.Center,
                    style = textStyle(BrambleTypeScale.body),
                )
            }
            if (hash != null) {
                Text(
                    hash,
                    color = skin.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = textStyle(BrambleTypeScale.mono, mono = true),
                )
            }
        }
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm), content = actions)
    }
}
