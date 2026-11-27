package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.HttpOutcome
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkId
import org.bramble.core.StepReply
import org.bramble.core.TransportFailure
import org.bramble.core.WalletCore
import org.bramble.core.ledgerAccountCandidates
import org.bramble.wallet.browser.DappRequest
import org.bramble.wallet.browser.DappRequestSink
import org.bramble.wallet.ledger.DeviceSigning
import org.bramble.wallet.ledger.LedgerSigner
import org.bramble.wallet.security.DeviceClock
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * A site's typed data signed by a Ledger account in the in-app browser, through the real core, as
 * iOS `DappLedgerSignTests`: a Ledger-only wallet holding LedgerW account 0, connected to the site,
 * and a device answering from the Speculos transcripts (`extension-ledger.jsonl`). No transcript
 * holds a typed-data hash, so the device answers it with the recorded transfer signature, which
 * the core checks against the card's hash and refuses (163).
 */
@RunWith(AndroidJUnit4::class)
class DappLedgerSignTest {
    private val origin = "https://app.example.com"
    private val id = "0f8fad5b-d9cb-469f-a165-70867728950e"

    @Test
    fun signerIsReviewedAccount() =
        runBlocking {
            val rig = rig(Device(script()))
            val settled = rig.sink.sign(rig.card).single()
            assertEquals(rig.requestId, settled.requestId)
            assertEquals(163, JSONObject(settled.json).getJSONObject("error").getInt("code"))
            assertEquals(listOf(rig.record.id), rig.device.signers)
            assertEquals(1, rig.device.hashes.size)
            assertTrue(rig.device.finished)
            assertTrue(rig.sink.cards.isEmpty())
        }

    @Test
    fun refusalThenRetryAsksSameHash() =
        runBlocking {
            val rig = rig(Device(script()).apply { refuseFirst = true })
            val settled = rig.sink.sign(rig.card).single()
            assertEquals(rig.requestId, settled.requestId)
            assertEquals(1, rig.device.retries)
            assertEquals(2, rig.device.hashes.size)
            assertEquals(rig.device.hashes.first(), rig.device.hashes.last())
        }

    @Test
    fun cancelOnSheetRefusesPage() =
        runBlocking {
            val rig = rig(Device(script()).apply { cancelAtHash = true })
            val settled = rig.sink.sign(rig.card).single()
            assertEquals(163, JSONObject(settled.json).getJSONObject("error").getInt("code"))
            assertTrue(rig.device.finished)
            assertTrue(rig.sink.cards.isEmpty())
        }

    private data class Rig(
        val sink: DappRequestSink,
        val device: Device,
        val record: AccountRecord,
        val requestId: ULong,
        val card: DappRequestSink.Card,
    )

    private fun rig(device: Device): Rig {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        val core = WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
        val key = LedgerKey(LedgerScheme.BRAMBLE, 0u, KEY0)
        val candidate = ledgerAccountCandidates(NetworkId.MAINNET, AccountFamily.OPEN_ZEPPELIN, listOf(key)).first()
        val record = core.createLedgerWallet("a strong password", candidate.request)
        val sink = DappRequestSink(core, signer = device, http = { HttpOutcome(0u, null, null, false) })
        sink.answer(DappRequest(origin, id, "wallet_requestAccounts"), NetworkId.MAINNET)
        sink.approve(sink.cards.single(), record.id)
        val held = sink.answer(DappRequest(origin, id, "wallet_signTypedData", TYPED_DATA), NetworkId.MAINNET)
        return Rig(sink, device, record, (held as DappRequestSink.Answer.Held).requestId, sink.cards.single())
    }

    private fun script(): Map<List<Byte>, ByteArray> {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val lines = assets.open("extension-ledger.jsonl").bufferedReader().readLines()
        val script = mutableMapOf<List<Byte>, ByteArray>()
        val blocks = lines.filter { it.isNotBlank() && "\"recorded\":false" !in it }
        blocks.mapNotNull { JSONObject(it).optJSONArray("exchanges") }.forEach { pairs ->
            for (i in 0 until pairs.length()) {
                val pair = pairs.getJSONObject(i)
                script.getOrPut(hex(pair.getString("request")).toList()) { hex(pair.getString("reply")) }
            }
        }
        return script
    }

    /**
     * The recorded device behind the sheet, except the sign-hash request: answered with the
     * recorded transfer signature, refused once ([refuseFirst]), or cancelled ([cancelAtHash]).
     */
    private class Device(
        private val script: Map<List<Byte>, ByteArray>,
    ) : DeviceSigning {
        var refuseFirst = false
        var cancelAtHash = false
        val hashes = mutableListOf<List<Byte>>()
        val signers = mutableListOf<String?>()
        var retries = 0
        var finished = false

        override suspend fun exchange(
            apdu: ByteArray,
            account: AccountRecord?,
        ): StepReply? {
            if (LedgerSigner.shownHash(apdu) == null) {
                return script[apdu.toList()]?.let { StepReply.Device(it) }
                    ?: StepReply.DeviceFailure(TransportFailure.OTHER)
            }
            hashes += apdu.toList()
            signers += account?.id
            return when {
                cancelAtHash -> null
                refuseFirst && hashes.size == 1 -> StepReply.Device(byteArrayOf(0x69, 0x85.toByte()))
                else -> StepReply.Device(script.getValue(hex(TRANSFER_HASH_REQUEST).toList()))
            }
        }

        override suspend fun refused(
            reason: String,
            account: AccountRecord?,
        ): Boolean {
            retries += 1
            return true
        }

        override fun finish() {
            finished = true
        }
    }

    private companion object {
        const val HEX = 16
        const val KEY0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
        const val TRANSFER_HASH_REQUEST =
            "5a02010020051899a4f58db1d9dd67bd2887ce37adfcbdd41c1163b49c345143e20184cdcd"
        const val TYPED_DATA =
            """{"typed_data":{"domain":{"chainId":"SN_MAIN","name":"Bramble Test","revision":"1",""" +
                """"version":"1"},"message":{"content":"hello"},"primaryType":"Mail","types":{"Mail":""" +
                """[{"name":"content","type":"felt"}],"StarknetDomain":[{"name":"name","type":"shortstring"},""" +
                """{"name":"version","type":"shortstring"},{"name":"chainId","type":"shortstring"},""" +
                """{"name":"revision","type":"shortstring"}]}}}"""

        fun hex(digits: String): ByteArray = digits.chunked(2).map { it.toInt(HEX).toByte() }.toByteArray()
    }
}
