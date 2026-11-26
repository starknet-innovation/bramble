package org.bramble.wallet.ui.ledger

import org.bramble.wallet.ledger.LedgerBluetooth
import org.bramble.wallet.ledger.LedgerConnectModel
import org.bramble.wallet.ledger.LedgerRoute
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
