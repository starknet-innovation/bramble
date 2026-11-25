package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.ArgentMultisigConfig
import org.bramble.core.IntentState
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigProposalRequest
import org.bramble.core.MultisigStateRead
import org.bramble.core.MultisigTxFailure
import org.bramble.core.MultisigTxStep
import org.bramble.core.NetworkId
import org.bramble.core.RecoverySelection
import org.bramble.core.StaleReason
import org.bramble.core.TokenPreferences
import org.bramble.core.WalletCore
import org.bramble.core.argentSignerGuid
import org.bramble.core.supportedNetworks
import org.bramble.wallet.coordination.ChainPost
import org.bramble.wallet.coordination.IntentAction
import org.bramble.wallet.coordination.MultisigTxText
import org.bramble.wallet.coordination.readAuthority
import org.bramble.wallet.coordination.readState
import org.bramble.wallet.coordination.runPlan
import org.bramble.wallet.security.DeviceClock
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URL
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * Multisig transactions (M18) through the app's byte-moving code ([readAuthority], [readState],
 * [runPlan] over `RpcEndpoint`), port of the iOS `MultisigTransactionsTests`: a fake node answers
 * from the extension's recorded proposal (`extension-multisig-transactions.json`), and the
 * proposal, both co-signatures and the submission must come out as the extension's bytes. The core
 * signs; the one write goes to the fake node and nothing reaches a network.
 */
@RunWith(AndroidJUnit4::class)
class MultisigTransactionsTest {
    private lateinit var net: JSONObject
    private lateinit var core: WalletCore
    private lateinit var node: MultisigNode
    private val network = supportedNetworks().first { it.network == NetworkId.SEPOLIA }

    private val account get() = net.getJSONObject("account")
    private val proposal get() = net.getJSONObject("proposal")
    private val multisigId get() = account.getString("id")
    private val address get() = account.getString("address")

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation()
        val text =
            context.context.assets
                .open(
                    "extension-multisig-transactions.json",
                ).bufferedReader()
                .use { it.readText() }
        val fixture = JSONObject(text)
        val networks = fixture.getJSONArray("networks")
        net =
            (0 until networks.length()).map(networks::getJSONObject).first { it.getString("networkId") == "SN_SEPOLIA" }
        val dir = File(context.targetContext.cacheDir, UUID.randomUUID().toString())
        core = WalletCore(dir.absolutePath, DeviceClock(context.targetContext.contentResolver))
        core.importWallet("parity password", fixture.getString("mnemonic"))
        core.restoreRecoveredAccounts(
            NetworkId.SEPOLIA,
            (0u..3u).map { RecoverySelection(AccountFamily.OPEN_ZEPPELIN, it, null) },
        )
        val deploy = net.getJSONObject("deploy")
        val input = deploy.getJSONObject("input")
        core.saveMultisigSetup(
            NetworkId.SEPOLIA,
            null,
            ArgentMultisigConfig(input.getInt("threshold").toUInt(), strings(input.getJSONArray("signerPublicKeys"))),
            input.getString("salt"),
            signer(deploy.getInt("deployerAccountIndex")),
        )
        node = MultisigNode(account, proposal)
    }

    private fun strings(array: JSONArray) = (0 until array.length()).map(array::getString)

    private fun signer(index: Int): String {
        val signers = net.getJSONArray("signers")
        val key = (0 until signers.length()).map(signers::getJSONObject).first { it.getInt("accountIndex") == index }
        return core.accountRecords(NetworkId.SEPOLIA).first { it.publicKey == key.getString("publicKey") }.id
    }

    private fun digits(felt: String) = felt.lowercase().removePrefix("0x").trimStart('0')

    /** The fixture's one STRK transfer, as the composer sends it. */
    private fun transfer(): MultisigProposalRequest {
        val call = proposal.getJSONArray("calls").getJSONObject(0)
        val calldata = strings(call.getJSONArray("calldata"))
        val low = calldata[1].removePrefix("0x").toBigInteger(16)
        val amount =
            low
                .toBigDecimal()
                .movePointLeft(18)
                .stripTrailingZeros()
                .toPlainString()
        val token =
            TokenPreferences(null).tracked(NetworkId.SEPOLIA).first {
                digits(it.token.address) == digits(call.getString("contractAddress"))
            }
        return MultisigProposalRequest.Transfer(token.token.id, calldata[0], amount)
    }

    private suspend fun propose(confirmResend: Boolean = false): MultisigTxStep {
        val read = readAuthority(address, network, node)
        val plan = core.proposeMultisigTransaction(read, transfer(), TokenPreferences(null), confirmResend)
        return runPlan(network, node) { plan.advance(it) }
    }

    private suspend fun intentRead(id: String): MultisigStateRead =
        readState(network, node) { core.multisigIntentRead(id, NOW_MS) }

    private fun stored(id: String): MultisigIntent = core.multisigIntents(multisigId).first { it.id == id }

    @Test
    fun proposeCosignSubmit() =
        runBlocking {
            val step = propose() as MultisigTxStep.Proposed
            var intent = stored(step.intentId)
            assertEquals(proposal.getString("proposalPackage"), intent.`package`)
            val cosigners = proposal.getJSONArray("cosignerAccountIndexes")
            for (i in 0 until cosigners.length()) {
                intent = core.signMultisigIntent(intent.id, signer(cosigners.getInt(i)), intentRead(intent.id))
            }
            assertEquals(IntentState.READY, intent.state)
            assertEquals(proposal.getString("readyPackage"), intent.`package`)
            assertEquals(IntentAction.SUBMIT, MultisigTxText.action(intent, false, true).first)
            val submission = core.submitMultisigIntent(intent.id, intentRead(intent.id))
            val sent = runPlan(network, node) { submission.advance(it) }
            assertEquals(MultisigTxStep.Submitted(proposal.getString("transactionHash")), sent)
            assertEquals("the threshold signature is posted exactly once", 1, node.writes.get())
            assertEquals(IntentState.SUBMITTED, stored(intent.id).state)
        }

    /** The nonce moved past a collecting intent: it goes stale, and a resend needs "Send anyway". */
    @Test
    fun staleAndResendGuards() =
        runBlocking {
            val id = (propose() as MultisigTxStep.Proposed).intentId
            node.nonce = "0x6"
            val read = intentRead(id)
            assertThrows(Exception::class.java) { core.signMultisigIntent(id, signer(1), read) }
            assertEquals(StaleReason.NONCE, stored(id).staleReason)
            assertEquals(IntentAction.NONE, MultisigTxText.action(stored(id), true, true).first)
            assertEquals(MultisigTxStep.Failed(MultisigTxFailure.RESEND_UNCONFIRMED), propose())
            assertEquals(MultisigTxStep.Proposed::class, propose(confirmResend = true)::class)
            assertEquals("proposing never writes", 0, node.writes.get())
        }

    private companion object {
        const val NOW_MS: ULong = 1_790_000_000_000u
    }
}

