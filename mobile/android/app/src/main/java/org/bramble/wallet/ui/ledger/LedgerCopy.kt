package org.bramble.wallet.ui.ledger

import org.bramble.core.AccountRecord
import org.bramble.wallet.ledger.LedgerBluetooth
import org.bramble.wallet.ledger.LedgerConnectModel
import org.bramble.wallet.ledger.LedgerRoute
import org.bramble.wallet.ledger.LedgerSignStage
import org.bramble.wallet.ledger.LedgerStage

/** The words of the Ledger connect and pick screens, as iOS `LedgerCopy`. */
object LedgerCopy {
    /** Heading while connecting. */
    const val CONNECT_TITLE = "Connect a Ledger"

    /** What to do before a Ledger can be read. */
    const val LEDE = "Unlock your Ledger and open the Starknet app."

    /** The Ledger option cards' detail. */
    const val OPTION_DETAIL = "Connect a Ledger and pick its accounts."

    /** Import's Ready Ledger option. */
    const val READY_TITLE = "Ready Ledger account"

    /** Its detail. */
    const val READY_DETAIL = "Bring over a Ledger account created in Ready (Argent X)."

    /** The screen's heading (`pickerCopy` once the list shows). */
    fun title(model: LedgerConnectModel): String =
        when {
            model.stage != LedgerStage.Picking -> CONNECT_TITLE
            model.route == LedgerRoute.READY -> "Select Ready accounts"
            else -> "Select accounts"
        }

    /** The lede under the heading. */
    fun lede(model: LedgerConnectModel): String =
        when {
            model.stage != LedgerStage.Picking -> LEDE
            model.route == LedgerRoute.READY -> "Accounts with activity are preselected. Yours may be a few pages in."
            else -> "Accounts with activity are preselected."
        }

    /** "N accounts detected", as Find your accounts says it; null for none. */
    fun detected(count: Int): String? =
        if (count >
            0
        ) {
            "$count ${if (count == 1) "account" else "accounts"} detected"
        } else {
            null
        }

    /** What the screen says while Bluetooth is not ready. */
    fun bluetooth(state: LedgerBluetooth): String? =
        when (state) {
            LedgerBluetooth.UNKNOWN -> "Checking Bluetooth…"
            LedgerBluetooth.OFF -> "Turn on Bluetooth to find your Ledger."
            LedgerBluetooth.UNAUTHORIZED -> "Bramble can't use Bluetooth. Allow it in Settings."
            LedgerBluetooth.UNSUPPORTED -> "This device doesn't support Bluetooth."
            LedgerBluetooth.LOCATION_OFF -> "Turn on Location to find your Ledger."
            LedgerBluetooth.READY -> null
        }
}

/**
 * The words of the Ledger signing sheet, as iOS `LedgerSignCopy`: the extension's `ledgerSign.*`
 * signing text (`review-sign.ts`), the connect steps in Bluetooth wording. Approval and signing
 * sentences: edit them as a reviewed group, against "did we lose a fact?".
 */
object LedgerSignCopy {
    /** Over the hash. */
    const val HASH_LABEL = "Hash shown on your Ledger"

    /** Under the hash. */
    const val HASH_HELP = "Approve only if this matches your device, character for character."

    /** While the device asks. */
    const val CONFIRMING_BODY = "Approve the request on your Ledger."

    /** While the core checks the app and the key. */
    const val VERIFYING_BODY = "Checking this is the right Ledger."

    /** Under a refusal. */
    const val NOT_SIGNED = "The transaction has not been signed or broadcast."

    /** Ends the plan. */
    const val CANCEL = "Cancel transaction"

    /** Signs the same transaction again. */
    const val TRY_AGAIN = "Try again"

    /** The hash's copy control. */
    const val COPY_HASH = "Copy transaction hash"

    /** Before the signing account's address. */
    const val SIGNING_WITH = "Signing with"

    /** The signing account's copy control. */
    const val COPY_ADDRESS = "Copy signing account address"

    /** Under the connect stages: nothing has been signed or sent while the Ledger is found. */
    const val PAUSED = "The transaction is safely paused."

    /** Hex digits per group, as the extension renders the hash for comparison. */
    private const val HASH_GROUP = 4

    /** The sheet's heading for [stage]. */
    fun title(stage: LedgerSignStage): String =
        when (stage) {
            LedgerSignStage.Idle, is LedgerSignStage.Bluetooth, LedgerSignStage.Scanning -> "Ledger connection needed"
            is LedgerSignStage.Connecting -> "Connecting securely"
            LedgerSignStage.Checking -> "Verifying the right account"
            is LedgerSignStage.Confirming -> "Approve on your Ledger"
            is LedgerSignStage.Refused -> "Ledger needs attention"
        }

    /** `ledgerSign.account`: the account's [index] on the Ledger. */
    fun account(index: UInt): String = "Account $index"

    /**
     * The signer line as one sentence (its accessibility text): "Signing with 0x1234…abcd ·
     * Account 0"; the index only for a Ledger record.
     */
    fun signer(account: AccountRecord): String {
        val index = if (account.ledger) " · " + account(account.accountIndex) else ""
        return "$SIGNING_WITH ${account.shortAddress}$index"
    }

    /** The line under the connect stages; null once a Ledger is connecting. */
    fun connectNote(stage: LedgerSignStage): String? =
        when (stage) {
            is LedgerSignStage.Bluetooth, LedgerSignStage.Scanning -> PAUSED
            else -> null
        }

    /** `0x` and the 64 digits in groups of four; the copied value stays unbroken. */
    fun grouped(hash: String): String = "0x " + hash.removePrefix("0x").chunked(HASH_GROUP).joinToString(" ")
}
