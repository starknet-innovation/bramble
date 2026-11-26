package org.bramble.wallet.ledger

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerKeyReaderInterface
import org.bramble.core.LedgerReadStep
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkId
import org.bramble.core.TransportFailure
import org.bramble.wallet.errors.FriendlyErrorRules
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Ledger connect-and-pick model, twin of iOS `LedgerConnectModelTests`. The core cannot load
 * on the JVM, so readers are scripted with the steps the core takes (one key a page) and placement
 * names each address by scheme, family and index; the device answers each APDU with its recorded
 * reply from the Speculos transcripts (`extension-ledger.jsonl`), and the model must hand every
 * reply to the reader byte for byte.
 */
class LedgerConnectModelTest {
    private val ledger = LedgerDevice("AA:BB:CC:DD:EE:FF", "Nano X 1A2B")

    @Test
    fun brambleKeysBecomeTwoFamilies() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE)
            fixture.model.choose(ledger)
            assertEquals(LedgerStage.Picking, fixture.model.stage)
            val rows = fixture.model.rows
            assertEquals(listOf(AccountFamily.OPEN_ZEPPELIN, AccountFamily.ARGENT), rows.map { it.family })
            assertTrue(rows.all { it.candidate.request.publicKeyX == KEY })
            val reader = fixture.readers.single()
            assertEquals(Triple(LedgerScheme.BRAMBLE, 0u, LedgerConnectModel.PAGE_SIZE), reader.page)
            assertArrayEquals(fixture.recorded(VERSION_APDU), reader.replies[0])
            assertArrayEquals(fixture.recorded(BRAMBLE_KEY_APDU), reader.replies[1])
            assertFalse(fixture.device.closed)
            assertEquals(listOf("Bramble accounts", "Argent accounts"), fixture.model.groups.map { it.title })
        }

    @Test
    fun checkPreselectsActiveOnly() =
        runBlocking {
            val funded = address(LedgerScheme.BRAMBLE, AccountFamily.OPEN_ZEPPELIN, 0u)
            val fixture = Fixture(LedgerRoute.BRAMBLE) { LedgerActivity(false, it == funded) }
            fixture.model.choose(ledger)
            val (bramble, argent) = fixture.model.rows
            assertEquals("Funded and ready to deploy", bramble.status)
            assertFalse("an unused Argent account would be deployed new", argent.selectable)
            assertEquals(
                "No on-chain activity found — Bramble only imports existing Argent accounts",
                argent.status,
            )
            assertEquals(listOf(bramble.candidate.request), fixture.model.chosen)
            fixture.model.toggle(argent)
            assertEquals(listOf(bramble.candidate.request), fixture.model.chosen)
            fixture.model.toggle(bramble)
            assertTrue(fixture.model.chosen.isEmpty())
        }

    @Test
    fun readyReadsReadysScheme() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.READY) { LedgerActivity(true, false) }
            fixture.model.choose(ledger)
            val row = fixture.model.rows.single()
            assertEquals(LedgerScheme.READY, row.candidate.request.scheme)
            assertEquals(AccountFamily.ARGENT, row.family)
            assertArrayEquals(fixture.recorded(READY_KEY_APDU), fixture.readers.single().replies[1])
            assertEquals("Deployed on Starknet", row.status)
            assertEquals(listOf(row.candidate.request), fixture.model.chosen)
            assertEquals(listOf("Ready accounts"), fixture.model.groups.map { it.title })
        }

    @Test
    fun firstRunReadsBothSchemes() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.FIRST_RUN)
            fixture.model.choose(ledger)
            assertEquals(listOf(LedgerScheme.BRAMBLE, LedgerScheme.READY), fixture.readers.map { it.page.first })
            val schemes = fixture.model.rows.map { it.candidate.request.scheme }
            assertEquals(listOf(LedgerScheme.BRAMBLE, LedgerScheme.BRAMBLE, LedgerScheme.READY), schemes)
            // An unused Argent account at Bramble's path is left out beside Ready's.
            val groups = fixture.model.groups
            assertEquals(listOf("Bramble accounts", "Ready accounts"), groups.map { it.title })
            assertEquals(listOf(LedgerScheme.READY), groups.last().rows.map { it.candidate.request.scheme })
        }

    @Test
    fun showMoreReadsTheNextPage() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE)
            fixture.model.choose(ledger)
            fixture.model.more()
            assertEquals(LedgerStage.Picking, fixture.model.stage)
            assertEquals(listOf(0u, 0u, 1u, 1u), fixture.model.rows.map { it.candidate.request.accountIndex })
            assertEquals(1u, fixture.readers[1].page.second)
            assertFalse(fixture.model.loadingMore)
        }

    @Test
    fun refusalShowsItsMessage() =
        runBlocking {
            for (code in listOf("app-below-minimum", "no-app-open", "device-locked")) {
                val fixture = Fixture(LedgerRoute.BRAMBLE, refusal = code)
                fixture.model.choose(ledger)
                assertEquals(LedgerStage.Failed(message(code)), fixture.model.stage)
                assertTrue(fixture.model.rows.isEmpty())
                assertTrue(fixture.device.closed)
            }
        }

    @Test
    fun disconnectMidReadThenRetry() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE, disconnectAfter = 1)
            fixture.model.choose(ledger)
            assertEquals(listOf(TransportFailure.DISCONNECTED), fixture.readers.single().failures)
            assertEquals(LedgerStage.Failed(message("disconnected-mid-sign")), fixture.model.stage)
            assertTrue(fixture.device.closed)
            fixture.model.retry()
            assertEquals(LedgerStage.Scanning, fixture.model.stage)
            assertEquals(2, fixture.scanner.scans)
        }

    @Test
    fun failedConnectAsksToReconnect() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE, connectFails = true)
            fixture.model.choose(ledger)
            assertEquals(LedgerStage.Failed(message("replug")), fixture.model.stage)
        }

    @Test
    fun deniedOrOffNeverScans() {
        val states =
            listOf(
                LedgerBluetooth.UNAUTHORIZED,
                LedgerBluetooth.OFF,
                LedgerBluetooth.UNSUPPORTED,
                LedgerBluetooth.LOCATION_OFF,
                LedgerBluetooth.UNKNOWN,
            )
        for (state in states) {
            val fixture = Fixture(LedgerRoute.BRAMBLE, bluetooth = state)
            assertEquals(LedgerStage.Bluetooth(state), fixture.model.stage)
            assertEquals(0, fixture.scanner.scans)
            fixture.scanner.set(LedgerBluetooth.READY)
            assertEquals(LedgerStage.Scanning, fixture.model.stage)
            assertEquals(listOf(ledger), fixture.model.devices)
            fixture.scanner.set(LedgerBluetooth.OFF)
            assertEquals(LedgerStage.Bluetooth(LedgerBluetooth.OFF), fixture.model.stage)
        }
    }

    @Test
    fun backingOutIsNotAFailure() {
        val fixture = Fixture(LedgerRoute.BRAMBLE, connectError = CancellationException("left"))
        assertThrows(CancellationException::class.java) { runBlocking { fixture.model.choose(ledger) } }
        assertFalse(fixture.model.stage is LedgerStage.Failed)
    }

    @Test
    fun refusedPermissionAsksReconnect() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE, connectError = SecurityException("BLUETOOTH_CONNECT"))
            fixture.model.choose(ledger)
            assertEquals(LedgerStage.Failed(message("replug")), fixture.model.stage)
        }

    @Test
    fun heldAccountMatchesWhenPadded() =
        runBlocking {
            val held = "0x00" + address(LedgerScheme.BRAMBLE, AccountFamily.OPEN_ZEPPELIN, 0u).removePrefix("0x")
            val fixture = Fixture(LedgerRoute.BRAMBLE, existing = setOf(held)) { LedgerActivity(true, true) }
            fixture.model.choose(ledger)
            assertEquals(
                "Already in this wallet",
                fixture.model.rows
                    .first()
                    .status,
            )
        }

    @Test
    fun failedCheckIsNotChecking() =
        runBlocking {
            val fixture = Fixture(LedgerRoute.BRAMBLE) { LedgerActivity(null, null) }
            fixture.model.choose(ledger)
            assertEquals(
                "Couldn't check this account's activity. Try again.",
                fixture.model.rows
                    .first()
                    .status,
            )
        }

    @Test
    fun heldAccountCannotBePicked() =
        runBlocking {
            val held = address(LedgerScheme.BRAMBLE, AccountFamily.OPEN_ZEPPELIN, 0u).uppercase()
            val fixture = Fixture(LedgerRoute.BRAMBLE, existing = setOf(held)) { LedgerActivity(true, true) }
            fixture.model.choose(ledger)
            val first = fixture.model.rows.first()
            assertFalse(first.selectable)
            assertEquals("Already in this wallet", first.status)
            fixture.model.toggle(first)
            assertFalse(first.candidate.request in fixture.model.chosen)
        }

    /** A model over a fake scanner, a replaying device and a scripted core. */
    private inner class Fixture(
        route: LedgerRoute,
        bluetooth: LedgerBluetooth = LedgerBluetooth.READY,
        refusal: String? = null,
        disconnectAfter: Int? = null,
        connectFails: Boolean = false,
        connectError: Exception? = null,
        existing: Set<String> = emptySet(),
        describe: (String) -> LedgerActivity = { LedgerActivity(false, false) },
    ) {
        val script = recordedExchanges()
        val scanner = FakeScanner(bluetooth, listOf(ledger))
        val device = ReplayDevice(script, disconnectAfter)
        val readers = mutableListOf<ScriptedReader>()
        val model =
            LedgerConnectModel(
                route,
                scanner,
                connect = {
                    if (connectFails) throw LedgerLinkException.Disconnected()
                    connectError?.let { throw it }
                    device
                },
                core = ScriptedCore(refusal, readers, describe),
                existing = existing,
            )

        fun recorded(apdu: ByteArray): ByteArray = script.getValue(apdu.toList())
    }

    /** Readers from the script, placement by name, and [activity] for the chain. */
    private inner class ScriptedCore(
        private val refusal: String?,
        private val readers: MutableList<ScriptedReader>,
        private val activity: (String) -> LedgerActivity,
    ) : LedgerCore {
        override fun reader(
            scheme: LedgerScheme,
            startIndex: UInt,
            count: UInt,
        ) = ScriptedReader(Triple(scheme, startIndex, count), refusal).also { readers += it }

        override fun place(
            keys: List<LedgerKey>,
            family: AccountFamily,
        ) = keys.map { LedgerCandidate(request(it, family), address(it.scheme, family, it.accountIndex)) }

        override suspend fun describe(address: String) = activity(address)

        /** The core's minimal form: lowercase, no leading zeros. */
        override fun canonical(address: String) = "0x" + address.lowercase().removePrefix("0x").trimStart('0')
    }

    /** The core's steps for one key at a scheme: the version, then the key, or [refusal] after it. */
    private class ScriptedReader(
        val page: Triple<LedgerScheme, UInt, UInt>,
        private val refusal: String?,
    ) : LedgerKeyReaderInterface {
        private val apdus =
            listOf(
                VERSION_APDU,
                if (page.first ==
                    LedgerScheme.BRAMBLE
                ) {
                    BRAMBLE_KEY_APDU
                } else {
                    READY_KEY_APDU
                },
            )
        val replies = mutableListOf<ByteArray>()
        val failures = mutableListOf<TransportFailure>()

        override fun start(): LedgerReadStep = LedgerReadStep.Send(apdus[0])

        override fun reply(reply: ByteArray): LedgerReadStep {
            replies += reply
            return when {
                refusal != null -> LedgerReadStep.Refused(refusal)
                replies.size < apdus.size -> LedgerReadStep.Send(apdus[replies.size])
                else -> LedgerReadStep.Keys(listOf(LedgerKey(page.first, page.second, KEY)))
            }
        }

        override fun transportFailure(failure: TransportFailure): LedgerReadStep {
            failures += failure
            return LedgerReadStep.Refused("disconnected-mid-sign")
        }
    }

    private class FakeScanner(
        override var bluetooth: LedgerBluetooth,
        private val nearby: List<LedgerDevice>,
    ) : LedgerScanning {
        override var devices: List<LedgerDevice> = emptyList()
        override var changed: (() -> Unit)? = null
        var scans = 0

        fun set(state: LedgerBluetooth) {
            bluetooth = state
            if (state != LedgerBluetooth.READY) devices = emptyList()
            changed?.invoke()
        }

        override fun startScan() {
            if (bluetooth != LedgerBluetooth.READY) return
            scans += 1
            devices = nearby
        }

        override fun stopScan() = Unit
    }

    /** A Starknet app answering from the transcripts; after [disconnectAfter] replies, a disconnect. */
    private class ReplayDevice(
        private val script: Map<List<Byte>, ByteArray>,
        private val disconnectAfter: Int?,
    ) : LedgerExchanging {
        var closed = false
        private var replies = 0

        override suspend fun send(apdu: ByteArray): LedgerExchange {
            val lost = closed || (disconnectAfter != null && replies >= disconnectAfter)
            replies += 1
            val reply = script[apdu.toList()]
            return when {
                lost -> LedgerExchange.Failure(TransportFailure.DISCONNECTED)
                reply == null -> LedgerExchange.Failure(TransportFailure.OTHER)
                else -> LedgerExchange.Reply(reply)
            }
        }

        override fun close() {
            closed = true
        }
    }

    private fun request(
        key: LedgerKey,
        family: AccountFamily,
    ) = LedgerAccountRequest(NetworkId.MAINNET, family, key.scheme, key.accountIndex, key.publicKeyX)

    private fun address(
        scheme: LedgerScheme,
        family: AccountFamily,
        index: UInt,
    ) = "0xa${scheme.ordinal}${family.ordinal}$index"

    private fun message(code: String) = FriendlyErrorRules.ledgerMessages.getValue(code)

    /** Every recorded `{request, reply}` in the transcripts; a request recorded twice keeps its first. */
    private fun recordedExchanges(): Map<List<Byte>, ByteArray> {
        val pair = Regex(""""reply":"([0-9a-f]+)","request":"([0-9a-f]+)"""")
        val script = mutableMapOf<List<Byte>, ByteArray>()
        fixture().readLines().filterNot { "\"recorded\":false" in it }.forEach { line ->
            pair.findAll(line).forEach { match ->
                script.getOrPut(hex(match.groupValues[2]).toList()) { hex(match.groupValues[1]) }
            }
        }
        return script
    }

    /** The core's fixture, from the module directory Gradle runs JVM tests in. */
    private fun fixture(): File = File("../../core/tests/fixtures/extension-ledger.jsonl")

    private companion object {
        const val HEX = 16
        const val KEY = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
        val VERSION_APDU = hex("5a00000000")
        val BRAMBLE_KEY_APDU = hex("5a0100001880000a55c741e9c9abcee7db800000008000000000000000")
        val READY_KEY_APDU = hex("5a0100001880000a55c741e9c9c47a6028800000008000000000000000")

        fun hex(digits: String): ByteArray = digits.chunked(2).map { it.toInt(HEX).toByte() }.toByteArray()
    }
}
