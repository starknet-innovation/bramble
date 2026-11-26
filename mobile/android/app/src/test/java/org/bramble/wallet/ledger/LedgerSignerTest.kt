package org.bramble.wallet.ledger

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.NoHandle
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.TransportFailure
import org.bramble.wallet.errors.FriendlyErrorRules
import org.bramble.wallet.send.SendDriver
import org.bramble.wallet.ui.ledger.LedgerSignCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Signing on a Ledger through [SendDriver] and [LedgerSigner], twin of iOS `LedgerSigningTests`.
 * The core does not load on the JVM, so the plan is scripted with the core's device steps for the
 * "plan transfer" block of the Speculos transcripts (`extension-ledger.jsonl`): each APDU in
 * order, each reply checked byte for byte against the recording, a refusal parked as the core
 * parks it. The device answers from the same transcripts.
 */
class LedgerSignerTest {
    private val ledger = LedgerDevice("AA:BB:CC:DD:EE:FF", "Nano X 1A2B")
    private var current: Rig? = null

    @Test
    fun approvedIsSignedAndBroadcast() =
        runBlocking {
            var shown: LedgerSignStage? = null
            var signerShown: AccountRecord? = null
            val rig =
                Rig { device ->
                    device.onSend = {
                        if (LedgerSigner.shownHash(it) != null) {
                            shown = rig().signer.stage
                            signerShown = rig().signer.account
                        }
                    }
                }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            assertEquals(SendStep.Broadcast(TRANSFER_HASH), signing.await())
            assertEquals("the device shows the hash it signs", LedgerSignStage.Confirming(TRANSFER_HASH), shown)
            assertEquals("the signer is the plan's account, not the active one", PLAN_ACCOUNT, signerShown)
            assertEquals("Signing with 0x0231…ab4d · Account 0", LedgerSignCopy.signer(PLAN_ACCOUNT))
            assertEquals(null, rig.signer.account)
            assertEquals(LedgerSignStage.Idle, rig.signer.stage)
            assertTrue("the link closes when the send ends", rig.made.single().closed)
        }

    @Test
    fun connectStageSaysPaused() =
        runBlocking {
            val rig = Rig()
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            until { rig.signer.stage == LedgerSignStage.Scanning }
            assertEquals("The transaction is safely paused.", LedgerSignCopy.connectNote(rig.signer.stage))
            assertEquals(PLAN_ACCOUNT, rig.signer.account)
            assertEquals(null, LedgerSignCopy.connectNote(LedgerSignStage.Checking))
            rig.signer.cancel()
            assertEquals(CANCELLED, signing.await())
        }

    @Test
    fun refusalParksThenTryAgainSigns() =
        runBlocking {
            val rig = Rig { it.answerOnce[SIGN_HASH_APDU.toList()] = REFUSED }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            until { rig.signer.stage is LedgerSignStage.Refused }
            assertEquals(LedgerSignStage.Refused(message("rejected-or-blind-signing-off")), rig.signer.stage)
            rig.signer.retry()
            assertEquals(SendStep.Broadcast(TRANSFER_HASH), signing.await())
            assertEquals("the connected Ledger is used again", 1, rig.made.size)
        }

    @Test
    fun anotherLedgerIsRefusedFirst() =
        runBlocking {
            val rig = Rig(key = OTHER_KEY)
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            until { rig.signer.stage is LedgerSignStage.Refused }
            assertEquals(LedgerSignStage.Refused(message("wrong-device")), rig.signer.stage)
            assertFalse(
                rig.made
                    .single()
                    .requests
                    .any { LedgerSigner.shownHash(it.toByteArray()) != null },
            )
            assertTrue("another Ledger is needed", rig.made.single().closed)
            rig.signer.cancel()
            assertEquals(CANCELLED, signing.await())
            assertTrue(rig.plan.cancelled)
        }

    @Test
    fun lockedLedgerAsksToUnlockIt() =
        runBlocking {
            val rig = Rig { it.answerOnce[VERSION_APDU.toList()] = LOCKED_WORD }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            until { rig.signer.stage is LedgerSignStage.Refused }
            assertEquals(LedgerSignStage.Refused(message("device-locked")), rig.signer.stage)
            rig.signer.cancel()
            assertEquals(CANCELLED, signing.await())
        }

