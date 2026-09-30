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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import org.bramble.core.validateRecipient
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
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.sendRecipients
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress
import org.bramble.wallet.ui.wallet.groupIcon

// The recipient and asset stages of `SendScreen` (split by stage to stay readable; the shapes are
// `SendScreen.kt`'s).

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
                textStyle(BrambleTypeScale.label, BrambleWeight.semibold)
            } else {
                textStyle(BrambleTypeScale.title, BrambleWeight.semibold, BrambleTracking.title)
            },
        modifier = Modifier.semantics { heading() },
    )
}

/** `.send-list-heading`: an icon, the list's name, and an optional count. */
@Composable
private fun ListHeading(
    icon: BrambleIconName,
    title: String,
    count: Int? = null,
) {
    val skin = LocalSkin.current
    Row(
        Modifier.semantics(mergeDescendants = true) { heading() },
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrambleIcon(icon, skin.muted, BrambleLayout.detailIcon)
        Text(title, color = skin.text, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
        count?.let { Text("$it", color = skin.muted, style = textStyle(BrambleTypeScale.label)) }
    }
}

/**
 * The copy of one [ChoiceRow]: its title, detail, an optional [note] under them ("Current"), and
 * its accessible [label].
 */
private data class ChoiceCopy(
    val title: String,
    val detail: String,
    val label: String,
    val note: String? = null,
)

/** `.send-recipient-row` / a token option: a pressable panel row with a mark, copy, and trailing mark. */
@Composable
private fun ChoiceRow(
    copy: ChoiceCopy,
    mark: @Composable () -> Unit,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {
                contentDescription = copy.label
                this.selected = selected
            }.fillPress(skin.panel, skin.softPress, panelShape, pressedScale = 0.985f, onClick = onClick)
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
                style = textStyle(BrambleTypeScale.caption, mono = true),
            )
            copy.note?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
        }
        BrambleIcon(if (selected) BrambleIconName.CHECK else BrambleIconName.CHEVRON_RIGHT, skin.muted)
    }
}

/** One listed recipient: its avatar, name, 6…4 address and, for the sending account, "Current". */
@Composable
private fun RecipientChoice(
    row: RecipientRow,
    pick: (RecipientRow) -> Unit,
) {
    val short = shortAddress(row.address)
    val note = if (row.current) SendCopy.currentAccount else null
    ChoiceRow(
        ChoiceCopy(row.label, short, listOfNotNull(row.label, short, note).joinToString(", "), note),
        mark = { AccountAvatar(row.address, BrambleSize.mark) },
    ) { pick(row) }
}

/**
 * The recipient stage (`recipientStage`): the sending account with its copy control, the one
 * hardened address field, the address book (with Save for a new, valid address), then the
 * person's accounts under their folders. Typing filters every list; [saveContact] (null when the
 * address book cannot be reached) saves a typed address the lists do not hold.
 */
@Composable
internal fun RecipientStage(
    store: WalletStore,
    model: SendFlowModel,
    saveContact: ((String) -> Unit)?,
) {
    val skin = LocalSkin.current
    val book = store.sendRecipients()
    val shown = book.filtered(model.recipientInput)
    // Offered only for an address that is both usable and not already listed, so saving is a
    // deliberate act on a new recipient rather than a second name for a known one.
    val unlisted =
        remember(model.recipientInput, book) {
            validateRecipient(model.recipientInput.trim())?.takeIf { book.labelFor(it) == null }
        }
    val pick = { row: RecipientRow -> model.useRecipient(row.address, row.label) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        OriginAccount(store, model)
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Heading(SendCopy.sendTo)
            // The one hardened field, flat: an invalid address takes the danger-soft fill and ink.
            BrambleField(
                label = null,
                placeholder = SendCopy.recipientPlaceholder,
                value = model.recipientInput,
                onValueChange = model::updateRecipient,
                kind = SecretKind.ADDRESS,
                invalid = model.recipientError != null,
                onSubmit = { model.continueWithRecipient(book::labelFor) },
            )
            StatusLine(model.recipientError, StatusTone.DANGER)
        }
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            ListHeading(BrambleIconName.BOOK, SendCopy.addressBook)
            shown.contacts.forEach { RecipientChoice(it, pick) }
            if (unlisted != null && saveContact != null) {
                PillButton(SendCopy.saveRecipient, kind = PillKind.SECONDARY, icon = BrambleIconName.BOOK) {
                    saveContact(unlisted)
                }
            }
        }
        shown.folders.forEach { folder ->
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                ListHeading(groupIcon(folder.icon), folder.name, folder.rows.size)
                folder.rows.forEach { RecipientChoice(it, pick) }
            }
        }
        if (model.recipientInput.isNotBlank() && shown.isEmpty) {
            Text(
                SendCopy.noMatchingRecipient,
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.label),
                modifier = Modifier.fillMaxWidth().padding(vertical = BrambleSpace.md),
            )
        }
        PillButton(
            SendCopy.continueWithAddress,
            enabled = model.recipientInput.isNotBlank(),
        ) { model.continueWithRecipient(book::labelFor) }
    }
}

/** "Send from": `.send-origin-account`, the sending account on the elevated fill, with its copy control. */
@Composable
private fun OriginAccount(
    store: WalletStore,
    model: SendFlowModel,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Heading(SendCopy.sendFrom, kicker = true)
        Row(
            Modifier
                .fillMaxWidth()
                .background(skin.elevated, panelShape)
                .heightIn(min = BrambleSize.control)
                .padding(
                    start = BrambleSpace.md,
                    end = BrambleSpace.xs,
                    top = BrambleSpace.sm,
                    bottom = BrambleSpace.sm,
                ),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccountAvatar(model.account.address)
            Column(
                Modifier.weight(1f).semantics(mergeDescendants = true) {},
                verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
            ) {
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
            CopyButton(store, model.account.address, SendCopy.copySendingAddress)
        }
    }
}

/**
 * "Tokens you can send": the platform's own screen for the extension's token dropdown, with its
 * one group, "Your tokens", listing this network's tokens with this view's balances.
 */
@Composable
internal fun AssetStage(
    store: WalletStore,
    model: SendFlowModel,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Heading(SendCopy.yourTokens, kicker = true)
        model.network.tokens.forEach { token ->
            val amount = store.amount(token)
            ChoiceRow(
                ChoiceCopy(token.symbol, amount ?: "…", "${token.symbol}, ${amount ?: "loading"}"),
                mark = { TokenMark(token.address, token.symbol) },
                selected = token.address == model.token.address,
            ) { model.choose(token) }
        }
    }
}
