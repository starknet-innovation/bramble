package org.bramble.wallet.ledger

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import org.bramble.core.LedgerBleExchange
import org.bramble.core.LedgerBleStep
import org.bramble.core.TransportFailure
import org.bramble.core.ledgerBleLink
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * [LedgerBleDriver] over a fake link that plays the device, as iOS `LedgerBleDriverTests`: it
 * answers the MTU request, puts the written frames back together with the core's reassembler and
 * answers each APDU with its reply from the Speculos transcripts (`extension-ledger.jsonl`),
 * framed by the core's own framing. Instrumented because the core only runs on a device.
 */
@RunWith(AndroidJUnit4::class)
class LedgerBleDriverTest {
    private val exchanges: List<Pair<ByteArray, ByteArray>> by lazy {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val lines = assets.open("extension-ledger.jsonl").bufferedReader().readLines()
        lines.filter { it.isNotBlank() }.mapNotNull { JSONObject(it).optJSONArray("exchanges") }.flatMap { pairs ->
            (0 until pairs.length()).map { i ->
                val pair = pairs.getJSONObject(i)
                bytes(pair.getString("request")) to bytes(pair.getString("reply"))
            }
        }
    }

    @Test
    fun replaysEveryExchangeByteExact() =
        runBlocking {
            assertTrue(exchanges.isNotEmpty())
            // The default 20-byte frames split most replies; a larger device MTU and a host write
            // limit below it check that the smaller one wins.
            for ((deviceSize, hostLimit) in listOf(20 to 20, 153 to 100)) {
                val link = FakeLink(deviceSize, hostLimit)
                link.script += exchanges
                val driver = LedgerBleDriver(link)
                for ((request, reply) in exchanges) {
                    assertEquals(LedgerExchange.Reply(reply), driver.exchange(request))
                }
                assertEquals(exchanges.map { it.first.toList() }, link.requests.map { it.toList() })
                assertTrue(link.written.all { it.size <= minOf(deviceSize, hostLimit) })
            }
        }

    @Test
    fun handshakeDropsOtherNotes() =
        runBlocking {
            val (request, reply) = exchanges.first()
            val link = FakeLink(64, 64)
            link.beforeMtuAnswer += listOf(byteArrayOf(5, 0, 0), byteArrayOf(8, 0))
            link.script += request to reply
            assertEquals(LedgerExchange.Reply(reply), LedgerBleDriver(link).exchange(request))
            assertEquals(ledgerBleLink().mtuRequest.toList(), link.written.first().toList())
        }

    @Test
    fun disconnectMidReply() =
        runBlocking {
            val (request, reply) = exchanges.first { it.second.size > 40 }
            val link = FakeLink(20, 20)
            link.script += request to reply
            link.replyFramesBeforeDisconnect = 1
            assertEquals(LedgerExchange.Failure(TransportFailure.DISCONNECTED), LedgerBleDriver(link).exchange(request))
        }

    @Test
    fun silentDeviceTimesOut() =
        runBlocking {
            val (request, _) = exchanges.first()
            val link = FakeLink(20, 20)
            val driver = LedgerBleDriver(link)
            // No script: the device answers the MTU request, then never replies.
            assertEquals(LedgerExchange.Failure(TransportFailure.OTHER), driver.exchange(request, timeoutMs = 50))
            assertTrue(link.closed)
            assertEquals(LedgerExchange.Failure(TransportFailure.DISCONNECTED), driver.exchange(request))
        }

    @Test
    fun malformedReplyFails() =
        runBlocking {
            val (request, reply) = exchanges.first()
            val link = FakeLink(20, 20)
            link.script += request to reply
            link.rawReply = listOf(byteArrayOf(5, 0, 1, 0, 2, 0x90.toByte(), 0))
            assertEquals(LedgerExchange.Failure(TransportFailure.OTHER), LedgerBleDriver(link).exchange(request))
            assertTrue(link.closed)
        }

    private fun bytes(hex: String): ByteArray = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    /** A device behind a link: the MTU answer, then each scripted reply in the core's framing. */
    private class FakeLink(
        private val deviceFrameSize: Int,
        override val maximumWriteLength: Int,
    ) : LedgerLink {
        val script = mutableListOf<Pair<ByteArray, ByteArray>>()
        val beforeMtuAnswer = mutableListOf<ByteArray>()
        var replyFramesBeforeDisconnect: Int? = null
        var rawReply: List<ByteArray> = emptyList()
        val written = mutableListOf<ByteArray>()
        val requests = mutableListOf<ByteArray>()
        var closed = false
        private val outbox = Channel<ByteArray>(Channel.UNLIMITED)
        private var incoming: LedgerBleExchange? = null

        override suspend fun write(frame: ByteArray) {
            if (closed) throw LedgerLinkException.Disconnected()
            written += frame
            val mtuRequest = ledgerBleLink().mtuRequest
            if (frame.contentEquals(mtuRequest)) {
                // The MTU answer is the request's bytes followed by the device's frame size.
                send(beforeMtuAnswer + (mtuRequest + deviceFrameSize.toByte()))
            } else {
                // Any APDU-sized placeholder: only its reassembler is used.
                val reassembler = incoming ?: LedgerBleExchange(byteArrayOf(0), deviceFrameSize.toUInt())
                incoming = reassembler
                (reassembler.push(frame) as? LedgerBleStep.Reply)?.let { request ->
                    incoming = null
                    requests += request.reply
                    script.removeFirstOrNull()?.let { answer(it.second) }
                }
            }
        }

        private fun answer(reply: ByteArray) {
            val framed = LedgerBleExchange(reply, deviceFrameSize.toUInt()).frames().map { it.bytes }
            val frames = rawReply.ifEmpty { framed }
            val cut = replyFramesBeforeDisconnect
            send(if (cut == null) frames else frames.take(cut))
            if (cut != null) outbox.close()
        }

        private fun send(frames: List<ByteArray>) = frames.forEach { outbox.trySend(it) }

        override suspend fun nextNotification(): ByteArray =
            outbox.receiveCatching().getOrNull() ?: throw LedgerLinkException.Disconnected()

        override fun close() {
            closed = true
            outbox.close()
        }
    }
}
