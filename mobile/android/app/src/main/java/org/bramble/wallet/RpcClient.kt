package org.bramble.wallet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.rpcBalanceRequest
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcParseBalance
import org.bramble.core.rpcVerifyChainId
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Moves JSON-RPC bytes for the Rust core, which builds every request and judges every response.
 * HTTPS only (the manifest also forbids cleartext); an endpoint is trusted only after it proves
 * it serves the expected chain, and failures fall through to the next bundled endpoint. A response
 * body is read up to [MAX_RESPONSE_BYTES] and refused beyond it, so a hostile endpoint cannot make
 * the app buffer an unbounded body before the core judges it. [post] is the one HTTP path: the
 * send driver (`send/SendDriver.kt`) moves every plan step through it too.
 */
class RpcClient {
    /**
     * Base-unit balances of [network]'s tokens for [account], by symbol, from the first bundled
     * endpoint that proves the chain and answers every read. Throws when no endpoint does.
     */
    suspend fun balances(
        account: String,
        network: NetworkInfo,
    ): Map<String, String> =
        withContext(Dispatchers.IO) {
            network.rpcUrls.firstNotNullOfOrNull { url ->
                runCatching { balancesAt(URL(url), account, network) }.getOrNull()
            } ?: error("no endpoint reachable")
        }

    private fun balancesAt(
        url: URL,
        account: String,
        network: NetworkInfo,
    ): Map<String, String> {
        check(rpcVerifyChainId(post(url, rpcChainIdRequest(1u)), 1u, network.network)) { "wrong chain" }
        return network.tokens
            .mapIndexed { offset, token ->
                val id = (offset + 2).toULong()
                token.symbol to rpcParseBalance(post(url, rpcBalanceRequest(id, token.address, account)), id)
            }.toMap()
    }

    /** The one bounded HTTPS path every JSON-RPC byte in the app goes through. */
    companion object {
        /** 64 KiB, the core's `MAX_RESPONSE_BYTES` (`maxRpcResponseBytes()`): far above any reply. */
        const val MAX_RESPONSE_BYTES = 64 * 1024
        private const val TIMEOUT_MS = 15_000
        private const val READ_CHUNK_BYTES = 8 * 1024

        /**
         * POSTs one JSON-RPC [body] and returns the reply, bounded to [maxBytes] (the core's
         * `RpcRequest.maxResponseBytes` for a sans-IO read; [MAX_RESPONSE_BYTES] otherwise). Throws
         * on any transport failure or non-200 status. A [write] (a signed transaction) is posted
         * once and never follows a redirect, which would hand it to an endpoint that never proved
         * its chain; retrying is the caller's (the core plan's) decision, never this function's.
         */
        fun post(
            url: URL,
            body: String,
            write: Boolean = false,
            maxBytes: Int = MAX_RESPONSE_BYTES,
        ): String {
            val connection = url.openConnection() as HttpsURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.useCaches = false
                connection.instanceFollowRedirects = !write
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
                check(connection.responseCode == HttpURLConnection.HTTP_OK) { "http ${connection.responseCode}" }
                check(connection.contentLengthLong <= maxBytes) { "reply too large" }
                return connection.inputStream.use { readBounded(it, maxBytes) }
            } finally {
                connection.disconnect()
            }
        }

        /** Reads at most [max] bytes as UTF-8; throws once the stream has more. */
        fun readBounded(
            input: InputStream,
            max: Int,
        ): String {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(READ_CHUNK_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (out.size() + read > max) throw IOException("response larger than $max bytes")
                out.write(buffer, 0, read)
            }
            return out.toByteArray().decodeToString()
        }
    }
}
