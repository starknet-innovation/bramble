package org.bramble.wallet.ledger

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeoutOrNull
import org.bramble.core.CoreException
import org.bramble.core.LedgerBleExchange
import org.bramble.core.LedgerBleStep
import org.bramble.core.TransportFailure
import org.bramble.core.ledgerBleFrameSize
import org.bramble.core.ledgerBleLink

/**
 * What the driver needs from a connected Bluetooth link: whole writes and notifications in order.
 * [LedgerGattLink] is the BluetoothGatt one; tests swap in a fake.
 */
interface LedgerLink {
    /** The longest value one write may carry. */
    val maximumWriteLength: Int

    /** Writes [frame] whole to the write characteristic; throws [LedgerLinkException] on failure. */
    suspend fun write(frame: ByteArray)

    /** The next notification, in arrival order; throws [LedgerLinkException] when the link ends. */
    suspend fun nextNotification(): ByteArray

    /** Ends the link; every pending and later call throws [LedgerLinkException.Disconnected]. */
    fun close()
}

/** Why a link call failed. */
sealed class LedgerLinkException : Exception() {
    /** The device or Bluetooth went away, or the link was closed. */
    class Disconnected : LedgerLinkException()

    /** A GATT operation failed or was refused. */
    class Failed : LedgerLinkException()
}

/**
 * One APDU's outcome, in the form every Ledger consumer takes: [Reply.reply] goes to a reader's
 * or plan's `reply` (`StepReply.Device`), [Failure.failure] to its `transportFailure`
 * (`StepReply.DeviceFailure`).
 */
sealed interface LedgerExchange {
    /**
     * The device's answer. Untrusted; the core judges it.
     *
     * @property reply its data, then the status word.
     */
    data class Reply(
        val reply: ByteArray,
    ) : LedgerExchange {
        override fun equals(other: Any?): Boolean = other is Reply && other.reply.contentEquals(reply)

        override fun hashCode(): Int = reply.contentHashCode()
    }

    /**
     * No answer.
     *
     * @property failure what the transport reported in its place.
     */
    data class Failure(
        val failure: TransportFailure,
    ) : LedgerExchange
}

/**
 * Moves one APDU at a time over a [LedgerLink], as iOS `LedgerBleDriver`: the MTU handshake on
 * first use, then the core's framing out and reassembly in ([LedgerBleExchange]). It never reads
 * or alters an APDU.
 *
 * Failure: a disconnect is [TransportFailure.DISCONNECTED]; a timeout, a failed write or
 * malformed frames are [TransportFailure.OTHER]. Every failure, and a cancelled exchange, closes
 * the link, so a late or stray frame can never answer the next APDU; the host connects a new link
 * and driver.
 */
class LedgerBleDriver(
    private val link: LedgerLink,
) : LedgerExchanging {
    private val setup = ledgerBleLink()
    private val busy = Mutex()
    private var frameSize: UInt? = null

    /**
     * Sends [apdu] and returns the device's reply or the transport failure, waiting at most
     * [timeoutMs] for it. One exchange at a time: a concurrent call fails without writing.
     */
    suspend fun exchange(
        apdu: ByteArray,
        timeoutMs: Long = REPLY_TIMEOUT_MS,
    ): LedgerExchange {
        if (!busy.tryLock()) return LedgerExchange.Failure(TransportFailure.OTHER)
        var outcome: LedgerExchange = LedgerExchange.Failure(TransportFailure.OTHER)
        try {
            outcome = attempt(apdu, timeoutMs)
        } finally {
            if (outcome !is LedgerExchange.Reply) link.close()
            busy.unlock()
        }
        return outcome
    }

    override suspend fun send(apdu: ByteArray): LedgerExchange = exchange(apdu)

    /** Ends the link; later exchanges fail as [TransportFailure.DISCONNECTED]. */
    override fun close() = link.close()

    private suspend fun attempt(
        apdu: ByteArray,
        timeoutMs: Long,
    ): LedgerExchange =
        try {
            negotiatedFrameSize()?.let { size ->
                LedgerBleExchange(apdu, size).use { exchange -> withTimeoutOrNull(timeoutMs) { run(exchange) } }
            } ?: LedgerExchange.Failure(TransportFailure.OTHER)
        } catch (ignored: LedgerLinkException.Disconnected) {
            LedgerExchange.Failure(TransportFailure.DISCONNECTED)
        } catch (ignored: LedgerLinkException.Failed) {
            LedgerExchange.Failure(TransportFailure.OTHER)
        } catch (ignored: CoreException) {
            // An empty or oversized APDU, which the core refuses to frame.
            LedgerExchange.Failure(TransportFailure.OTHER)
        }

    /** The frame size, asking the device on first use; null when it does not answer in time. */
    private suspend fun negotiatedFrameSize(): UInt? {
        frameSize?.let { return it }
        val answer =
            withTimeoutOrNull(HANDSHAKE_TIMEOUT_MS) {
                link.write(setup.mtuRequest)
                var size: UInt? = null
                while (size == null) {
                    val note = link.nextNotification()
                    // Anything that is not an MTU answer is dropped, as Ledger's transports do.
                    size = runCatching { ledgerBleFrameSize(note) }.getOrNull()
                }
                size
            }
        frameSize = answer?.let { minOf(it, link.maximumWriteLength.coerceAtLeast(0).toUInt()) }
        return frameSize
    }

    private suspend fun run(exchange: LedgerBleExchange): LedgerExchange {
        exchange.frames().forEach { link.write(it.bytes) }
        var outcome: LedgerExchange? = null
        while (outcome == null) {
            outcome =
                when (val step = exchange.push(link.nextNotification())) {
                    is LedgerBleStep.More -> null
                    is LedgerBleStep.Reply -> LedgerExchange.Reply(step.reply)
                    is LedgerBleStep.Failed -> LedgerExchange.Failure(step.failure)
                }
        }
        return outcome
    }

    /** Timeouts. */
    companion object {
        /** How long the device has to answer the MTU request. */
        const val HANDSHAKE_TIMEOUT_MS = 5_000L

        /** How long one APDU may wait for its reply; a signature waits for the person's review. */
        const val REPLY_TIMEOUT_MS = 300_000L
    }
}
