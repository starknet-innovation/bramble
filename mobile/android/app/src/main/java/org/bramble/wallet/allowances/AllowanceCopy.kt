package org.bramble.wallet.allowances

import org.bramble.core.AllowanceNotice
import org.bramble.core.AllowanceSource
import org.bramble.core.AllowanceView

// The allowance manager's row lines, as the extension's `allowance-views.ts`; twin of the iOS
// `AllowanceCopy` extension. The words and the two limits are generated from the extension
// (`AllowanceCopy.generated.kt`). Pure over the core's [AllowanceView], so the JVM tests hold it to
// the copy. Review, risk and refusal sentences are not here: those are the core's own
// ([RevokeFlowModel]).

/**
 * `isUnlimitedAllowance`: a plain base-10 amount at or above 2^128 - 1 (`unlimitedFloor`, which
 * wallet-core v0.8.0 does not export; `AllowanceCopyTest` also holds it to the fixture).
 */
internal fun AllowanceCopy.isUnlimited(amount: String): Boolean {
    if (amount.isEmpty() || !amount.all { it in '0'..'9' }) return false
    val digits = amount.trimStart('0')
    return if (digits.length != unlimitedFloor.length) {
        digits.length > unlimitedFloor.length
    } else {
        digits >= unlimitedFloor
    }
}

/**
 * `amountLabel`: unlimited wins; a lower bound says so, and a bound of zero is unknown.
 * [display] is `displayAmount` (the token's units, or raw base units said so).
 */
internal fun AllowanceCopy.amount(
    view: AllowanceView,
    display: (String) -> String,
): String =
    when {
        isUnlimited(view.amount) -> unlimited
        !view.lowerBound -> display(view.amount)
        view.amount == "0" -> unknownAmount
        else -> atLeast.replace("{amount}", display(view.amount))
    }

/** `sourceLabel`. */
internal fun AllowanceCopy.source(source: AllowanceSource): String =
    when (source) {
        AllowanceSource.EXTERNAL -> sourceChain
        AllowanceSource.MULTISIG -> sourceMultisig
        AllowanceSource.WALLET -> sourceWallet
    }

/** `noticeCopy`. */
internal fun AllowanceCopy.notice(notice: AllowanceNotice): String =
    when (notice) {
        AllowanceNotice.MULTISIG_UNREAD -> multisigUnread
        AllowanceNotice.RETENTION_FULL -> retentionFull.replace("{count}", entriesPerScope.toString())
        AllowanceNotice.SCAN_INCOMPLETE -> scanIncomplete
    }

/** The header's count: nothing while reading, "Not loaded" without an answer. */
internal fun AllowanceCopy.subtitle(count: Int?): String? = count?.let { outstanding.replace("{count}", it.toString()) }

/**
 * A multisig's grant takes its own intent; an unconfirmed contract would be granted, not
 * revoked. Neither row gets the control.
 */
internal fun AllowanceCopy.canRevoke(view: AllowanceView): Boolean =
    view.source != AllowanceSource.MULTISIG && !view.unconfirmedToken
