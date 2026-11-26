package org.bramble.wallet.ledger

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerKeyReaderInterface
import org.bramble.core.LedgerReadStep
import org.bramble.wallet.errors.friendlyError

/** Bluetooth as the Ledger screens see it: only [READY] can scan or connect. */
enum class LedgerBluetooth {
    /** Not reported yet. */
    UNKNOWN,

    /** On and permitted: ready to scan. */
    READY,

    /** The adapter is off. */
    OFF,

    /** A Bluetooth permission was refused. */
    UNAUTHORIZED,

    /** The phone has no Bluetooth LE. */
    UNSUPPORTED,
}

/**
 * A Ledger in range or bonded to the phone.
 *
 * @property id its Bluetooth address.
 * @property name what the device advertises; only shown.
 */
data class LedgerDevice(
    val id: String,
    val name: String,
)

/** What the connect screen needs from Bluetooth; [LedgerBleScanner] is the real one. */
interface LedgerScanning {
    /** Bluetooth's state now. */
    val bluetooth: LedgerBluetooth

    /** The Ledgers found so far. */
    val devices: List<LedgerDevice>

    /** Called after [bluetooth] or [devices] changes. */
    var changed: (() -> Unit)?

    /** Lists bonded Ledgers and scans; does nothing until Bluetooth is on. */
    fun startScan()

    /** Stops the scan. */
    fun stopScan()
}

/** A connected Ledger, one APDU at a time; [LedgerBleDriver] is the real one. */
interface LedgerExchanging {
    /** The device's reply to [apdu], or the transport failure. */
    suspend fun send(apdu: ByteArray): LedgerExchange

    /** Ends the connection. */
    fun close()
}

/** Where the connect-and-pick flow is. */
sealed interface LedgerStage {
    /**
     * Bluetooth is not ready (or not known yet); nothing is scanned.
     *
     * @property state why.
     */
    data class Bluetooth(
        val state: LedgerBluetooth,
    ) : LedgerStage

    /** Listing Ledgers. */
    data object Scanning : LedgerStage

    /**
     * Connecting; the system may show its pairing prompt.
     *
     * @property device the Ledger chosen.
     */
    data class Connecting(
        val device: LedgerDevice,
    ) : LedgerStage

    /** Reading the first page of keys. */
    data object Reading : LedgerStage

    /** The account list is shown. */
    data object Picking : LedgerStage

    /**
     * Ended; Retry starts again.
     *
     * @property message why, in the Ledger table's words.
     */
    data class Failed(
        val message: String,
    ) : LedgerStage
}

/**
 * Connect a Ledger and pick its accounts, as iOS `LedgerConnectModel` (the extension's
 * `onboard-session.ts`): wait for Bluetooth, list Ledgers, connect to the one chosen, read a page
 * of keys through the core's reader ([reader]), place them ([place]) and keep the person's picks.
 *
 * Trust boundary: every device byte goes to the core unread; a refusal is the core's code, shown
 * through [friendlyError] (its Ledger table). Public keys and addresses only: nothing here signs
 * or writes the vault. Any failure ends the connection. Main-thread only.
 */
