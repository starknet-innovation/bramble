package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretField
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.shortAddress

internal val panelShape = RoundedCornerShape(BrambleRadius.lg)
internal val cardShape = RoundedCornerShape(BrambleRadius.xl)
internal val capsule = RoundedCornerShape(percent = 50)

/**
 * The Send journey in Compose, stage for stage with the iOS `SendFlowView` and the extension's
 * `send-views.ts`, built from the design components (FlowHeader, the one hardened field, pills,
 * panels) with the send stylesheet's geometry. All copy comes from the generated `SendCopy`; every
 * value shown is the core plan's. Routed from Home's Send tile (`WalletShell`, `Flow.SEND`); the
 * plan is closed when the screen leaves, and on lock by `WalletStore`.
 *
 * Uncompiled: this machine has no Android SDK; checked by reading against the generated bindings.
 */
@Composable
fun SendScreen(store: WalletStore, back: () -> Unit) {
    val model = remember { store.makeSendModel() } ?: return
    val scope = rememberCoroutineScope()
    DisposableEffect(model) { onDispose { model.close() } }
    val onBack = {
        when (model.stage) {
            SendFlowModel.Stage.RECIPIENT, SendFlowModel.Stage.SUBMITTED, SendFlowModel.Stage.PENDING -> back()
            SendFlowModel.Stage.ASSET, SendFlowModel.Stage.DETAILS, SendFlowModel.Stage.REVIEW, SendFlowModel.Stage.FAILED -> model.back()
            else -> Unit
        }
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(model.title, network = store.networkLabel, back = onBack)
        when (model.stage) {
            SendFlowModel.Stage.RECIPIENT -> RecipientStage(model)
            SendFlowModel.Stage.ASSET -> AssetStage(store, model)
            SendFlowModel.Stage.DETAILS, SendFlowModel.Stage.REVIEWING -> DetailsStage(store, model) { scope.launch { model.reviewSend() } }
            SendFlowModel.Stage.REVIEW -> model.review?.let { review ->
                ReviewStage(
                    store,
                    model,
                    review,
                    retry = { scope.launch { model.retryFee() } },
                    confirm = { scope.launch { model.confirm() } },
                )
            }
            SendFlowModel.Stage.AUTHORIZING, SendFlowModel.Stage.BROADCASTING, SendFlowModel.Stage.CONFIRMING -> WorkingStage(model.stage)
            SendFlowModel.Stage.PENDING -> Outcome(
                BrambleIconName.REFRESH, LocalSkin.current.accent, SendCopy.pendingKicker, SendCopy.pendingTitle, SendCopy.pendingBody, model.hash,
            ) {
                PillButton(SendCopy.checkConfirmation) { scope.launch { model.checkAgain() } }
                PillButton(SendCopy.viewActivity, kind = PillKind.SECONDARY, icon = BrambleIconName.ACTIVITY) { back() }
            }
            SendFlowModel.Stage.SUBMITTED -> {
                val sent = model.review?.let { "${it.amountDisplay} ${it.tokenSymbol}${SendCopy.sentTo}${it.recipientShort}" }
                Outcome(BrambleIconName.CHECK, LocalSkin.current.positive, SendCopy.successKicker, SendCopy.successTitle, sent, model.hash) {
                    PillButton(SendCopy.backToHome, onClick = back)
                }
            }
            SendFlowModel.Stage.FAILED -> Outcome(
                BrambleIconName.X, LocalSkin.current.danger, SendCopy.failureKicker, SendCopy.failureTitle,
                model.failureMessage ?: SendCopy.failureDefault, model.hash,
            ) {
                PillButton(SendCopy.tryAgain) { scope.launch { model.reviewSend() } }
                PillButton(SendCopy.editTransaction, kind = PillKind.SECONDARY) { model.edit() }
            }
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** `.send-section-title` (or the muted `.send-stage-kicker`). */
@Composable
private fun Heading(text: String, kicker: Boolean = false) {
    val skin = LocalSkin.current
    Text(
        text,
        color = if (kicker) skin.muted else skin.text,
        style = if (kicker) textStyle(BrambleTypeScale.label, BrambleWeight.semibold) else textStyle(BrambleTypeScale.title, BrambleWeight.semibold, BrambleTracking.title),
        modifier = Modifier.semantics { heading() },
    )
}

/** `.send-recipient-row` / `.send-asset-row`: a pressable panel row with a mark, copy, value. */
@Composable
private fun ChoiceRow(title: String, detail: String, value: String?, label: String, mark: @Composable () -> Unit, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = label }
            .fillPress(skin.panel, skin.softPress, panelShape, pressedScale = 0.985f, onClick = onClick)
            .heightIn(min = BrambleSize.tile)
            .padding(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(BrambleSize.mark)) { mark() }
        Column(Modifier.weight(1f).padding(horizontal = BrambleSpace.md), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(title, color = skin.text, maxLines = 1, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            Text(detail, color = skin.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = textStyle(BrambleTypeScale.caption))
        }
        if (value != null) {
            Text(value, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
        } else {
            BrambleIcon(BrambleIconName.CHEVRON_RIGHT, skin.muted)
        }
    }
}

/** `.send-context-receipt`: `label · value` rows on a panel, split by full-width hairlines. */
@Composable
private fun Receipt(rows: List<Pair<String, String>>, trailing: (@Composable (Int) -> Unit)? = null) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().clip(panelShape).background(skin.panel, panelShape).padding(horizontal = BrambleSpace.lg)) {
        rows.forEachIndexed { index, (label, value) ->
            if (index > 0) Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            Row(
                Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact).semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label), modifier = Modifier.weight(1f))
                Text(value, color = skin.text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
                trailing?.invoke(index)
            }
        }
    }
}

