package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import org.bramble.wallet.WalletStore
import org.bramble.wallet.amount
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleField
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
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.shortAddress

// The recipient and asset stages of `SendScreen` (split by stage to stay readable; the shapes are
// `SendScreen.kt`'s). Uncompiled: checked by reading against the generated bindings.

/** `.send-section-title` (or the muted `.send-stage-kicker`). */
@Composable
private fun Heading(
    text: String,
    kicker: Boolean = false,
) {
    val skin = LocalSkin.current
    Text(
        text,
        color = if (kicker) skin.muted else skin.text,
        style =
            if (kicker) {
                textStyle(
                    BrambleTypeScale.label,
                    BrambleWeight.semibold,
                )
            } else {
                textStyle(BrambleTypeScale.title, BrambleWeight.semibold, BrambleTracking.title)
            },
        modifier = Modifier.semantics { heading() },
    )
}

/** The copy of one [ChoiceRow]: its title, detail, trailing value (or a chevron), and label. */
private data class ChoiceCopy(
    val title: String,
    val detail: String,
    val value: String?,
    val label: String,
)

/** `.send-recipient-row` / `.send-asset-row`: a pressable panel row with a mark, copy, value. */
@Composable
private fun ChoiceRow(
    copy: ChoiceCopy,
    mark: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = copy.label }
            .fillPress(skin.panel, skin.softPress, panelShape, pressedScale = 0.985f, onClick = onClick)
            .heightIn(min = BrambleSize.tile)
            .padding(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(BrambleSize.mark)) { mark() }
        Column(
            Modifier.weight(1f).padding(horizontal = BrambleSpace.md),
            verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
        ) {
            Text(
                copy.title,
                color = skin.text,
                maxLines = 1,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
            )
            Text(
                copy.detail,
                color = skin.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = textStyle(BrambleTypeScale.caption),
            )
        }
        if (copy.value != null) {
            Text(copy.value, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
        } else {
            BrambleIcon(BrambleIconName.CHEVRON_RIGHT, skin.muted)
        }
    }
}

/** The recipient stage: the sending account, the hardened address field, and the person's accounts. */
@Composable
internal fun RecipientStage(model: SendFlowModel) {
    val skin = LocalSkin.current
    var tab by remember { mutableStateOf(0) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        OriginAccount(model)
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
                    val name = account.displayName
                    ChoiceRow(ChoiceCopy(name, account.shortAddress, null, "$name, ${account.shortAddress}"), mark = {
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
        PillButton(
            SendCopy.continueWithAddress,
            enabled = model.recipientInput.isNotBlank(),
        ) { model.continueWithRecipient() }
    }
}

/** "Sending from": `.send-origin-account`, the sending account on the elevated fill. */
@Composable
private fun OriginAccount(model: SendFlowModel) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Heading(SendCopy.sendingFrom, kicker = true)
        Row(
            Modifier
                .fillMaxWidth()
                .background(skin.elevated, panelShape)
                .heightIn(min = BrambleSize.control)
                .padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.sm)
                .semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccountAvatar(model.account.address)
            Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                Text(
                    model.account.displayName,
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                )
                Text(
                    model.account.shortAddress,
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.caption, mono = true),
                )
            }
        }
    }
}

/** The asset stage: the network's tokens with this view's balances. */
@Composable
internal fun AssetStage(
    store: WalletStore,
    model: SendFlowModel,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f)) { Heading(SendCopy.yourTokens, kicker = true) }
            Heading(SendCopy.yourBalance, kicker = true)
        }
        model.network.tokens.forEach { token ->
            val amount = store.amount(token)
            ChoiceRow(ChoiceCopy(token.symbol, amount ?: "…", "—", "${token.symbol}, ${amount ?: "loading"}"), mark = {
                TokenMark(token.address, token.symbol)
            }) { model.choose(token) }
        }
    }
}
