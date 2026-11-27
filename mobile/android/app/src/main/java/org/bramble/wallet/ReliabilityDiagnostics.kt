package org.bramble.wallet

import org.bramble.core.HttpOutcome
import org.bramble.core.NetworkId
import java.net.URL

/**
 * Reliability diagnostics, as the extension's `rpc-diagnostics.ts` and `support/diagnostics.ts`
 * and iOS `ReliabilityDiagnostics`: while on, in-memory counters of RPC and Starkscan outcomes by
 * fixed label (endpoint class, outcome) with an average latency. Nothing is sent: the person
 * exports the report themselves. Turning it off clears every counter. No URL, address, amount,
 * key, phrase, note, contact or error text is ever kept; a row is fixed labels and numbers only.
 * The preference itself is persisted by [WalletStore].
 */
object ReliabilityDiagnostics {
    /** The remembered choice, in the app's preferences. */
    const val ENABLED_KEY = "bramble:reliability-diagnostics"

    /** One aggregate row, keyed by fixed labels only. */
    data class Row(
        /** Exchanges counted. */
        val count: Int,
        /** Their average duration, rounded to the millisecond. */
        val latencyMs: Long,
    )

    private const val HTTP_OK = 200
    private const val MAX_VERSION = 32
    private const val HTTP_TOO_MANY = 429
    private val HTTP_SUCCESS = 200..299

    private val rpc = sortedMapOf<String, Row>()
    private val explorer = sortedMapOf<String, Row>()

    /** Off by default; turning it off clears the counters at once. */
    @Volatile
    var enabled = false
        @Synchronized set(value) {
            field = value
            if (!value) {
                rpc.clear()
                explorer.clear()
            }
        }

    /** `rpcEndpointClass`: the class of [url]'s host, never the host itself. */
    fun endpointClass(url: URL): String =
        when {
            url.host == GatewayAnalytics.HOST -> "wallet-gateway"
            url.host.endsWith(".nodes.starknet.org") || url.host == "api.cartridge.gg" -> "foundation"
            else -> "custom"
        }

    /** Records one JSON-RPC exchange to [url] from its HTTP [status] (0: no answer). */
    fun recordRpc(
        url: URL,
        status: Int,
        timedOut: Boolean,
        elapsedMs: Long,
    ) {
        val outcome =
            when {
                timedOut -> "timeout"
                status == HTTP_TOO_MANY -> "rate-limited"
                status == HTTP_OK -> "ok"
                else -> "transport-error"
            }
        record(rpc, "${endpointClass(url)}:$outcome", elapsedMs)
    }

    /** Records one JSON-RPC exchange through the core's bounded transport. */
    fun recordRpc(
        url: URL,
        outcome: HttpOutcome,
        elapsedMs: Long,
    ) = recordRpc(url, if (outcome.body == null) 0 else outcome.status.toInt(), outcome.timedOut, elapsedMs)

    /** Records one Starkscan read; [applied] is whether the core accepted its answer. */
    fun recordExplorer(
        outcome: HttpOutcome,
        applied: Boolean,
        elapsedMs: Long,
    ) {
        val status = outcome.status.toInt()
        val label =
            when {
                outcome.timedOut -> "timeout"
                status == 0 -> "transport-error"
                status == HTTP_TOO_MANY -> "rate-limited"
                status !in HTTP_SUCCESS -> "http-error"
                applied -> "ok"
                else -> "invalid-response"
            }
        record(explorer, label, elapsedMs)
    }

    /**
     * The export: the extension's report shape, limited to what mobile counts, keys sorted. Written
     * by hand because every value is a fixed label or a number (and `org.json` is a stub in JVM
     * tests); nothing here can carry a quote or a control character.
     */
    @Synchronized
    fun report(
        accountCount: Int,
        network: NetworkId,
        version: String,
    ): String {
        val rpcRows =
            rpc.map { (key, row) ->
                val (endpoint, outcome) = key.split(":")
                """{"count":${row.count},"endpoint":"$endpoint","latencyMs":${row.latencyMs},"outcome":"$outcome"}"""
            }
        val explorerRows =
            explorer.map { (outcome, row) ->
                """{"count":${row.count},"latencyMs":${row.latencyMs},"outcome":"$outcome","service":"starkscan"}"""
            }
        val networkId = if (network == NetworkId.MAINNET) "SN_MAIN" else "SN_SEPOLIA"
        val safeVersion = version.filter { it.isLetterOrDigit() || it in ".+-" }.take(MAX_VERSION)
        return """{"build":{"platform":"android","version":"$safeVersion"},""" +
            """"diagnostics":{"accountCount":$accountCount,"collectionEnabled":$enabled,""" +
            """"explorer":[${explorerRows.joinToString(",")}],"networkId":"$networkId",""" +
            """"rpc":[${rpcRows.joinToString(",")}]}}"""
    }

    @Synchronized
    private fun record(
        table: MutableMap<String, Row>,
        key: String,
        elapsedMs: Long,
    ) {
        if (!enabled) return
        val previous = table[key] ?: Row(0, 0)
        val count = previous.count + 1
        table[key] = Row(count, Math.round((previous.latencyMs * (count - 1) + elapsedMs).toDouble() / count))
    }
}
