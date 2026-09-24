package org.bramble.wallet.send

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcPurpose
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId
import org.bramble.wallet.RpcClient
import java.net.URL

/**
 * Relays one core `TransferPlan` over HTTPS, mirroring the iOS `SendDriver`. The plan decides
 * every step; this only picks the endpoint, sleeps for `Wait`, and hands replies back.
 *
 * Host guarantees (mobile/docs/transactions.md §3, "Endpoint binding"): the first endpoint that
 * proves the chain serves every later step of the plan, with no failover; a write is posted
 * exactly once, never retried, and never follows a redirect.
 * HTTP goes through [RpcClient.post], the app's one bounded, redirect-refusing-for-writes path.
 *
 * Uncompiled: this machine has no Android SDK; checked by reading against the generated bindings.
 */
class SendDriver(
    /** The core plan this relays; closed by the owner (`SendFlowModel`), never here. */
    val plan: TransferPlan,
    network: NetworkInfo,
) {
    private val urls = network.rpcUrls.map(::URL)
    private val networkId = network.network

    /** The endpoint bound for the rest of the plan once it proved the chain, or null before. */
    var endpoint: URL? = null
        private set

    /** How many signed writes were posted; once non-zero the endpoint is never released. */
    var writesSent = 0
        private set

    /** Advances from [reply] until the plan needs the user: Review, Broadcast, Finished, Failed. */
    suspend fun run(
        reply: StepReply,
        onStep: (SendStep) -> Unit = {},
    ): SendStep {
        var next = reply
        while (true) {
            val step = withContext(Dispatchers.Default) { plan.advance(next) }
            next =
                when (step) {
                    is SendStep.Rpc -> {
                        onStep(step)
                        exchange(step.id, step.body, step.purpose, step.isWrite)
                    }

                    is SendStep.Wait -> {
                        delay(step.delayMs.toLong())
                        StepReply.WaitElapsed
                    }

                    else -> {
                        return step
                    }
                }
        }
    }

    /** Lets a review retry probe the endpoints again; refused once a write has been sent. */
    fun releaseEndpoint() {
        if (writesSent == 0) endpoint = null
    }

    private fun now(): ULong = System.currentTimeMillis().toULong()

    private suspend fun exchange(
        id: ULong,
        body: String,
        purpose: RpcPurpose,
        write: Boolean,
    ): StepReply =
        withContext(Dispatchers.IO) {
            if (endpoint == null && purpose == RpcPurpose.CHAIN_ID && !write) {
                bind(id, body)
            } else {
                if (endpoint == null && !write) probe()
                endpoint?.let { url -> relay(url, id, body, write) } ?: StepReply.TransportFailure(id, now())
            }
        }

    /** Posts one step to the bound [url]; a [write] is counted before it is posted, and posted once. */
    private fun relay(
        url: URL,
        id: ULong,
        body: String,
        write: Boolean,
    ): StepReply {
        if (write) writesSent += 1
        return runCatching { post(url, body, write) }
            .map { StepReply.Rpc(id, it, now()) as StepReply }
            .getOrElse { StepReply.TransportFailure(id, now()) }
    }

    private fun probe() {
        endpoint =
            urls.firstOrNull { url ->
                runCatching {
                    rpcVerifyChainId(
                        post(url, rpcChainIdRequest(0u), false),
                        0u,
                        networkId,
                    )
                }.getOrDefault(false)
            }
    }

    private fun bind(
        id: ULong,
        body: String,
    ): StepReply {
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

    private fun post(
        url: URL,
        body: String,
        write: Boolean,
    ): String = RpcClient.post(url, body, write)
}
