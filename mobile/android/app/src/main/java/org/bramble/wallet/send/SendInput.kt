package org.bramble.wallet.send

import org.bramble.core.PriceView
import org.bramble.core.SendAmountError
import org.bramble.core.SendException
import org.bramble.core.TokenInfo
import org.bramble.core.TransferPlan
import org.bramble.core.formatTokenAmount
import org.bramble.core.parseTokenAmount
import org.bramble.core.validateRecipient
import org.bramble.wallet.send.SendFlowModel.Stage

// The typed input of [SendFlowModel] (recipient, token, amount), split from SendFlowModel.kt by
// behaviour. The core validates every value; any edit drops the open plan, so a change always
// needs a new review. Main-thread only, like the model.

/** Typing clears the recipient error, as the iOS `didSet`. */
fun SendFlowModel.updateRecipient(text: String) {
    recipientInput = text
    recipientError = null
    recipientNote = null
}

/** Typing clears the amount error and drops any plan: an edit always needs a new review. */
fun SendFlowModel.updateAmount(text: String) {
    val next = text.replace(',', '.')
    if (next == amount) return
    amount = next
    amountError = null
    dropPlan()
}

/**
 * Picks a listed row (a contact or one of the person's accounts) as the recipient, under its name.
 * Like typing, it clears the error and a name lookup's note (as iOS's `recipientInput` `didSet`).
 */
fun SendFlowModel.useRecipient(
    address: String,
    label: String,
) {
    updateRecipient(address)
    continueWithRecipient { label }
}

/**
 * Has the core validate the typed recipient; on success moves to the amount, else shows why. A
 * typed address that is already listed reads as the row it matches ([labelFor], over the core's
 * canonical form), the same as tapping that row would.
 */
fun SendFlowModel.continueWithRecipient(labelFor: (String) -> String? = { null }) {
    val canonical = validateRecipient(recipientInput)
    if (canonical == null) {
        recipientError = SendCopy.invalidRecipient
        return
    }
    recipient = canonical
    recipientLabel = labelFor(canonical)
    resolvedName = null
    dropPlan()
    stage = Stage.DETAILS
}

/** A Starknet name's address, under the canonical [name] (never the typed spelling). */
fun SendFlowModel.takeResolvedName(
    address: String,
    name: String,
    isNew: Boolean,
) {
    recipient = address
    recipientLabel = name
    resolvedName = SendFlowModel.ResolvedName(isNew)
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

/**
 * Why [amount] is not a sendable amount of a token with [decimals], or null when the core parses
 * it. Only `InvalidAmount` is mapped; any other core refusal propagates.
 */
internal fun amountProblem(
    amount: String,
    decimals: UByte,
): String? =
    try {
        parseTokenAmount(amount, decimals)
        null
    } catch (error: SendException.InvalidAmount) {
        when (error.reason) {
            SendAmountError.NOT_POSITIVE -> SendCopy.amountGate
            SendAmountError.TOO_MANY_DECIMALS -> SendCopy.amountTooManyDecimals
            else -> SendCopy.amountInvalid
        }
    }

/**
 * What a Send journey reports back to its owner (the store).
 *
 * @property track receives every plan the journey opens, so a lock can close it.
 * @property notice shows the outcome toast: `true` for a confirmation, `false` for an error.
 * @property gaslessPrices the wallet's own USD prices for these token addresses (STRK among
 *   them), for the gasless fee reference; null when it has none.
 */
data class SendHooks(
    val track: (TransferPlan) -> Unit = {},
    val notice: (message: String, success: Boolean) -> Unit = { _, _ -> },
    val gaslessPrices: suspend (addresses: List<String>) -> PriceView? = { null },
)
