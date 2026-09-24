package org.bramble.wallet

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.rpcBalanceRequest
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcParseBalance
import org.bramble.core.rpcVerifyChainId

/**
 * Moves JSON-RPC bytes for the Rust core, which builds every request and judges every response.
 * HTTPS only (the manifest also forbids cleartext); an endpoint is trusted only after it proves
 * it serves the expected chain, and failures fall through to the next bundled endpoint. A response
 * body is read up to [MAX_RESPONSE_BYTES] and refused beyond it, so a hostile endpoint cannot make
 * the app buffer an unbounded body before the core judges it.
 */
class RpcClient {
    suspend fun balances(account: String, network: NetworkInfo): Map<String, String> = withContext(Dispatchers.IO) {
        for (url in network.rpcUrls) {
            runCatching { return@withContext balancesAt(URL(url), account, network) }
        }
        error("no endpoint reachable")
    }

    private fun balancesAt(url: URL, account: String, network: NetworkInfo): Map<String, String> {
        check(rpcVerifyChainId(post(url, rpcChainIdRequest(1u)), 1u, network.network)) { "wrong chain" }
        return network.tokens.mapIndexed { offset, token ->
            val id = (offset + 2).toULong()
            token.symbol to rpcParseBalance(post(url, rpcBalanceRequest(id, token.address, account)), id)
        }.toMap()
    }

    private fun post(url: URL, body: String): String {
        val connection = url.openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.useCaches = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            check(connection.responseCode == 200) { "http ${connection.responseCode}" }
            return connection.inputStream.use { readBounded(it, MAX_RESPONSE_BYTES) }
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** 64 KiB: far above any balance or chain-id answer, far below a memory problem. */
        const val MAX_RESPONSE_BYTES = 64 * 1024

        /** Reads at most [max] bytes as UTF-8; throws once the stream has more. */
        fun readBounded(input: InputStream, max: Int): String {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8 * 1024)
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
