package org.bramble.wallet.ledger

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.bramble.core.AccountFamily
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerKeyReaderInterface
import org.bramble.core.LedgerReadStep
import org.bramble.core.LedgerScheme
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

    /** Before Android 12, a scan finds nothing while Location services are off. */
    LOCATION_OFF,
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

/** The core calls the model makes; tests script them, as the core does not load on the JVM. */
interface LedgerCore {
    /** A reader for [count] keys at [scheme] from [startIndex] (the core's `LedgerKeyReader`). */
    fun reader(
        scheme: LedgerScheme,
        startIndex: UInt,
        count: UInt,
    ): LedgerKeyReaderInterface

    /** [keys] placed as [family] accounts on the network (`ledgerAccountCandidates`). */
    fun place(
        keys: List<LedgerKey>,
        family: AccountFamily,
    ): List<LedgerCandidate>

    /** [address]'s on-chain state. */
    suspend fun describe(address: String): LedgerActivity

    /** [address] in the core's canonical felt form (`validateRecipient`), so spellings match. */
    fun canonical(address: String): String
}

/**
 * Connect a Ledger and pick its accounts, as iOS `LedgerConnectModel` (the extension's
 * `onboard-session.ts`): wait for Bluetooth, list Ledgers, connect to the one chosen, read a page
 * of keys at each of [route]'s schemes, place them per family, check each address on chain and
 * preselect the active ones, and keep the person's picks.
 *
 * Trust boundary: every device byte goes to the core unread; a refusal is the core's code, shown
 * through [friendlyError] (its Ledger table). On-chain state is untrusted and only decides what is
 * listed and preselected. Public keys and addresses only: nothing here signs or writes the vault.
 * Any failure ends the connection. Main-thread only.
 */
class LedgerConnectModel(
    val route: LedgerRoute,
    private val scanner: LedgerScanning,
    private val connect: suspend (LedgerDevice) -> LedgerExchanging,
    private val core: LedgerCore,
    existing: Set<String>,
    private val pageSize: UInt = PAGE_SIZE,
) {
    private val existing = existing.map(core::canonical).toSet()
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

    /** Every account read so far, in the order read. */
    var rows: List<LedgerRow> by mutableStateOf(emptyList())
        private set

    /** Picked rows, by address. */
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
        get() = rows.filter { it.selectable && it.id in selected }.map { it.candidate.request }

    /** The picker's groups for this route. */
    val groups: List<LedgerGroup> get() = LedgerGroup.groups(rows, route)

    /** Picks or unpicks [row]; a row that cannot be picked is ignored. */
    fun toggle(row: LedgerRow) {
        if (!row.selectable) return
        selected = if (row.id in selected) selected - row.id else selected + row.id
    }

    /** Connects to [ledger] and reads the first page. */
    suspend fun choose(ledger: LedgerDevice) {
        if (stage != LedgerStage.Scanning) return
        scanner.stopScan()
        stage = LedgerStage.Connecting(ledger)
        val flow = epoch
        val connected =
            try {
                connect(ledger)
            } catch (cancelled: CancellationException) {
                // Backing out mid-connect is not a failed connection.
                throw cancelled
            } catch (ignored: Exception) {
                null
            }
        when {
            flow != epoch -> {
                connected?.close()
            }

            connected == null -> {
                fail("replug")
            }

            else -> {
                device = connected
                // The device OS gate (`LEDGER_OS_MIN`) belongs here once the core exports it: wallet-core #191.
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
        rows = emptyList()
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
        val open = device ?: return fail("replug")
        val flow = epoch
        val pages = mutableListOf<Pair<LedgerScheme, List<LedgerKey>>>()
        var refusal: String? = null
        for (scheme in route.schemes) {
            when (val outcome = core.read(open, scheme, nextIndex, pageSize)) {
                is LedgerReadStep.Keys -> pages += scheme to outcome.keys
                is LedgerReadStep.Refused -> refusal = outcome.reason
                is LedgerReadStep.Send -> refusal = UNEXPECTED
            }
            if (flow != epoch || refusal != null) break
        }
        val placed =
            runCatching {
                pages.flatMap { (scheme, keys) -> LedgerRoute.families(scheme).flatMap { core.place(keys, it) } }
            }.getOrNull()
        when {
            flow != epoch -> Unit
            refusal != null -> fail(refusal)
            placed == null -> fail(UNEXPECTED)
            else -> show(placed, pages.firstOrNull()?.second?.size ?: 0, flow)
        }
    }

    /** Appends a placed page, then checks it on chain. */
    private suspend fun show(
        placed: List<LedgerCandidate>,
        keysRead: Int,
        flow: Int,
    ) {
        rows = rows + placed.map { LedgerRow(it, null, core.canonical(it.address) in existing) }
        nextIndex += keysRead.toUInt()
        stage = LedgerStage.Picking
        check(placed.map { it.address }, flow)
    }

    /** Reads each address's on-chain state, then selects every active, selectable row. */
    private suspend fun check(
        addresses: List<String>,
        flow: Int,
    ) {
        val found = coroutineScope { addresses.map { async { it to core.describe(it) } }.awaitAll() }.toMap()
        if (flow != epoch) return
        rows = rows.map { row -> found[row.id]?.let { row.copy(activity = it) } ?: row }
        selected = selected + rows.filter { it.id in found && it.active && it.selectable }.map { it.id }
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

/** One page at [scheme] off [open], every APDU and reply through the core's reader. */
private suspend fun LedgerCore.read(
    open: LedgerExchanging,
    scheme: LedgerScheme,
    startIndex: UInt,
    count: UInt,
): LedgerReadStep {
    val keys =
        runCatching { reader(scheme, startIndex, count) }.getOrNull()
            ?: return LedgerReadStep.Refused("unexpected-device-error")
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
