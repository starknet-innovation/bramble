package org.bramble.wallet.send

import org.bramble.core.TokenInfo
import org.bramble.core.formatTokenAmount
import org.bramble.core.validateRecipient
import org.bramble.wallet.send.SendFlowModel.Stage

// The typed input of [SendFlowModel] (recipient, token, amount), split from SendFlowModel.kt by
// behaviour. The core validates every value; any edit drops the open plan, so a change always
// needs a new review. Main-thread only, like the model.

/** Typing clears the recipient error, as the iOS `didSet`. */
fun SendFlowModel.updateRecipient(text: String) {
    recipientInput = text
    recipientError = null
}

/** Typing clears the amount error and drops any plan: an edit always needs a new review. */
fun SendFlowModel.updateAmount(text: String) {
    val next = text.replace(',', '.')
    if (next == amount) return
    amount = next
    amountError = null
    dropPlan()
}

/** Picks one of the person's own accounts as the recipient, then continues as typed input would. */
fun SendFlowModel.useRecipient(address: String) {
    recipientInput = address
    continueWithRecipient()
}

/** Has the core validate the typed recipient; on success moves to the amount, else shows why. */
fun SendFlowModel.continueWithRecipient() {
    val canonical = validateRecipient(recipientInput)
    if (canonical == null) {
        recipientError = SendCopy.invalidRecipient
        return
    }
    recipient = canonical
    dropPlan()
    stage = Stage.DETAILS
}

/** Opens the token list. */
fun SendFlowModel.pickAsset() {
    stage = Stage.ASSET
}

/** Selects [next] as the token, clears the amount, and drops any plan. */
fun SendFlowModel.choose(next: TokenInfo) {
    token = next
    amount = ""
    amountError = null
    dropPlan()
    stage = Stage.DETAILS
}

/**
 * Half and Max use the full raw balance (Max does not reserve the fee), formatted exactly, as
 * the extension's `balanceShortcut`; both do nothing while the balance is unread.
 */
fun SendFlowModel.fill(half: Boolean) {
    val raw = rawBalance ?: return
    val selected = if (half) halve(raw) else raw
    val formatted =
        if (selected.all { it == '0' }) {
            null
        } else {
            runCatching { formatTokenAmount(selected, token.decimals, token.decimals) }.getOrNull()
        }
    if (formatted != null) {
        amount = formatted
        amountError = null
        dropPlan()
    }
}
