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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SecretField
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.makeSendModel
import org.bramble.wallet.ui.shortAddress

internal val panelShape = RoundedCornerShape(BrambleRadius.lg)
internal val cardShape = RoundedCornerShape(BrambleRadius.xl)
internal val capsule = RoundedCornerShape(percent = 50)

/**
 * The Send journey in Compose, stage for stage with the iOS `SendFlowView` and the extension's
 * `send-views.ts`, built from the design components (FlowHeader, the one hardened field, pills,
 * panels) with the send stylesheet's geometry. All copy comes from the generated `SendCopy`; every
 * value shown is the core plan's. Routed from Home's Send tile and a token's Send (`WalletShell`,
 * `Flow.SEND`, opening on [startToken]); [openAddressBook] takes the recipient stage's Save to the
 * address book, and [viewActivity] leaves every flow for the Activity tab. The plan is closed when
 * the screen leaves, and on lock by `WalletStore`.
 */
@Composable
fun SendScreen(
    store: WalletStore,
    back: () -> Unit,
    viewActivity: () -> Unit,
    openAddressBook: (() -> Unit)? = null,
    startToken: String? = null,
) {
    val model = remember { store.makeSendModel(startToken) }
    if (model == null) {
        // Locked, or an account the core will not sign for (Home says why): nothing to show.
        LaunchedEffect(Unit) { back() }
        return
    }
    DisposableEffect(model) { onDispose { model.close() } }
    // The address book lists the contacts as the core holds them now, not as last visited.
    LaunchedEffect(model) { store.coordination.refresh() }
    val saveContact =
        openAddressBook?.let { open ->
            { address: String ->
                store.coordination.contactDraft = address
                open()
            }
        }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(model.title, network = store.networkLabel, back = { stepBack(model, back) })
        StageContent(store, model, saveContact, back, viewActivity)
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The body of [model]'s current stage; [back] and [viewActivity] are the outcomes' ways off it. */
@Composable
private fun StageContent(
    store: WalletStore,
    model: SendFlowModel,
    saveContact: ((String) -> Unit)?,
    back: () -> Unit,
    viewActivity: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    when (model.stage) {
        SendFlowModel.Stage.RECIPIENT -> {
            RecipientStage(store, model, saveContact)
        }

        SendFlowModel.Stage.ASSET -> {
            AssetStage(store, model)
        }

        SendFlowModel.Stage.DETAILS, SendFlowModel.Stage.REVIEWING -> {
            DetailsStage(store, model) { scope.launch { model.reviewSend() } }
        }

        SendFlowModel.Stage.REVIEW -> {
            model.review?.let { review ->
                ReviewStage(
                    store,
                    model,
                    review,
                    retry = { scope.launch { model.retryFee() } },
                    confirm = { scope.launch { model.confirm() } },
                )
            }
        }

        SendFlowModel.Stage.AUTHORIZING, SendFlowModel.Stage.BROADCASTING, SendFlowModel.Stage.CONFIRMING -> {
            WorkingStage()
        }

        SendFlowModel.Stage.PENDING, SendFlowModel.Stage.SUBMITTED, SendFlowModel.Stage.FAILED -> {
            SendOutcomeStage(store, model, scope, back, viewActivity)
        }
    }
}

/** The header's back: leaves from the first and last stages, steps back inside the flow otherwise. */
private fun stepBack(
    model: SendFlowModel,
    back: () -> Unit,
) {
    when (model.stage) {
        SendFlowModel.Stage.RECIPIENT, SendFlowModel.Stage.SUBMITTED, SendFlowModel.Stage.PENDING -> {
            back()
        }

        SendFlowModel.Stage.ASSET,
        SendFlowModel.Stage.DETAILS,
        SendFlowModel.Stage.REVIEW,
        SendFlowModel.Stage.FAILED,
        -> {
            model.back()
        }

        else -> {
            // The working stages have no back step: the plan is mid-flight.
        }
    }
}

/** `.send-context-receipt`: `label · value` rows on a panel, split by full-width hairlines. */
@Composable
internal fun Receipt(
    rows: List<Pair<String, String>>,
    trailing: (@Composable (Int) -> Unit)? = null,
) {
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(
                panelShape,
            ).background(skin.panel, panelShape)
            .padding(horizontal = BrambleSpace.lg),
    ) {
        rows.forEachIndexed { index, (label, value) ->
            if (index > 0) Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            Row(
                Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact).semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.label),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    value,
                    color = skin.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                )
                trailing?.invoke(index)
            }
        }
    }
}

/** The details stage: the accounts receipt, the amount card, and Review. */
@Composable
private fun DetailsStage(
    store: WalletStore,
    model: SendFlowModel,
    review: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Eyebrow(SendCopy.accountsHeading)
        Receipt(
            listOf(
                SendCopy.fromLabel to model.account.displayName,
                SendCopy.toLabel to (model.recipientLabel ?: model.recipient?.let { shortAddress(it) } ?: "—"),
                SendCopy.networkLabel to store.networkLabel,
            ),
        )
        AmountCard(model)
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

/**
 * `.send-amount-card`: the card is the amount field, so it is flat, and an invalid amount turns
 * its fill and ink to the danger tones.
 */
@Composable
private fun AmountCard(model: SendFlowModel) {
    val skin = LocalSkin.current
    val invalid = model.amountError != null
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                if (invalid) skin.dangerSoft else skin.panel,
                cardShape,
            ).padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        AssetPill(model)
        Box(
            Modifier.fillMaxWidth().heightIn(min = BrambleLayout.sendAmountMin),
            contentAlignment = Alignment.CenterStart,
        ) {
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
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        ) {
            Text(
                model.balanceLine,
                color = skin.muted,
                style = textStyle(BrambleTypeScale.caption),
                modifier = Modifier.weight(1f),
            )
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
}

/** The selected token as a pressable capsule that opens the asset stage. */
@Composable
private fun AssetPill(model: SendFlowModel) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .semantics(mergeDescendants = true) {
                contentDescription =
                    "${SendCopy.assetLabel} ${model.token.symbol}"
            }.fillPress(skin.elevated, skin.softPress, capsule, onClick = model::pickAsset)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TokenMark(model.token.address, model.token.symbol)
        Text(
            model.token.symbol,
            color = skin.text,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
        )
        BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, BrambleSpace.lg)
    }
}

/** `.send-amount-shortcuts button`: a transparent small pill. */
@Composable
private fun Shortcut(
    title: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Box(
        Modifier
            .fillPress(Color.Transparent, skin.softPress, capsule, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            color = if (enabled) skin.text else skin.muted,
            style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
        )
    }
}
