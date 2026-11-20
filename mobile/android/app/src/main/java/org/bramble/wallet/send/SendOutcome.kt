package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.bramble.core.explorerTransactionUrl
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

// The settled-transaction screens shared by Send and Deploy account, as the extension's
// `shared/outcome-receipt.ts` and `shared/outcome-hash.ts`: one mark, one heading size, one
// receipt card, and one identifier row, so every outcome reads as the same screen.

/**
 * `.send-outcome`: a centred mark, the [title] with an optional muted [kicker] above it (the
 * pending outcome's "Submitted to Starknet"; the receipts have none) and [message] under it, then
 * [detail] (a receipt card or an identifier row, the screen's own), then the stage's [actions].
 */
@Composable
internal fun Outcome(
    icon: BrambleIconName,
    tint: Color,
    title: String,
    kicker: String? = null,
    message: String? = null,
    detail: @Composable ColumnScope.() -> Unit = {},
    actions: @Composable ColumnScope.() -> Unit,
) {
    val skin = LocalSkin.current
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
            kicker?.let {
                Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
            }
            Text(
                title,
                color = skin.text,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold, BrambleTracking.display),
                modifier = Modifier.semantics { heading() },
            )
            message?.let {
                Text(it, color = skin.muted, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.body))
            }
        }
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            content = detail,
        )
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm), content = actions)
    }
}

/**
 * `.send-receipt`: the optional one-line [summary], then "Transaction" over the [hash] row. The
 * row is withdrawn when there is no hash, so no empty line with a dead control is shown.
 */
@Composable
internal fun ReceiptCard(
    store: WalletStore,
    summary: String?,
    hash: String?,
) {
    val skin = LocalSkin.current
    if (summary == null && hash == null) return
    Column(
        Modifier.fillMaxWidth().background(skin.panel, panelShape).padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        summary?.let { Text(it, color = skin.text, style = textStyle(BrambleTypeScale.body)) }
        if (hash != null) {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                Text(SendCopy.transactionLabel, color = skin.muted, style = textStyle(BrambleTypeScale.label))
                TransactionHash(store, hash)
            }
        }
    }
}

/**
 * `outcomeHashRow`: the [hash] truncated (6…4) so the copy control fits beside it, linked to the
 * explorer when this network has one (the core's `explorerTransactionUrl`, opened in the system
 * browser), and copied in full.
 */
@Composable
internal fun TransactionHash(
    store: WalletStore,
    hash: String,
) {
    val skin = LocalSkin.current
    val uri = LocalUriHandler.current
    val explorer = explorerTransactionUrl(store.network, hash)
    Row(verticalAlignment = Alignment.CenterVertically) {
        val link =
            if (explorer != null) {
                Modifier
                    .semantics { contentDescription = SendCopy.explorerLinkLabel }
                    .clickable(role = Role.Button) { uri.openUri(explorer) }
            } else {
                Modifier
            }
        Text(
            shortAddress(hash),
            color = if (explorer != null) skin.accent else skin.muted,
            style = textStyle(BrambleTypeScale.mono, mono = true),
            modifier = link.padding(vertical = BrambleSpace.xs),
        )
        CopyButton(store, hash, SendCopy.copyTransactionHash)
    }
}

/**
 * The pending, submitted and failed outcomes of a send (`send-views.ts` `pendingStage`,
 * `successStage`, `failureStage`), each with its identifier row and its actions, in the order of
 * the extension's `outcomeReceiptActions`: [viewActivity] leaves every flow for the Activity tab,
 * [back] leaves the journey for the screen it was opened from.
 */
@Composable
internal fun SendOutcomeStage(
    store: WalletStore,
    model: SendFlowModel,
    scope: CoroutineScope,
    back: () -> Unit,
    viewActivity: () -> Unit,
) {
    when (model.stage) {
        SendFlowModel.Stage.PENDING -> PendingOutcome(store, model, scope, viewActivity)
        SendFlowModel.Stage.SUBMITTED -> SubmittedOutcome(store, model, back, viewActivity)
        else -> FailedOutcome(store, model, scope)
    }
}

/** Sent, not yet confirmed: the kicker, title and body, the hash, then check again or Activity. */
@Composable
private fun PendingOutcome(
    store: WalletStore,
    model: SendFlowModel,
    scope: CoroutineScope,
    viewActivity: () -> Unit,
) {
    Outcome(
        BrambleIconName.REFRESH,
        LocalSkin.current.accent,
        SendCopy.pendingTitle,
        kicker = SendCopy.pendingKicker,
        message = SendCopy.pendingBody,
        detail = { model.hash?.let { TransactionHash(store, it) } },
    ) {
        PillButton(SendCopy.checkConfirmation) { scope.launch { model.checkAgain() } }
        PillButton(
            SendCopy.viewActivity,
            kind = PillKind.SECONDARY,
            icon = BrambleIconName.ACTIVITY,
            onClick = viewActivity,
        )
    }
}

/** Confirmed: "Send complete", the receipt (what moved, and the transaction), then Activity or Back. */
@Composable
private fun SubmittedOutcome(
    store: WalletStore,
    model: SendFlowModel,
    back: () -> Unit,
    viewActivity: () -> Unit,
) {
    val sent =
        model.review?.let { review ->
            val to = model.recipientLabel ?: review.recipientShort
            "${review.amountDisplay} ${review.tokenSymbol}${SendCopy.sentTo}$to"
        }
    Outcome(
        BrambleIconName.CHECK,
        LocalSkin.current.positive,
        SendCopy.successTitle,
        detail = { ReceiptCard(store, sent, model.hash) },
    ) {
        PillButton(SendCopy.viewActivity, icon = BrambleIconName.ACTIVITY, onClick = viewActivity)
        PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
    }
}

/** Not sent: the reason with its copy control, the hash if one exists, then try again or edit. */
@Composable
private fun FailedOutcome(
    store: WalletStore,
    model: SendFlowModel,
    scope: CoroutineScope,
) {
    val skin = LocalSkin.current
    val message = model.failureMessage ?: SendCopy.failureDefault
    Outcome(
        BrambleIconName.X,
        skin.danger,
        SendCopy.failureTitle,
        detail = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message,
                    color = skin.muted,
                    textAlign = TextAlign.Center,
                    style = textStyle(BrambleTypeScale.body),
                    modifier = Modifier.weight(1f, fill = false),
                )
                CopyButton(store, message, SendCopy.copyError)
            }
            model.hash?.let { TransactionHash(store, it) }
        },
    ) {
        PillButton(SendCopy.tryAgain) { scope.launch { model.reviewSend() } }
        PillButton(SendCopy.editTransaction, kind = PillKind.SECONDARY) { model.edit() }
    }
}
