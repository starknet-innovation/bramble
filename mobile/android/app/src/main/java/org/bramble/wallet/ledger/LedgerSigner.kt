package org.bramble.wallet.ledger

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import org.bramble.core.AccountRecord
import org.bramble.core.StepReply
import org.bramble.core.TransportFailure
import org.bramble.wallet.errors.friendlyError

/** What a plan driver needs from the device a Ledger account signs on; [LedgerSigner] is the real one. */
interface DeviceSigning {
    /**
     * The plan's reply to [apdu] (`StepReply.Device` or `DeviceFailure`), connecting first when no
     * device is connected; null once the person cancelled. [account] is the record the plan was
     * built for, shown as the signer; null shows none.
     */
    suspend fun exchange(
        apdu: ByteArray,
        account: AccountRecord?,
    ): StepReply?

    /** Shows the core's refusal [reason] and waits: true to try again, false when cancelled. */
    suspend fun refused(
        reason: String,
        account: AccountRecord?,
    ): Boolean

    /** The plan left the device: close the link and the sheet. */
    fun finish()
}

/** Where a signature on the Ledger is, as the sheet shows it. */
sealed interface LedgerSignStage {
    /** No plan waits on the device. */
    data object Idle : LedgerSignStage

    /**
     * Bluetooth is not ready.
     *
     * @property state why.
     */
    data class Bluetooth(
        val state: LedgerBluetooth,
    ) : LedgerSignStage

    /** Listing Ledgers to pick from. */
    data object Scanning : LedgerSignStage

    /**
     * Connecting; the system may show its pairing prompt.
     *
     * @property device the Ledger.
     */
    data class Connecting(
        val device: LedgerDevice,
    ) : LedgerSignStage

    /** The core checks the app and the key, before the person is asked. */
    data object Checking : LedgerSignStage

    /**
     * The device shows [hash] and waits for the person.
     *
     * @property hash the sign APDU's hash, 64 digits.
     */
    data class Confirming(
        val hash: String,
    ) : LedgerSignStage

    /**
     * The device refused.
     *
     * @property message the core code's Bluetooth wording.
     */
    data class Refused(
        val message: String,
    ) : LedgerSignStage
}

/**
 * Signing on a Ledger for every plan that reaches `SendStep.Device` and for a gasless relay
 * signature, as iOS `LedgerSigner`: the one "Confirm on your Ledger" sheet. It connects to the
 * Ledger picked earlier this session first, else the one the person picks, relays each APDU
 * unread and hands the answer back.
 *
 * Trust boundary: the core checks the app version, the key at the account's path (`wrong-device`,
 * before the person confirms) and the signature against the account's key before anything is
 * written. The hash shown is read from the sign APDU the core built. A transport failure goes to
 * the core as is and drops the link. Cancel, [finish] and [close] (the wallet locked) end the
 * link and any wait. Main-thread state.
 */