class LedgerConnectModel(
    private val scanner: LedgerScanning,
    private val connect: suspend (LedgerDevice) -> LedgerExchanging,
    private val reader: (startIndex: UInt, count: UInt) -> LedgerKeyReaderInterface,
    private val place: (List<LedgerKey>) -> List<LedgerCandidate>,
    existing: Set<String>,
    private val pageSize: UInt = PAGE_SIZE,
) {
    private val existing = existing.map { it.lowercase() }.toSet()
    private var device: LedgerExchanging? = null
    private var nextIndex = 0u

    /** Bumped by every restart and close, so a read that outlives its flow changes nothing. */
    private var epoch = 0

    /** Where the flow is. */
    var stage: LedgerStage by mutableStateOf(LedgerStage.Bluetooth(LedgerBluetooth.UNKNOWN))
        private set

    /** The Ledgers listed. */
    var devices: List<LedgerDevice> by mutableStateOf(emptyList())
        private set

    /** Every account read so far, in index order. */
    var candidates: List<LedgerCandidate> by mutableStateOf(emptyList())
        private set

    /** Picked candidates, by address. */
    var selected: Set<String> by mutableStateOf(emptySet())
        private set

    /** True while "Show more" reads. */
    var loadingMore by mutableStateOf(false)
        private set

    init {
        scanner.changed = ::bluetoothChanged
        bluetoothChanged()
    }

    /** The requests the picked accounts make, in the order they were read. */
    val chosen: List<LedgerAccountRequest>
        get() = candidates.filter { it.address in selected }.map { it.request }

    /** Whether the wallet already holds [candidate]; such a row cannot be picked. */
    fun isExisting(candidate: LedgerCandidate): Boolean = candidate.address.lowercase() in existing

    /** Picks or unpicks [candidate]. */
    fun toggle(candidate: LedgerCandidate) {
        if (isExisting(candidate)) return
        selected = if (candidate.address in selected) selected - candidate.address else selected + candidate.address
    }

    /** Connects to [ledger] and reads the first page. */
    suspend fun choose(ledger: LedgerDevice) {
        if (stage != LedgerStage.Scanning) return
        scanner.stopScan()
        stage = LedgerStage.Connecting(ledger)
        val flow = epoch
        val connected = runCatching { connect(ledger) }.getOrNull()
        when {
            flow != epoch -> {
                connected?.close()
            }

            connected == null -> {
                fail("replug")
            }

            else -> {
                device = connected
                stage = LedgerStage.Reading
                readPage()
            }
        }
    }

    /** Reads the next page into the list. */
    suspend fun more() {
        if (stage != LedgerStage.Picking || loadingMore) return
        loadingMore = true
        try {
            readPage()
        } finally {
            loadingMore = false
        }
    }

    /** After a failure: drop the connection and what was read, and list Ledgers again. */
    fun retry() {
        close()
        candidates = emptyList()
        selected = emptySet()
        nextIndex = 0u
        stage = LedgerStage.Bluetooth(LedgerBluetooth.UNKNOWN)
        bluetoothChanged()
    }

    /** Ends the connection and the scan: the screen is going away or the picks are taken. */
    fun close() {
        epoch += 1
        scanner.stopScan()
        device?.close()
        device = null
    }

    /** Re-reads Bluetooth's state, as after a permission is granted. */
    fun bluetoothChanged() {
        devices = scanner.devices
        if (stage is LedgerStage.Bluetooth || stage == LedgerStage.Scanning) {
            if (scanner.bluetooth == LedgerBluetooth.READY) {
                stage = LedgerStage.Scanning
                scanner.startScan()
                devices = scanner.devices
            } else {
                stage = LedgerStage.Bluetooth(scanner.bluetooth)
            }
        }
        // Once connected, the connection reports a lost Bluetooth itself, as a disconnect.
    }

    private suspend fun readPage() {
        val open = device
        val flow = epoch
        val outcome = open?.let { read(it) }
        if (flow != epoch) return
        val placed = (outcome as? LedgerReadStep.Keys)?.let { runCatching { place(it.keys) }.getOrNull() }
        when {
            outcome == null -> {
                fail("replug")
            }

            outcome is LedgerReadStep.Refused -> {
                fail(outcome.reason)
            }

            outcome is LedgerReadStep.Keys && placed != null -> {
                candidates = candidates + placed
                nextIndex += outcome.keys.size.toUInt()
                stage = LedgerStage.Picking
            }

            else -> {
                fail(UNEXPECTED)
            }
        }
    }

    /** One page off [open], every APDU and reply through the core's reader. */
    private suspend fun read(open: LedgerExchanging): LedgerReadStep {
        val keys = runCatching { reader(nextIndex, pageSize) }.getOrNull() ?: return LedgerReadStep.Refused(UNEXPECTED)
        try {
            var step = keys.start()
            while (step is LedgerReadStep.Send) {
                step =
                    when (val answer = open.send(step.apdu)) {
                        is LedgerExchange.Reply -> keys.reply(answer.reply)
                        is LedgerExchange.Failure -> keys.transportFailure(answer.failure)
                    }
            }
            return step
        } finally {
            (keys as? AutoCloseable)?.close()
        }
    }

    private fun fail(reason: String) {
        close()
        stage = LedgerStage.Failed(friendlyError(reason))
    }

    /** Page size and the fallback refusal. */
    companion object {
        /** Keys read per device round (the core's page limit). */
        const val PAGE_SIZE = 5u

        private const val UNEXPECTED = "unexpected-device-error"
    }
}
