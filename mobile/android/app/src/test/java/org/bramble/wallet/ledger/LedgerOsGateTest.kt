package org.bramble.wallet.ledger

import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerKeyReaderInterface
import org.bramble.core.LedgerOsGateInterface
import org.bramble.core.LedgerOsStep
import org.bramble.core.LedgerReadStep
import org.bramble.core.LedgerScheme
import org.bramble.core.TransportFailure
import org.bramble.wallet.errors.FriendlyErrorRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The device OS gate at the start of the connect flow (wallet-core #199), twin of iOS
 * `LedgerConnectModelTests`' gate cases. The core cannot load on the JVM, so the gate is scripted
 * with the steps wallet-core's `ledger_os_gate.rs` tests pin, and the model must relay each step's
 * bytes to a simulated Ledger and each answer back, byte for byte, reconnecting to the same device.
 */
class LedgerOsGateTest {
    private val ledger = LedgerDevice("AA:BB:CC:DD:EE:FF", "Nano X 1A2B")

    @Test
    fun supportedPassesThenReads() =
        runBlocking {
            val sim = SimLedger()
            val gate = ScriptedGate(sequence(LedgerOsStep.Supported("nano-x", "2.6.1")))
            val phases = mutableListOf<String>()
            val core = PassCore(gate)
            val model = model(sim, gate, core)
            sim.onSend = { (model.stage as? LedgerStage.Checking)?.let { phases += it.phase } }
            model.choose(ledger)
            assertEquals("the first page is read once the gate passes", 1, core.readers.size)
            assertEquals(EXPECTED_CALLS, gate.calls)
            assertEquals(3, sim.connections)
            assertTrue(OPENING_STARKNET in phases)
        }

    @Test
    fun osBelowMinimumIsRefused() =
        runBlocking {
            val sim = SimLedger()
            val gate = ScriptedGate(sequence(LedgerOsStep.Refused("firmware-below-minimum")))
            val model = model(sim, gate)
            model.choose(ledger)
            assertEquals(LedgerStage.Failed(message("firmware-below-minimum")), model.stage)
            assertTrue(sim.allClosed)
        }

    @Test
    fun declinedAppChangeRejected() =
        runBlocking {
            val sim = SimLedger().apply { declineOpen = true }
            val gate =
                ScriptedGate(
                    sequence(LedgerOsStep.Supported("nano-x", "2.6.1")).take(OPEN_STEP) +
                        ("reply:5501" to LedgerOsStep.Refused("rejected-on-device")),
                )
            val model = model(sim, gate)
            model.choose(ledger)
            assertEquals(LedgerStage.Failed(message("rejected-on-device")), model.stage)
            assertEquals("reply:5501", gate.calls.last())
            assertTrue(sim.allClosed)
        }

    @Test
    fun disconnectMidGateReadsNothing() =
        runBlocking {
            // The Ledger never comes back after Starknet closes: the gate hears the failure.
            val sim = SimLedger().apply { connectionsAllowed = 1 }
            val steps = sequence(LedgerOsStep.Supported("nano-x", "2.6.1")).take(DROP_STEP)
            val gate =
                ScriptedGate(steps + ("failure:DISCONNECTED" to LedgerOsStep.Refused("dashboard-restore-failed")))
            val core = PassCore(gate)
            val model = model(sim, gate, core)
            model.choose(ledger)
            assertEquals(LedgerStage.Failed(message("dashboard-restore-failed")), model.stage)
            assertTrue(core.readers.isEmpty())
            assertTrue(sim.allClosed)
        }

    private fun model(
        sim: SimLedger,
        gate: ScriptedGate,
        core: PassCore = PassCore(gate),
    ) = LedgerConnectModel(LedgerRoute.BRAMBLE, Scanner(ledger), { sim.connect() }, core, emptySet())

    private fun message(code: String) = FriendlyErrorRules.ledgerMessages.getValue(code)

    /** Readers are counted and refuse at once: these tests stop where the keys would be read. */
    private class PassCore(
        private val gate: LedgerOsGateInterface,
    ) : LedgerCore {
        val readers = mutableListOf<Unit>()

        override fun reader(
            scheme: LedgerScheme,
            startIndex: UInt,
            count: UInt,
        ): LedgerKeyReaderInterface {
            readers += Unit
            return object : LedgerKeyReaderInterface {
                override fun start() = LedgerReadStep.Refused("unexpected-device-error")

                override fun reply(reply: ByteArray) = start()

                override fun transportFailure(failure: TransportFailure) = start()
            }
        }

        override fun place(
            keys: List<LedgerKey>,
            family: AccountFamily,
        ): List<LedgerCandidate> = emptyList()

        override suspend fun describe(address: String) = LedgerActivity(false, false)

        override fun canonical(address: String) = address

        override fun osGate() = gate
    }

    private class Scanner(
        private val ledger: LedgerDevice,
    ) : LedgerScanning {
        override val bluetooth = LedgerBluetooth.READY
        override var devices: List<LedgerDevice> = listOf(ledger)
        override var changed: (() -> Unit)? = null

        override fun startScan() = Unit

        override fun stopScan() = Unit
    }

    private companion object {
        const val HEX = 16

        /** Calls before the host sends `OpenApp(Starknet)`'s answer, and before the close's drop. */
        const val OPEN_STEP = 6
        const val DROP_STEP = 3

        val APP_STATE = hex("b001000000")
        val QUIT_APP = hex("b0a7000000")
        val OS_VERSION = hex("e001000000")
        val OPEN_STARKNET = hex("e0d8000008") + "Starknet".toByteArray()

        /** What the host must hand the gate, in order, for a device that passes. */
        val EXPECTED_CALLS =
            listOf(
                "start",
                "reply:" + appReply("Starknet").toHex(),
                "failure:DISCONNECTED",
                "reconnected",
                "reply:" + appReply("BOLOS").toHex(),
                "reply:" + osReply("2.6.1").toHex(),
                "failure:DISCONNECTED",
                "reconnected",
                "reply:" + appReply("Starknet").toHex(),
            )

        /** wallet-core's gate sequence for a Nano X in Starknet, ending in [last]. */
        fun sequence(last: LedgerOsStep): List<Pair<String, LedgerOsStep>> =
            EXPECTED_CALLS.zip(
                listOf(
                    LedgerOsStep.Send(APP_STATE, "checking-device"),
                    LedgerOsStep.Send(QUIT_APP, "returning-to-dashboard"),
                    LedgerOsStep.Reconnect("reconnecting-dashboard"),
                    LedgerOsStep.Send(APP_STATE, "reconnecting-dashboard"),
                    LedgerOsStep.Send(OS_VERSION, "checking-firmware"),
                    LedgerOsStep.Send(OPEN_STARKNET, OPENING_STARKNET),
                    LedgerOsStep.Reconnect("reconnecting-starknet"),
                    LedgerOsStep.Send(APP_STATE, "confirming-starknet"),
                    last,
                ),
            )

        /** `GetAppAndVersion`'s reply naming [name], as wallet-core's gate tests build it. */
        fun appReply(name: String): ByteArray =
            byteArrayOf(1, name.length.toByte()) +
                name.toByteArray() +
                byteArrayOf(5) +
                "2.4.3".toByteArray() +
                byteArrayOf(0, 0x90.toByte(), 0)

        /** `GetOsVersion`'s reply: a Nano X (`0x33000004`) on [version]. */
        fun osReply(version: String): ByteArray =
            byteArrayOf(0x33, 0, 0, 4, version.length.toByte()) +
                version.toByteArray() +
                byteArrayOf(4, 0xe6.toByte(), 0, 0, 0, 4) +
                "2.30".toByteArray() +
                byteArrayOf(0x90.toByte(), 0)

        fun hex(digits: String): ByteArray = digits.chunked(2).map { it.toInt(HEX).toByte() }.toByteArray()

        fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
    }

    /** A Ledger as the gate sees it: closing or opening an app drops the link. */
    private class SimLedger {
        var app = "Starknet"
        var declineOpen = false
        var connectionsAllowed = Int.MAX_VALUE
        var onSend: (() -> Unit)? = null
        var connections = 0
        private val links = mutableListOf<SimLink>()

        val allClosed get() = links.all { it.closed }

        fun connect(): LedgerExchanging {
            if (connections >= connectionsAllowed) throw LedgerLinkException.Disconnected()
            connections += 1
            return SimLink(this).also { links += it }
        }
    }

    private class SimLink(
        private val ledger: SimLedger,
    ) : LedgerExchanging {
        var closed = false

        override suspend fun send(apdu: ByteArray): LedgerExchange {
            if (closed) return LedgerExchange.Failure(TransportFailure.DISCONNECTED)
            ledger.onSend?.invoke()
            return when {
                apdu.contentEquals(APP_STATE) -> {
                    LedgerExchange.Reply(appReply(ledger.app))
                }

                apdu.contentEquals(OS_VERSION) -> {
                    LedgerExchange.Reply(osReply("2.6.1"))
                }

                apdu.contentEquals(OPEN_STARKNET) && ledger.declineOpen -> {
                    LedgerExchange.Reply(byteArrayOf(0x55, 0x01))
                }

                else -> {
                    ledger.app = if (apdu.contentEquals(QUIT_APP)) "BOLOS" else "Starknet"
                    closed = true
                    LedgerExchange.Failure(TransportFailure.DISCONNECTED)
                }
            }
        }

        override fun close() {
            closed = true
        }
    }
}

/**
 * A core gate scripted as `(the host's call, the step it answers)` pairs: `start`, `reply:<hex>`,
 * `failure:<FAILURE>`, `reconnected`. It records the calls; a call off the script ends refused.
 */
class ScriptedGate(
    private val script: List<Pair<String, LedgerOsStep>>,
) : LedgerOsGateInterface {
    val calls = mutableListOf<String>()

    private fun next(call: String): LedgerOsStep {
        calls += call
        val expected = script.getOrNull(calls.size - 1)
        return if (expected?.first == call) expected.second else LedgerOsStep.Refused("off-script")
    }

    override fun start() = next("start")

    override fun reply(reply: ByteArray) = next("reply:" + reply.joinToString("") { "%02x".format(it) })

    override fun transportFailure(failure: TransportFailure) = next("failure:" + failure.name)

    override fun reconnected() = next("reconnected")
}
