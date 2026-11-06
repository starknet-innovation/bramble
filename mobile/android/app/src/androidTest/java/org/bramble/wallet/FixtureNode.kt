package org.bramble.wallet

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.bramble.core.AccountFamily
import org.bramble.core.RecoverySelection
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/**
 * An offline JSON-RPC node for instrumented tests, the Android twin of the iOS Debug-only
 * `FixtureTransport`: it answers from the same public replies (`RpcFixtures.generated.swift`,
 * recorded from the extension's own send path), echoing each request's id, so the core judges them
 * exactly as live answers. Every write is refused with a JSON-RPC error and counted, so a test can
 * prove what reached the node. Only the published wallet's primary account exists here, deployed
 * or not as [deployed] says. Test-only: never on the app's classpath.
 */
class FixtureNode(
    /** Whether the published primary account reports a class hash (deployed) or "not found". */
    @Volatile var deployed: Boolean,
) : RpcPost {
    /** Signed writes this node received (always refused). */
    val writes = AtomicInteger(0)

    override fun post(
        url: URL,
        body: String,
        write: Boolean,
    ): String {
        if (write) writes.incrementAndGet()
        val request = JSONObject(body)
        val params = request.optJSONObject("params") ?: JSONObject()
        val answer =
            when (request.getString("method")) {
                "starknet_chainId" -> JSONObject().put("result", if ("sepolia" in url.toString()) SEPOLIA else MAINNET)

                "starknet_getClassHashAt" -> JSONObject(if (isPrimary(params)) DEPLOYED_CLASS else NOT_FOUND)

                "starknet_getNonce" -> JSONObject(if (isPrimary(params)) DEPLOYED_NONCE else NOT_FOUND)

                "starknet_estimateFee" -> estimates(params)

                "starknet_call" -> JSONObject().put("result", JSONArray(listOf("0x0", "0x0")))

                // Every write, and any read this node does not model, is refused: nothing broadcasts.
                else -> JSONObject(REFUSED)
            }
        return answer.put("jsonrpc", "2.0").put("id", request.get("id")).toString()
    }

    private fun isPrimary(params: JSONObject): Boolean =
        deployed && params.optString("contract_address") == PublicWallet.ADDRESS

    private fun estimates(params: JSONObject): JSONObject {
        val transactions = params.optJSONArray("request") ?: JSONArray()
        val replies = JSONArray()
        for (index in 0 until transactions.length()) {
            val deploys = transactions.getJSONObject(index).optString("type") == "DEPLOY_ACCOUNT"
            replies.put(JSONObject(if (deploys) DEPLOY_ESTIMATE else INVOKE_ESTIMATE))
        }
        return JSONObject().put("result", replies)
    }

    private companion object {
        const val MAINNET = "0x534e5f4d41494e"
        const val SEPOLIA = "0x534e5f5345504f4c4941"
        const val DEPLOYED_CLASS = """{"result":"0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"}"""
        const val DEPLOYED_NONCE = """{"result":"0x5"}"""
        const val NOT_FOUND = """{"error":{"code":20,"message":"Contract not found"}}"""
        const val INVOKE_ESTIMATE =
            """{"l1_data_gas_consumed":"0x180","l1_data_gas_price":"0x5a0","l1_gas_consumed":"0x0",""" +
                """"l1_gas_price":"0x2d5c6b1e1ef","l2_gas_consumed":"0x1234a0","l2_gas_price":"0xb2d05e00",""" +
                """"overall_fee":"0x1bb0f4d6c0000","unit":"FRI"}"""
        const val DEPLOY_ESTIMATE =
            """{"l1_data_gas_consumed":"0x1e0","l1_data_gas_price":"0x5a0","l1_gas_consumed":"0x0",""" +
                """"l1_gas_price":"0x2d5c6b1e1ef","l2_gas_consumed":"0xf4240","l2_gas_price":"0xb2d05e00",""" +
                """"overall_fee":"0xabc","unit":"FRI"}"""
        const val REFUSED = """{"error":{"code":-32601,"message":"The test fixture never broadcasts"}}"""
    }
}

/** The process-wide store, which exists before any activity starts. */
val appStore: WalletStore
    get() =
        (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BrambleApplication).store

/** Runs [block] on the main thread, where the store lives. */
fun <T> onMainThread(block: suspend WalletStore.() -> T): T =
    runBlocking { withContext(Dispatchers.Main) { appStore.block() } }

/**
 * Routes the store's chain reads through [node], then imports the published wallet and opens its
 * Bramble account at index 0, so the deployment read on entry already uses the fixture.
 */
fun openPublicWalletOn(node: FixtureNode) =
    onMainThread {
        rpc = RpcClient(node)
        importWallet(PublicWallet.PHRASE, PublicWallet.PASSPHRASE)
        restoreRecoveredAccounts(listOf(RecoverySelection(AccountFamily.OPEN_ZEPPELIN, 0u, null)))
        finishOnboarding()
    }
