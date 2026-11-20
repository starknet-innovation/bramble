package org.bramble.wallet

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.bramble.core.AccountFamily
import org.bramble.core.HttpOutcome
import org.bramble.core.RecoverySelection
import org.bramble.wallet.coordination.ChainPost
import org.bramble.wallet.portfolio.PortfolioTransport
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

/**
 * An offline JSON-RPC node for instrumented tests, the Android twin of the iOS Debug-only
 * `FixtureTransport`: it answers from the same generated public replies ([RpcFixtures], recorded
 * from the extension's own send path), echoing each request's id, so the core judges them exactly
 * as live answers. Every write is refused with a JSON-RPC error and counted, so a test can prove
 * what reached the node. Only the published wallet's primary account exists here, deployed or not
 * as [deployed] says, holding the `ready` balances when [funded]; [feeFailure] makes every fee
 * estimate fail. Test-only: never on the app's classpath.
 */
class FixtureNode(
    /** Whether the published primary account reports a class hash (deployed) or "not found". */
    @Volatile var deployed: Boolean,
    /** Whether the primary account holds the `ready` balances (else every balance is zero). */
    private val funded: Boolean = false,
    /** Whether `starknet_estimateFee` answers with an execution error (iOS `feeFailure`). */
    private val feeFailure: Boolean = false,
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
                "starknet_chainId" -> {
                    RpcFixtures.chainIds[url.toString()]?.let { JSONObject().put("result", it) } ?: JSONObject(REFUSED)
                }

                "starknet_estimateFee" -> {
                    if (feeFailure) JSONObject(RpcFixtures.ESTIMATE_FAILURE) else estimates(params)
                }

                "starknet_call" -> {
                    JSONObject().put("result", call(params.optJSONObject("request") ?: JSONObject()))
                }

                // Account and class reads; every write, and any read this node does not model, is
                // refused: nothing broadcasts.
                else -> {
                    accountRead(request.getString("method"), params)
                }
            }
        return answer.put("jsonrpc", "2.0").put("id", request.get("id")).toString()
    }

    /**
     * This node as the portfolio's HTTP transport: JSON-RPC posts to a bundled endpoint are
     * answered here; every other request (prices, explorers) goes unanswered, so nothing leaves
     * the device.
     */
    fun portfolioTransport(): PortfolioTransport =
        PortfolioTransport { request ->
            val body = request.body
            if (body == null || request.url !in RpcFixtures.chainIds) {
                HttpOutcome(0u, null, null, false)
            } else {
                HttpOutcome(200u, null, post(URL(request.url), body, write = false).toByteArray(), false)
            }
        }

    /** Class and nonce reads of the primary account, and the pinned multisig class (declared). */
    private fun accountRead(
        method: String,
        params: JSONObject,
    ): JSONObject {
        val primary = isPrimary(params)
        return when (method) {
            "starknet_getClassHashAt" -> {
                JSONObject(if (primary) RpcFixtures.DEPLOYED_CLASS_HASH else RpcFixtures.UNDEPLOYED_CLASS_HASH)
            }

            "starknet_getNonce" -> {
                JSONObject(if (primary) RpcFixtures.DEPLOYED_NONCE else RpcFixtures.UNDEPLOYED_NONCE)
            }

            // The pinned multisig class is declared (iOS `StubRpcTransport`).
            "starknet_getClass" -> {
                JSONObject().put("result", JSONObject())
            }

            else -> {
                JSONObject(REFUSED)
            }
        }
    }

    private fun isPrimary(params: JSONObject): Boolean =
        deployed && params.optString("contract_address") in RpcFixtures.primaryAccounts

    /** A known token's metadata (name, symbol, decimals as felts), or its `balanceOf` limbs. */
    private fun call(call: JSONObject): JSONArray {
        val metadata = METADATA[canonical(call.optString("contract_address"))]
        return when (call.optString("entry_point_selector")) {
            NAME_SELECTOR -> JSONArray(listOfNotNull(metadata?.get(0)))
            SYMBOL_SELECTOR -> JSONArray(listOfNotNull(metadata?.get(1)))
            DECIMALS_SELECTOR -> JSONArray(listOfNotNull(metadata?.get(2)))
            else -> JSONArray(balanceOf(call) ?: listOf("0x0", "0x0"))
        }
    }

    /** The holder's `ready` limbs for a token when [funded] and the holder is the primary account. */
    private fun balanceOf(call: JSONObject): List<String>? {
        val holder = call.optJSONArray("calldata")?.optString(0).orEmpty()
        val contract = canonical(call.optString("contract_address"))
        val held = funded && holder in RpcFixtures.primaryAccounts
        return if (held) RpcFixtures.readyBalances[contract] ?: EXTRA_BALANCES[contract] else null
    }

    private fun estimates(params: JSONObject): JSONObject {
        val transactions = params.optJSONArray("request") ?: JSONArray()
        val replies = JSONArray()
        for (index in 0 until transactions.length()) {
            val deploys = transactions.getJSONObject(index).optString("type") == "DEPLOY_ACCOUNT"
            replies.put(JSONObject(if (deploys) RpcFixtures.DEPLOY_ESTIMATE else RpcFixtures.INVOKE_ESTIMATE))
        }
        return JSONObject().put("result", replies)
    }

    companion object {
        /** The contract "Add by contract" reads in the tests: Test Token (TST), 18 decimals. */
        const val TEST_TOKEN = "0xabc"

        /** USDC on Starknet: a registry token the published account holds when funded. */
        const val USDC = "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb"

        // `name`, `symbol` and `decimals` entry-point selectors (iOS `PortfolioStubResponder`).
        private const val NAME_SELECTOR = "0x361458367e696363fbcc70777d07ebbd2394e89fd0adcaf147faccd1d294d60"
        private const val SYMBOL_SELECTOR = "0x216b05c387bab9ac31918a3e61672f4618601f3c598a2f3f2710f37053e1ea4"
        private const val DECIMALS_SELECTOR = "0x4c4fb1ab068f6039d5780c68dd0fa2f8742cceb3426d19667778ca7f3518a9"

        /** Balances beyond the generated `ready` set: 5 USDC, and 42 of the custom test token. */
        private val EXTRA_BALANCES =
            mapOf(
                USDC to listOf("0x4c4b40", "0x0"),
                canonical(TEST_TOKEN) to listOf("0x246ddf97976680000", "0x0"),
            )

        /** Name, symbol and decimals, short-string encoded: the test token and USDC. */
        private val METADATA =
            mapOf(
                canonical(TEST_TOKEN) to listOf("0x5465737420546f6b656e", "0x545354", "0x12"),
                USDC to listOf("0x55534420436f696e", "0x55534443", "0x6"),
            )

        private const val REFUSED = """{"error":{"code":-32601,"message":"The test fixture never broadcasts"}}"""

        /** Lowercase hex without leading zeros, the form the fixtures key by. */
        private fun canonical(felt: String): String =
            "0x" +
                felt
                    .removePrefix("0x")
                    .lowercase()
                    .trimStart('0')
                    .ifEmpty { "0" }
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
 * Routes the store's chain reads, the portfolio's JSON-RPC reads and the multisig chain reads
 * through [node], then imports the published wallet and opens its Bramble account at index 0, so
 * the deployment read on entry already uses the fixture. [portfolioTransport] adds answers the
 * node does not model (prices).
 */
fun openPublicWalletOn(
    node: FixtureNode,
    portfolioTransport: PortfolioTransport = node.portfolioTransport(),
) = onMainThread {
    rpc = RpcClient(node)
    portfolio.transport = portfolioTransport
    coordination.chainPost = ChainPost { url, body, _ -> node.post(url, body, write = false) }
    importWallet(PublicWallet.PHRASE, PublicWallet.PASSPHRASE)
    restoreRecoveredAccounts(listOf(RecoverySelection(AccountFamily.OPEN_ZEPPELIN, 0u, null)))
    finishOnboarding()
}