    @Test
    fun walletLockEndsUnsigned() =
        runBlocking {
            val rig =
                Rig { device ->
                    device.onSend =
                        { if (LedgerSigner.shownHash(it) != null) rig().plan.locked = true }
                }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            assertEquals(SendStep.Failed(SendFailure(SendFailureCode.LOCKED, null, null)), signing.await())
        }

    @Test
    fun disconnectThenCancelCloses() =
        runBlocking {
            val rig = Rig { it.disconnectAfter = 3 }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            until { rig.signer.stage is LedgerSignStage.Refused }
            assertEquals(LedgerSignStage.Refused(message("disconnected-mid-sign")), rig.signer.stage)
            assertEquals(StepReply.DeviceFailure(TransportFailure.DISCONNECTED), rig.plan.replies.last())
            rig.signer.cancel()
            assertEquals(CANCELLED, signing.await())
            assertTrue(rig.plan.cancelled)
            assertEquals(LedgerSignStage.Idle, rig.signer.stage)
        }

    @Test
    fun cancelWhileAskedEndsLink() =
        runBlocking {
            val rig = Rig { it.hold = true }
            val signing = async(Dispatchers.Default) { rig.driver.run(StepReply.Confirm) }
            rig.pick(ledger)
            until { rig.signer.stage is LedgerSignStage.Confirming }
            rig.signer.cancel()
            assertEquals(CANCELLED, signing.await())
            assertTrue(rig.made.single().closed)
        }

    @Test
    fun onlySignHashShowsAHash() {
        assertEquals(null, LedgerSigner.shownHash(VERSION_APDU))
        assertEquals(TRANSFER_HASH, LedgerSigner.shownHash(SIGN_HASH_APDU))
    }

    // Fixtures

    private fun rig(): Rig = current!!

    private inner class Rig(
        key: String = KEY,
        configure: (ReplayDevice) -> Unit = {},
    ) {
        val made = mutableListOf<ReplayDevice>()
        val scanner = Scanner(listOf(ledger))
        val signer =
            LedgerSigner(scanner) {
                ReplayDevice(recordedExchanges()).also(configure).also { made += it }
            }
        val plan = ScriptedPlan(key)
        val driver = SendDriver(plan, NETWORK, { _, _, _ -> error("no RPC") }, PLAN_ACCOUNT, signer)

        init {
            current = this
        }

        suspend fun pick(device: LedgerDevice) {
            until { signer.stage == LedgerSignStage.Scanning }
            signer.choose(device)
        }
    }

    /**
     * The core's device steps for the recorded transfer: the version, the key at the path (a key
     * other than [key] is `wrong-device`), the path, then the hash; a refusal parks the plan.
     */
    private class ScriptedPlan(
        private val key: String,
    ) : TransferPlan(NoHandle) {
        val replies = mutableListOf<StepReply>()
        var cancelled = false

        @Volatile var locked = false
        private var next = 0

        override fun advance(reply: StepReply): SendStep {
            replies += reply
            val restart = reply is StepReply.Confirm || reply is StepReply.RetryDevice
            val refused =
                when {
                    restart -> null
                    reply is StepReply.DeviceFailure -> "disconnected-mid-sign"
                    else -> refusal((reply as StepReply.Device).reply)
                }
            next = if (restart) 0 else next + 1
            return when {
                restart -> SendStep.Device(TRANSFER_APDUS[0])
                locked -> SendStep.Failed(SendFailure(SendFailureCode.LOCKED, null, null))
                refused != null -> SendStep.DeviceRetry(refused)
                next < TRANSFER_APDUS.size -> SendStep.Device(TRANSFER_APDUS[next])
                else -> SendStep.Broadcast(TRANSFER_HASH)
            }
        }

        private fun refusal(answer: ByteArray): String? =
            when {
                answer.contentEquals(LOCKED_WORD) -> "device-locked"
                answer.contentEquals(REFUSED) -> "rejected-or-blind-signing-off"
                next == 1 && !answer.toHex().contains(key.removePrefix("0x")) -> "wrong-device"
                else -> null
            }

        override fun cancel() {
            cancelled = true
        }
    }

    private class Scanner(
        private val nearby: List<LedgerDevice>,
    ) : LedgerScanning {
        override val bluetooth = LedgerBluetooth.READY
        override var devices: List<LedgerDevice> = emptyList()
        override var changed: (() -> Unit)? = null

        override fun startScan() {
            devices = nearby
        }

        override fun stopScan() = Unit
    }

