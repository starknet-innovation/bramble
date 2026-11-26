package org.bramble.wallet.ledger

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
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Ledger connect-and-pick model, twin of iOS `LedgerConnectModelTests`. The core cannot load
 * on the JVM, so the reader is scripted with the steps the core takes; the device answers each
 * APDU with its recorded reply from the Speculos transcripts (`extension-ledger.jsonl`), and the
 * model must hand every reply to the reader byte for byte.
 */
class LedgerConnectModelTest {
    private val ledger = LedgerDevice("AA:BB:CC:DD:EE:FF", "Nano X 1A2B")
    private val versionApdu = hex("5a00000000")
    private val key0Apdu = hex("5a0100001880000a55c741e9c9abcee7db800000008000000000000000")
    private val key0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"

    @Test
    fun keysBecomeCandidates() =
        runBlocking {
            val fixture = Fixture()
            fixture.model.choose(ledger)
            assertEquals(LedgerStage.Picking, fixture.model.stage)
            assertEquals(listOf(0u), fixture.model.candidates.map { it.request.accountIndex })
            assertEquals(
                key0,
                fixture.model.candidates
                    .single()
                    .request.publicKeyX,
            )
            val reader = fixture.readers.single()
            assertEquals(0u to LedgerConnectModel.PAGE_SIZE, reader.page)
            assertEquals(2, reader.replies.size)
            assertArrayEquals(fixture.recorded(versionApdu), reader.replies[0])
            assertArrayEquals(fixture.recorded(key0Apdu), reader.replies[1])
            assertFalse(fixture.device.closed)
            assertTrue(fixture.model.chosen.isEmpty())
            fixture.model.toggle(fixture.model.candidates.single())
            assertEquals(
                listOf(
                    fixture.model.candidates
                        .single()
                        .request,
                ),
                fixture.model.chosen,
            )
        }

    @Test
    fun showMoreReadsTheNextPage() =
        runBlocking {
            val fixture = Fixture()
            fixture.model.choose(ledger)
            fixture.model.more()
            assertEquals(LedgerStage.Picking, fixture.model.stage)
            assertEquals(listOf(0u, 1u), fixture.model.candidates.map { it.request.accountIndex })
            assertEquals(1u to LedgerConnectModel.PAGE_SIZE, fixture.readers[1].page)
            assertFalse(fixture.model.loadingMore)
        }

    @Test
    fun refusalShowsItsMessage() =
        runBlocking {
            for (code in listOf("app-below-minimum", "no-app-open", "device-locked")) {
                val fixture = Fixture(refusal = code)
                fixture.model.choose(ledger)
                assertEquals(LedgerStage.Failed(FriendlyErrorRules.ledgerMessages.getValue(code)), fixture.model.stage)
                assertTrue(fixture.model.candidates.isEmpty())
                assertTrue(fixture.device.closed)
            }
        }

    @Test
    fun disconnectMidReadThenRetry() =
        runBlocking {
            val fixture = Fixture(disconnectAfter = 1)
            fixture.model.choose(ledger)
            assertEquals(listOf(TransportFailure.DISCONNECTED), fixture.readers.single().failures)
            val message = FriendlyErrorRules.ledgerMessages.getValue("disconnected-mid-sign")
            assertEquals(LedgerStage.Failed(message), fixture.model.stage)
            assertTrue(fixture.device.closed)
            fixture.model.retry()
            assertEquals(LedgerStage.Scanning, fixture.model.stage)
            assertEquals(2, fixture.scanner.scans)
        }

    @Test
    fun failedConnectAsksToReconnect() =
        runBlocking {
            val scanner = FakeScanner(LedgerBluetooth.READY, listOf(ledger))
            val model =
                LedgerConnectModel(
                    scanner,
                    connect = { throw LedgerLinkException.Disconnected() },
                    reader = { _, _ -> error("no reader without a device") },
                    place = { emptyList() },
                    existing = emptySet(),
                )
            model.choose(ledger)
            assertEquals(LedgerStage.Failed(FriendlyErrorRules.ledgerMessages.getValue("replug")), model.stage)
        }

    @Test
    fun deniedOrOffNeverScans() {
        for (state in listOf(LedgerBluetooth.UNAUTHORIZED, LedgerBluetooth.OFF, LedgerBluetooth.UNSUPPORTED)) {
            val fixture = Fixture(bluetooth = state)
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
    fun heldAccountCannotBePicked() =
        runBlocking {
            val fixture = Fixture(existing = setOf(address(0u).uppercase()))
            fixture.model.choose(ledger)
            val first = fixture.model.candidates.single()
            assertTrue(fixture.model.isExisting(first))
            fixture.model.toggle(first)
            assertTrue(fixture.model.chosen.isEmpty())
        }

    /** A model over a fake scanner, a replaying device and scripted readers. */
    private inner class Fixture(
        bluetooth: LedgerBluetooth = LedgerBluetooth.READY,
        refusal: String? = null,
        disconnectAfter: Int? = null,
        existing: Set<String> = emptySet(),
    ) {
        val script = recordedExchanges()
        val scanner = FakeScanner(bluetooth, listOf(ledger))
        val device = ReplayDevice(script, disconnectAfter)
        val readers = mutableListOf<ScriptedReader>()

        val model =
            LedgerConnectModel(
                scanner,
                connect = { device },
                reader = { start, count ->
                    ScriptedReader(start to count, refusal, listOf(versionApdu, key0Apdu)).also { readers += it }
                },
                place = { keys -> keys.map { LedgerCandidate(request(it), address(it.accountIndex)) } },
                existing = existing,
            )

        fun recorded(apdu: ByteArray): ByteArray = script.getValue(apdu.toList())
    }

    /** The core's steps for one key: the version, then the key, or [refusal] after the version. */
    private inner class ScriptedReader(
        val page: Pair<UInt, UInt>,
        private val refusal: String?,
        private val apdus: List<ByteArray>,
    ) : LedgerKeyReaderInterface {
        val replies = mutableListOf<ByteArray>()
        val failures = mutableListOf<TransportFailure>()

        override fun start(): LedgerReadStep = LedgerReadStep.Send(apdus[0])

        override fun reply(reply: ByteArray): LedgerReadStep {
            replies += reply
            return when {
                refusal != null -> LedgerReadStep.Refused(refusal)
                replies.size < apdus.size -> LedgerReadStep.Send(apdus[replies.size])
                else -> LedgerReadStep.Keys(listOf(LedgerKey(LedgerScheme.BRAMBLE, page.first, key0)))
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

    private fun request(key: LedgerKey) =
        LedgerAccountRequest(
            NetworkId.MAINNET,
            AccountFamily.OPEN_ZEPPELIN,
            key.scheme,
            key.accountIndex,
            key.publicKeyX,
        )

    private fun address(index: UInt) = "0xabc$index"

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

    private fun hex(digits: String): ByteArray = digits.chunked(2).map { it.toInt(HEX).toByte() }.toByteArray()

    private companion object {
        const val HEX = 16
    }
}
