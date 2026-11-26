package org.bramble.wallet.ui.ledger

import org.bramble.wallet.ledger.LedgerBluetooth
import org.bramble.wallet.ledger.LedgerStage

/** The words of the Ledger connect and pick screens, as iOS `LedgerCopy`. */
object LedgerCopy {
    /** Heading while connecting. */
    const val CONNECT_TITLE = "Connect a Ledger"

    /** Heading of the account list. */
    const val PICK_TITLE = "Select accounts"

    /** What to do before a Ledger can be read. */
    const val LEDE = "Unlock your Ledger and open the Starknet app."

    /** The option cards' detail. */
    const val OPTION_DETAIL = "Connect a Ledger and pick its accounts."

    /** The heading for [stage]. */
    fun title(stage: LedgerStage): String = if (stage == LedgerStage.Picking) PICK_TITLE else CONNECT_TITLE

    /** The lede for [stage]; the picker needs none. */
    fun lede(stage: LedgerStage): String = if (stage == LedgerStage.Picking) "" else LEDE

    /** Why nothing is listed while Bluetooth is not on; null while its state is unknown. */
    fun bluetooth(state: LedgerBluetooth): String? =
        when (state) {
            LedgerBluetooth.OFF -> "Turn on Bluetooth to find your Ledger."
            LedgerBluetooth.UNAUTHORIZED -> "Bramble can't use Bluetooth. Allow it in Settings."
            LedgerBluetooth.UNSUPPORTED -> "This device doesn't support Bluetooth."
            LedgerBluetooth.UNKNOWN, LedgerBluetooth.READY -> null
        }
}