    /** A Starknet app answering from the transcripts; [hold] leaves the hash unanswered until closed. */
    private class ReplayDevice(
        private val script: Map<List<Byte>, ByteArray>,
    ) : LedgerExchanging {
        val answerOnce = mutableMapOf<List<Byte>, ByteArray>()
        val requests = mutableListOf<List<Byte>>()
        var disconnectAfter: Int? = null
        var hold = false
        var onSend: (ByteArray) -> Unit = {}

        @Volatile var closed = false

        override suspend fun send(apdu: ByteArray): LedgerExchange {
            requests += apdu.toList()
            val lost = closed || disconnectAfter?.let { requests.size > it } == true
            if (!lost) onSend(apdu)
            if (!lost && hold && LedgerSigner.shownHash(apdu) != null) {
                while (!closed) delay(1)
            }
            val reply = answerOnce.remove(apdu.toList()) ?: script[apdu.toList()]
            return when {
                lost || closed -> LedgerExchange.Failure(TransportFailure.DISCONNECTED)
                reply == null -> LedgerExchange.Failure(TransportFailure.OTHER)
                else -> LedgerExchange.Reply(reply)
            }
        }

        override fun close() {
            closed = true
        }
    }

    private fun message(code: String) = FriendlyErrorRules.ledgerMessages.getValue(code)

    private companion object {
        const val HEX = 16
        const val KEY = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
        const val OTHER_KEY = "0x33c4127080fab3f30bcac5837c9c352da3a9d74e79a57b779a379719d655dee"
        const val TRANSFER_HASH = "0x051899a4f58db1d9dd67bd2887ce37adfcbdd41c1163b49c345143e20184cdcd"
        val NETWORK = NetworkInfo(NetworkId.SEPOLIA, "0x534e5f5345504f4c4941", "", "Sepolia", emptyList(), emptyList())

        /** The account the plan is built for: a Ledger record that is not the active one. */
        val PLAN_ACCOUNT =
            AccountRecord(
                "SN_SEPOLIA:0x231",
                NetworkId.SEPOLIA,
                AccountFamily.OPEN_ZEPPELIN,
                "0x1",
                0u,
                "0x0231000000000000000000000000000000000000000000000000000000ab4d",
                KEY,
                null,
                null,
                "Account 1",
                "0x0231…ab4d",
                null,
                "stark-pair",
                null,
                active = false,
                hidden = false,
                imported = false,
                ledger = true,
            )
        val CANCELLED = SendStep.Failed(SendFailure(SendFailureCode.SIGNING_FAILED, null, null))
        val VERSION_APDU = hex("5a00000000")
        val SIGN_HASH_APDU = hex("5a02010020" + TRANSFER_HASH.removePrefix("0x"))
        val REFUSED = hex("6985")
        val LOCKED_WORD = hex("5515")

        /** The "plan transfer" block's requests, in order. */
        val TRANSFER_APDUS: List<ByteArray> by lazy {
            val line = fixture().readLines().single { """"name":"plan transfer"""" in it }
            Regex(""""request":"([0-9a-f]+)"""").findAll(line).map { hex(it.groupValues[1]) }.toList()
        }

        fun hex(digits: String): ByteArray = digits.chunked(2).map { it.toInt(HEX).toByte() }.toByteArray()

        fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

        fun fixture(): File = File("../../core/tests/fixtures/extension-ledger.jsonl")

        /** Every recorded `{request, reply}`; a request recorded twice keeps its first. */
        fun recordedExchanges(): Map<List<Byte>, ByteArray> {
            val pair = Regex(""""reply":"([0-9a-f]+)","request":"([0-9a-f]+)"""")
            val script = mutableMapOf<List<Byte>, ByteArray>()
            fixture().readLines().filterNot { "\"recorded\":false" in it }.forEach { line ->
                pair
                    .findAll(
                        line,
                    ).forEach { script.getOrPut(hex(it.groupValues[2]).toList()) { hex(it.groupValues[1]) } }
            }
            return script
        }

        suspend fun until(condition: () -> Boolean) =
            withTimeout(5_000) {
                while (!condition()) delay(1)
            }
    }
}