class LedgerSigner(
    private val scanner: LedgerScanning,
    private val connector: suspend (LedgerDevice) -> LedgerExchanging,
) : DeviceSigning {
    /** Where the signature is; [LedgerSignStage.Idle] hides the sheet. */
    var stage: LedgerSignStage by mutableStateOf(LedgerSignStage.Idle)
        private set

    /** The Ledgers found while scanning. */
    var devices: List<LedgerDevice> by mutableStateOf(emptyList())
        private set

    /** The account the plan was built for, given by the code that built it; null shows no signer. */
    var account: AccountRecord? by mutableStateOf(null)
        private set

    private var device: LedgerExchanging? = null
    private var known: LedgerDevice? = null
    private var picking: CompletableDeferred<LedgerDevice?>? = null
    private var deciding: CompletableDeferred<Boolean>? = null
    private var cancelled = false

    override suspend fun exchange(
        apdu: ByteArray,
        account: AccountRecord?,
    ): StepReply? {
        if (stage == LedgerSignStage.Idle) cancelled = false
        this.account = account
        if (!cancelled && device == null) device = connect()
        val connected = device.takeUnless { cancelled }
        val outcome =
            connected?.let {
                stage = shownHash(apdu)?.let(LedgerSignStage::Confirming) ?: LedgerSignStage.Checking
                it.send(apdu)
            }
        // A failed exchange closed its link: the next attempt connects again.
        if (outcome is LedgerExchange.Failure) {
            device?.close()
            device = null
        }
        return when {
            cancelled -> null
            outcome is LedgerExchange.Reply -> StepReply.Device(outcome.reply)
            outcome is LedgerExchange.Failure -> StepReply.DeviceFailure(outcome.failure)
            else -> StepReply.DeviceFailure(TransportFailure.DISCONNECTED)
        }
    }

    override suspend fun refused(
        reason: String,
        account: AccountRecord?,
    ): Boolean {
        if (cancelled) return false
        this.account = account
        if (reason == WRONG_DEVICE) {
            // Another Ledger is needed: the next attempt lists them again.
            device?.close()
            device = null
            known = null
        }
        stage = LedgerSignStage.Refused(friendlyError(reason))
        return CompletableDeferred<Boolean>().also { deciding = it }.await()
    }

    /** Try again after a refusal. */
    fun retry() {
        if (stage !is LedgerSignStage.Refused) return
        stage = LedgerSignStage.Checking
        deciding?.complete(true)
        deciding = null
    }

    /** Connects to [ledger], picked from the list. */
    fun choose(ledger: LedgerDevice) {
        if (stage != LedgerSignStage.Scanning) return
        picking?.complete(ledger)
        picking = null
    }

    /** "Cancel transaction": ends the link and every wait; the driver closes the plan. */
    fun cancel() {
        if (stage == LedgerSignStage.Idle) return
        cancelled = true
        finish()
    }

    /** The wallet locked: end everything and forget the session's Ledger. */
    fun close() {
        if (stage != LedgerSignStage.Idle) cancelled = true
        known = null
        finish()
    }

    /** Bluetooth or the list changed (or a permission was answered). */
    fun bluetoothChanged() {
        devices = scanner.devices
        if (stage !is LedgerSignStage.Bluetooth && stage != LedgerSignStage.Scanning) return
        if (scanner.bluetooth == LedgerBluetooth.READY) {
            if (stage != LedgerSignStage.Scanning) scanner.startScan()
            stage = LedgerSignStage.Scanning
            devices = scanner.devices
        } else {
            stage = LedgerSignStage.Bluetooth(scanner.bluetooth)
        }
    }

    override fun finish() {
        scanner.stopScan()
        scanner.changed = null
        device?.close()
        device = null
        picking?.complete(null)
        picking = null
        deciding?.complete(false)
        deciding = null
        stage = LedgerSignStage.Idle
        account = null
    }

    /** The session's Ledger first; else the list until the person picks one or cancels. */
    private suspend fun connect(): LedgerExchanging? =
        // Cancelled (or locked) during that reconnect: stop; only a failed reconnect lists Ledgers.
        known?.let { open(it) } ?: if (cancelled) {
            null
        } else {
            run {
                val choice = CompletableDeferred<LedgerDevice?>().also { picking = it }
                scanner.changed = ::bluetoothChanged
                stage = LedgerSignStage.Bluetooth(LedgerBluetooth.UNKNOWN)
                bluetoothChanged()
                choice.await()?.let { picked ->
                    scanner.stopScan()
                    scanner.changed = null
                    open(picked)
                }
            }
        }

    private suspend fun open(ledger: LedgerDevice): LedgerExchanging? {
        stage = LedgerSignStage.Connecting(ledger)
        val connected =
            try {
                connector(ledger)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (ignored: Exception) {
                // A failed link, or a refused Bluetooth permission (SecurityException): no device.
                null
            }
        if (cancelled) connected?.close()
        return connected?.takeUnless { cancelled }?.also { known = ledger }
    }

    /** The shared signer and the sign APDU's shape. */
    companion object {
        /** The core's code for a Ledger that does not hold the account's key. */
        const val WRONG_DEVICE = "wrong-device"

        /** The app's signer, installed at start (`BrambleApplication`); null in JVM tests. */
        var shared: LedgerSigner? = null

        /** The Starknet app's sign-hash APDU header: CLA, INS, P1 for the hash, P2, length. */
        private val SIGN_HASH_HEADER = byteArrayOf(0x5a, 0x02, 0x01, 0x00, 0x20)
        private const val HASH_BYTES = 32

        /** The hash a sign-hash APDU carries, at the 64-digit width the device shows; null otherwise. */
        fun shownHash(apdu: ByteArray): String? =
            apdu
                .takeIf {
                    it.size == SIGN_HASH_HEADER.size + HASH_BYTES &&
                        it.copyOfRange(0, SIGN_HASH_HEADER.size).contentEquals(SIGN_HASH_HEADER)
                }?.let {
                    "0x" +
                        it.copyOfRange(SIGN_HASH_HEADER.size, it.size).joinToString("") { byte -> "%02x".format(byte) }
                }
    }
}
