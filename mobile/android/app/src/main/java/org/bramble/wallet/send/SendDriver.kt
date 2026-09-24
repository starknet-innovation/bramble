package org.bramble.wallet.send

import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcPurpose
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.maxRpcResponseBytes
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId

/**
 * Relays one core `TransferPlan` over HTTPS, mirroring the iOS `SendDriver`. The plan decides
 * every step; this only picks the endpoint, sleeps for `Wait`, and hands replies back.
 *
 * Host guarantees (mobile/docs/transactions.md §3, "Endpoint binding"): the first endpoint that
 * proves the chain serves every later step of the plan, with no failover; a write is posted
 * exactly once, never retried, and never follows a redirect.
 *
 * Uncompiled: this machine has no Android SDK; written against the generated Kotlin bindings.
 */
class SendDriver(val plan: TransferPlan, network: NetworkInfo) {
    private val urls = network.rpcUrls.map(::URL)
    private val networkId = network.network
    var endpoint: URL? = null
        private set
    var writesSent = 0
        private set

    /** Advances from [reply] until the plan needs the user: Review, Broadcast, Finished, Failed. */
    suspend fun run(reply: StepReply, onStep: (SendStep) -> Unit = {}): SendStep {
        var next = reply
        while (true) {
            val step = withContext(Dispatchers.Default) { plan.advance(next) }
            next = when (step) {
                is SendStep.Rpc -> {
                    onStep(step)
                    exchange(step.id, step.body, step.purpose, step.isWrite)
                }
                is SendStep.Wait -> {
                    delay(step.delayMs.toLong())
                    StepReply.WaitElapsed
                }
                else -> return step
            }
        }
    }

    /** Lets a review retry probe the endpoints again; refused once a write has been sent. */
    fun releaseEndpoint() {
        if (writesSent == 0) endpoint = null
    }

    private fun now(): ULong = System.currentTimeMillis().toULong()

    private suspend fun exchange(id: ULong, body: String, purpose: RpcPurpose, write: Boolean): StepReply =
        withContext(Dispatchers.IO) {
            if (endpoint == null && purpose == RpcPurpose.CHAIN_ID && !write) return@withContext bind(id, body)
            if (endpoint == null && !write) probe()
            val url = endpoint ?: return@withContext StepReply.TransportFailure(id, now())
            if (write) writesSent += 1
            runCatching { post(url, body, write) }
                .map { StepReply.Rpc(id, it, now()) as StepReply }
                .getOrElse { StepReply.TransportFailure(id, now()) }
        }

    private fun probe() {
        endpoint = urls.firstOrNull { url ->
            runCatching { rpcVerifyChainId(post(url, rpcChainIdRequest(0u), false), 0u, networkId) }.getOrDefault(false)
        }
    }

    private fun bind(id: ULong, body: String): StepReply {
        var mismatch: String? = null
        for (url in urls) {
            val text = runCatching { post(url, body, false) }.getOrNull() ?: continue
            if (runCatching { rpcVerifyChainId(text, id, networkId) }.getOrDefault(false)) {
                endpoint = url
                return StepReply.Rpc(id, text, now())
            }
            if (mismatch == null) mismatch = text
        }
        return mismatch?.let { StepReply.Rpc(id, it, now()) } ?: StepReply.TransportFailure(id, now())
    }

    private fun post(url: URL, body: String, write: Boolean): String {
        val connection = url.openConnection() as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.useCaches = false
            // A redirected write would reach an endpoint that never proved its chain.
            connection.instanceFollowRedirects = !write
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            check(connection.responseCode == 200) { "http ${connection.responseCode}" }
            // Read at most the core's parse limit; a longer reply is a transport failure, so an
            // untrusted endpoint cannot make the app buffer an unbounded body.
            val limit = maxRpcResponseBytes().toInt()
            check(connection.contentLengthLong <= limit) { "reply too large" }
            return connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    check(out.size() + read <= limit) { "reply too large" }
                    out.write(buffer, 0, read)
                }
                out.toByteArray().decodeToString()
            }
        } finally {
            connection.disconnect()
        }
    }
}
