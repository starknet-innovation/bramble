package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import org.bramble.core.TransferReview
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.CopyButton

// The review and working stages of `SendScreen` (split by stage to stay readable; the shapes are
// `SendScreen.kt`'s).

/**
 * The confirm face, in the order the decision is made (`reviewSummaryHtml`, then the Cost box,
 * then `reviewRisksHtml`): who it leaves, who it reaches, how much; what it costs; and only what
 * needs saying. Then the reason Confirm is held, if any, and Confirm.
 */
@Composable
internal fun ReviewStage(
    store: WalletStore,
    model: SendFlowModel,
    review: TransferReview,
    retry: () -> Unit,
    confirm: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        ReviewFactsList(store, model, review)
        CostBox(reviewCost(review), retry)
        RisksPanel(reviewRisks(review))
        StatusLine(model.reviewBlock, StatusTone.DANGER)
        PillButton(SendCopy.confirmLabel, icon = BrambleIconName.CHECK, enabled = review.canConfirm, onClick = confirm)
    }
}

/** `.send-review-facts`: From, To and Amount, one hairline between rows. */
@Composable
private fun ReviewFactsList(
    store: WalletStore,
    model: SendFlowModel,
    review: TransferReview,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().background(skin.panel, panelShape).padding(horizontal = BrambleSpace.lg)) {
        Fact(SendCopy.fromRowLabel, SendCopy.showFullSender to model.account.address) {
            FactValue(model.account.displayName, model.account.shortAddress)
        }
        Hairline()
        Fact(SendCopy.toRowLabel, SendCopy.showFullRecipient to review.recipient) {
            FactValue(
                model.recipientLabel ?: review.recipientShort,
                review.recipientShort.takeIf {
                    model.recipientLabel !=
                        null
                },
            )
            CopyButton(store, review.recipient, SendCopy.copyRecipient)
        }
        Hairline()
        Fact(SendCopy.amountRowLabel) {
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TokenMark(model.token.address, review.tokenSymbol)
                    Text(
                        "${review.amountDisplay} ${review.tokenSymbol}",
                        color = skin.text,
                        style = textStyle(BrambleTypeScale.body, BrambleWeight.bold).copy(fontFeatureSettings = "tnum"),
                    )
                }
                Text(SendCopy.fiatUnavailable, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
            }
        }
    }
}

/**
 * One fact: its label on the left, its [value] (and any control) on the right, and under the row
 * the [reveal] disclosure (its summary line and the full address), which needs the panel's whole
 * width: a full address is wider than a phone, and inside the value column it would crowd out
 * the label.
 */
@Composable
private fun Fact(
    label: String,
    reveal: Pair<String, String>? = null,
    value: @Composable RowScope.() -> Unit,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().padding(vertical = BrambleSpace.sm)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label), modifier = Modifier.weight(1f))
            value()
        }
        // An empty address has nothing to check character by character (iOS omits the disclosure).
        reveal?.takeIf { it.second.isNotEmpty() }?.let { (summary, address) -> AddressReveal(summary, address) }
    }
}

/** A fact's name over its truncated address (in code), right-aligned. */
@Composable
private fun FactValue(
    name: String,
    address: String?,
) {
    val skin = LocalSkin.current
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
        Text(
            name,
            color = skin.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
        )
        address?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption, mono = true)) }
    }
}

/**
 * `details.address-reveal`: a disclosure that shows the full address in place, selectable, so the
 * reviewer can check every character against the source they were given.
 */
@Composable
private fun AddressReveal(
    label: String,
    address: String,
) {
    val skin = LocalSkin.current
    // Losing the open state on a configuration change is acceptable; saved state is banned.
    var open by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
    ) {
        Text(
            label,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
            modifier =
                Modifier
                    .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                    .toggleable(value = open, role = Role.Button, onValueChange = { open = it }),
        )
        if (open) {
            // The full width of the panel, wrapping, so every character stays on screen.
            SelectionContainer(Modifier.fillMaxWidth()) {
                Text(
                    address,
                    color = skin.text,
                    textAlign = TextAlign.End,
                    style = textStyle(BrambleTypeScale.caption, mono = true),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun Hairline() {
    Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(LocalSkin.current.hairline))
}

/** The Cost box (`reviewFeeSection`): "Cost", then the figure and its share, or the failure and a retry. */
@Composable
private fun CostBox(
    cost: ReviewCost,
    retry: () -> Unit,
) {
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.panel, panelShape)
            .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Eyebrow(SendCopy.cost)
        when (cost) {
            is ReviewCost.Figure -> {
                Text(
                    cost.line,
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold).copy(fontFeatureSettings = "tnum"),
                )
                cost.share?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
                if (cost.shortfall) {
                    Text(SendCopy.shortfall, color = skin.warning, style = textStyle(BrambleTypeScale.caption))
                }
            }

            is ReviewCost.Failed -> {
                StatusLine(cost.message, StatusTone.DANGER)
                PillButton(
                    SendCopy.retryFee,
                    kind = PillKind.SECONDARY,
                    icon = BrambleIconName.REFRESH,
                    onClick = retry,
                )
            }
        }
    }
}

/** `reviewPanel`: "Risk and recovery" over each warning; nothing at all when there is none. */
@Composable
private fun RisksPanel(risks: List<String>) {
    if (risks.isEmpty()) return
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.panel, panelShape)
            .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Eyebrow(SendCopy.riskAndRecovery)
        risks.forEach { risk ->
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                BrambleIcon(BrambleIconName.ALERT, skin.warning, BrambleLayout.detailIcon)
                Text(risk, color = skin.text, style = textStyle(BrambleTypeScale.body))
            }
        }
    }
}

/** `#send-working`: the progress mark and one title, "Sending your transaction…", for every working stage. */
@Composable
internal fun WorkingStage() {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = BrambleSpace.xl),
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
        Text(
            SendCopy.workingTitle,
            color = skin.text,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.title, BrambleWeight.bold),
            modifier = Modifier.semantics { heading() },
        )
    }
}
