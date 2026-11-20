package org.bramble.wallet.privacy

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.PrivacyPurpose
import org.bramble.core.PrivacyReadPlan
import org.bramble.core.PrivacyReply
import org.bramble.core.PrivacyStep
import org.bramble.core.maxPrivacyResponseBytes
import org.bramble.core.maxRpcResponseBytes
import org.bramble.core.rpcVerifyChainId
import java.net.URL
import javax.net.ssl.HttpsURLConnection

private const val CONNECT_TIMEOUT_MS = 15_000

/** The discovery `Post` waits longer for its answer than an RPC read. */
private const val POST_READ_TIMEOUT_MS = 60_000

private const val RPC_READ_TIMEOUT_MS = 15_000

/** Statuses whose body is read from the input stream; any other is read from the error stream. */
private val HTTP_SUCCESS = 200..299

private const val READ_CHUNK_BYTES = 8 * 1024

/**
 * Relays one core `PrivacyReadPlan`, mirroring the iOS `PrivacyDriver`. The plan decides every
 * step; this only picks the RPC endpoint (the first that proves the chain), sleeps for `Wait`, and
 * hands replies back with the host clock. A `Post` body carries the viewing key (the one place it
 * crosses FFI; docs/privacy.md §1.1): it is written once to the configured HTTPS URL, never read,
 * logged or kept, no redirect is followed, and the array is zeroed as soon as the exchange ends.
 * The zeroing is best effort: the TLS stack may hold copies Kotlin cannot reach.
 */
class PrivacyDriver(
    private val plan: PrivacyReadPlan,
    network: NetworkInfo,
) {
    private val urls = network.rpcUrls.map(::URL)
    private val networkId = network.network
    private var endpoint: URL? = null

    private fun now(): ULong = System.currentTimeMillis().toULong()

    /** Runs the plan to `Finished` or `Failed`; cancelling the coroutine closes the plan. */
    suspend fun run(): PrivacyStep {
        var reply: PrivacyReply = PrivacyReply.Start(now())
        try {
            while (true) {
                kotlin.coroutines.coroutineContext.ensureActive()
                val step = withContext(Dispatchers.Default) { plan.advance(reply) }
                reply =
                    when (step) {
                        is PrivacyStep.Post -> {
                            withContext(Dispatchers.IO) { post(step.id, step.url, step.body) }
                        }

                        is PrivacyStep.Rpc -> {
                            withContext(Dispatchers.IO) { rpc(step.id, step.body, step.purpose) }
                        }

                        is PrivacyStep.Wait -> {
                            delay(step.delayMs.toLong())
                            PrivacyReply.WaitElapsed(now())
                        }

                        else -> {
                            return step
                        }
                    }
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            plan.cancel()
            throw cancelled
        }
    }

    private fun post(
        id: ULong,
        url: String,
        body: ByteArray,
    ): PrivacyReply =
        try {
            send(id, url, body)
        } finally {
            body.fill(0)
        }

    private fun send(
        id: ULong,
        url: String,
        body: ByteArray,
    ): PrivacyReply =
        runCatching {
            val target = URL(url)
            check(target.protocol == "https") { "https only" }
            val connection = target.openConnection() as HttpsURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = POST_READ_TIMEOUT_MS
                connection.useCaches = false
                connection.instanceFollowRedirects = false
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body) }
                val status = connection.responseCode
                val stream = if (status in HTTP_SUCCESS) connection.inputStream else connection.errorStream
                PrivacyReply.Http(
                    id,
                    status.toUShort(),
                    stream?.use { bounded(it, maxPrivacyResponseBytes().toInt()) } ?: ByteArray(0),
                    now(),
                )
            } finally {
                connection.disconnect()
            }
        }.getOrElse { PrivacyReply.TransportFailure(id, now()) }

    private fun rpc(
        id: ULong,
        body: String,
        purpose: PrivacyPurpose,
    ): PrivacyReply =
        if (endpoint == null && purpose == PrivacyPurpose.CHAIN_ID) {
            proveEndpoint(id, body)
        } else {
            relay(id, body)
        }

    /** The chain-id call: the first endpoint whose answer the core verifies becomes the endpoint. */
    private fun proveEndpoint(
        id: ULong,
        body: String,
    ): PrivacyReply {
        for (url in urls) {
            val text = runCatching { rpcPost(url, body) }.getOrNull() ?: continue
            if (runCatching { rpcVerifyChainId(text, id, networkId) }.getOrDefault(false)) {
                endpoint = url
                return PrivacyReply.Rpc(id, text, now())
            }
        }
        return PrivacyReply.TransportFailure(id, now())
    }

    /** Any other call goes to the proven endpoint; without one it is a transport failure. */
    private fun relay(
        id: ULong,
        body: String,
    ): PrivacyReply {
        val url = endpoint ?: return PrivacyReply.TransportFailure(id, now())
        return runCatching { PrivacyReply.Rpc(id, rpcPost(url, body), now()) as PrivacyReply }
            .getOrElse { PrivacyReply.TransportFailure(id, now()) }
    }

    private fun rpcPost(
        url: URL,
        body: String,
    ): String {
        val connection = url.openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = RPC_READ_TIMEOUT_MS
            connection.useCaches = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            check(connection.responseCode == HttpsURLConnection.HTTP_OK) { "http ${connection.responseCode}" }
            return connection.inputStream.use { bounded(it, maxRpcResponseBytes().toInt()) }.decodeToString()
        } finally {
            connection.disconnect()
        }
    }

    /** Reads at most [limit] bytes; a longer reply is a transport failure. */
    private fun bounded(
        input: java.io.InputStream,
        limit: Int,
    ): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(READ_CHUNK_BYTES)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            check(out.size() + read <= limit) { "reply too large" }
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