@Composable
private fun RecipientStage(model: SendFlowModel) {
    val skin = LocalSkin.current
    var tab by remember { mutableStateOf(0) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Heading(SendCopy.sendingFrom, kicker = true)
            // `.send-origin-account`: the sending account on the elevated fill.
            Row(
                Modifier.fillMaxWidth().background(skin.elevated, panelShape).heightIn(min = BrambleSize.control)
                    .padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.sm)
                    .semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AccountAvatar(model.account.address)
                Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                    Text("Account ${model.account.index + 1u}", color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
                    Text(shortAddress(model.account.address), color = skin.muted, style = textStyle(BrambleTypeScale.caption, mono = true))
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Heading(SendCopy.sendingTo)
            // The one hardened field, flat: an invalid address takes the danger-soft fill and ink.
            BrambleField(
                label = null,
                placeholder = SendCopy.recipientPlaceholder,
                value = model.recipientInput,
                onValueChange = model::updateRecipient,
                kind = SecretKind.ADDRESS,
                invalid = model.recipientError != null,
                onSubmit = { model.continueWithRecipient() },
            )
            StatusLine(model.recipientError, StatusTone.DANGER)
        }
        SegmentedControl(listOf(SendCopy.myAccounts to 0, SendCopy.addressBook to 1), tab) { tab = it }
        if (tab == 0) {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                model.otherAccounts.forEach { account ->
                    val name = "Account ${account.index + 1u}"
                    ChoiceRow(name, shortAddress(account.address), null, "$name, ${shortAddress(account.address)}", mark = {
                        AccountAvatar(account.address, BrambleSize.mark)
                    }) { model.useRecipient(account.address) }
                }
            }
        } else {
            Text(
                SendCopy.addressBookEmpty,
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.label),
                modifier = Modifier.fillMaxWidth().padding(vertical = BrambleSpace.lg, horizontal = BrambleSpace.md),
            )
        }
        PillButton(SendCopy.continueWithAddress, enabled = model.recipientInput.isNotBlank()) { model.continueWithRecipient() }
    }
}

@Composable
private fun AssetStage(store: WalletStore, model: SendFlowModel) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f)) { Heading(SendCopy.yourTokens, kicker = true) }
            Heading(SendCopy.yourBalance, kicker = true)
        }
        model.network.tokens.forEach { token ->
            val amount = store.amount(token)
            ChoiceRow(token.symbol, amount ?: "…", "—", "${token.symbol}, ${amount ?: "loading"}", mark = {
                TokenMark(token.address, token.symbol)
            }) { model.choose(token) }
        }
    }
}

@Composable
private fun DetailsStage(store: WalletStore, model: SendFlowModel, review: () -> Unit) {
    val skin = LocalSkin.current
    val invalid = model.amountError != null
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Eyebrow(SendCopy.accountsHeading)
        Receipt(
            listOf(
                SendCopy.fromLabel to "Account ${model.account.index + 1u}",
                SendCopy.toLabel to (model.recipient?.let { shortAddress(it) } ?: "—"),
                SendCopy.networkLabel to store.networkLabel,
            ),
        )
        // `.send-amount-card`: the card is the amount field, so it is flat, and an invalid amount
        // turns its fill and ink to the danger tones.
        Column(
            Modifier.fillMaxWidth().background(if (invalid) skin.dangerSoft else skin.panel, cardShape).padding(BrambleSpace.lg),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        ) {
            Row(
                Modifier.semantics(mergeDescendants = true) { contentDescription = "${SendCopy.assetLabel} ${model.token.symbol}" }
                    .fillPress(skin.elevated, skin.softPress, capsule, onClick = model::pickAsset)
                    .heightIn(min = BrambleControl.hitSmall)
                    .padding(horizontal = BrambleSpace.md),
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TokenMark(model.token.address, model.token.symbol)
                Text(model.token.symbol, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
                BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, BrambleSpace.lg)
            }
            Box(Modifier.fillMaxWidth().heightIn(min = BrambleLayout.sendAmountMin), contentAlignment = Alignment.CenterStart) {
                SecretField(
                    value = model.amount,
                    onValueChange = model::updateAmount,
                    accessibilityLabel = SendCopy.amountLabel,
                    kind = SecretKind.AMOUNT,
                    placeholder = SendCopy.amountPlaceholder,
                    textColor = if (invalid) skin.danger else skin.text,
                    style = BrambleTypeScale.amount,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                Text(model.balanceLine, color = skin.muted, style = textStyle(BrambleTypeScale.caption), modifier = Modifier.weight(1f))
                Shortcut(SendCopy.half, enabled = model.rawBalance != null) { model.fill(half = true) }
                Shortcut(SendCopy.max, enabled = model.rawBalance != null) { model.fill(half = false) }
            }
            Text(
                SendCopy.estimatedValueUnavailable,
                color = skin.muted,
                textAlign = TextAlign.End,
                style = textStyle(BrambleTypeScale.caption),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        StatusLine(model.amountError, StatusTone.DANGER)
        PillButton(
            if (model.stage == SendFlowModel.Stage.REVIEWING) SendCopy.preparing else SendCopy.reviewLabel,
            icon = BrambleIconName.SEND,
            busy = model.stage == SendFlowModel.Stage.REVIEWING,
            enabled = model.amount.isNotEmpty(),
            onClick = review,
        )
    }
}

/** `.send-amount-shortcuts button`: a transparent small pill. */
@Composable
private fun Shortcut(title: String, enabled: Boolean, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Box(
        Modifier.fillPress(Color.Transparent, skin.softPress, capsule, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, color = if (enabled) skin.text else skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}