/**
 * A fake node for one multisig: its authority, the recorded nonce and fee estimate, no known
 * transaction hashes, and the recorded acceptance of the one write, which it counts.
 */
private class MultisigNode(
    account: JSONObject,
    proposal: JSONObject,
) : ChainPost,
    RpcPost {
    private val classHash = account.getString("classHash")
    private val config = account.getJSONObject("currentConfig")
    private val guids =
        config.getJSONArray("signerPublicKeys").let { keys ->
            (0 until keys.length()).map { argentSignerGuid(keys.getString(it)) }
        }
    private val estimate = recorded(proposal, "prepare", "starknet_estimateFee")
    private val accepted = recorded(proposal, "submit", "starknet_addInvokeTransaction")

    @Volatile var nonce = "0x5"
    val writes = AtomicInteger()

    private fun recorded(
        proposal: JSONObject,
        phase: String,
        method: String,
    ): Any {
        val lines = proposal.getJSONArray(phase)
        return (0 until lines.length())
            .map { JSONObject(lines.getString(it)) }
            .first { it.getString("method") == method }
            .getJSONObject("reply")
            .get("result")
    }

    override fun post(
        url: URL,
        body: String,
        maxBytes: Int,
    ): String = post(url, body, false)

    override fun post(
        url: URL,
        body: String,
        write: Boolean,
    ): String {
        val request = JSONObject(body)
        val id = request.getLong("id")
        val selector =
            request.optJSONObject("params")?.optJSONObject("request")?.optString("entry_point_selector") ?: ""
        val result: Any =
            when (request.getString("method")) {
                "starknet_chainId" -> "0x534e5f5345504f4c4941"
                "starknet_blockHashAndNumber" -> JSONObject(mapOf("block_hash" to "0x1", "block_number" to 1))
                "starknet_getClassHashAt" -> classHash
                "starknet_call" -> callResult(selector)
                "starknet_getNonce" -> nonce
                "starknet_estimateFee" -> estimate
                "starknet_addInvokeTransaction" -> accepted.also { check(write) }.also { writes.incrementAndGet() }
                else -> return """{"jsonrpc":"2.0","id":$id,"error":$NOT_FOUND}"""
            }
        return JSONObject(mapOf("jsonrpc" to "2.0", "id" to id, "result" to result)).toString()
    }

    private fun callResult(selector: String): JSONArray =
        if (selector.startsWith("0x1753")) {
            JSONArray(listOf("0x" + config.getInt("threshold").toString(16)))
        } else {
            JSONArray(listOf("0x" + guids.size.toString(16)) + guids)
        }

    private companion object {
        /** `TXN_HASH_NOT_FOUND`, the answer to every hash lookup. */
        const val NOT_FOUND = """{"code":29,"message":"Transaction hash not found"}"""
    }
}
