package org.bramble.wallet.coordination

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.bramble.core.ClassDeclaredRead
import org.bramble.core.MultisigAuthorityRead
import org.bramble.core.MultisigAuthorityStatus
import org.bramble.core.NetworkInfo
import org.bramble.core.NostrSyncPlan
import org.bramble.core.RelayPolicy
import org.bramble.core.RelayStep
import org.bramble.wallet.RpcClient
import java.net.URL
import java.util.concurrent.TimeUnit

// The byte-moving half of [CoordinationStore]: chain reads through [RpcClient.post] and one OkHttp
// WebSocket per relay. The core plans every request, judges every response, and decides when a
// relay is finished; nothing here interprets a payload.

/** WebSocket close code 1000 (normal closure), sent once the core finishes a relay. */
private const val NORMAL_CLOSURE = 1000

/**
 * The Argent multisig authority at [address], asking each of [info]'s RPC endpoints until one is
 * reachable. The returned read carries the core's verdict; it never throws for a network failure.
 */
internal suspend fun readAuthority(
    address: String,
    info: NetworkInfo,
): MultisigAuthorityRead =
    withContext(Dispatchers.IO) {
        var last = MultisigAuthorityRead(info.network, address)
        for (url in info.rpcUrls) {
            val read = MultisigAuthorityRead(info.network, address)
            drive(URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
            last = read
            if (read.status() != MultisigAuthorityStatus.NETWORK_UNAVAILABLE) break
        }
        last
    }

/**
 * Whether the pinned Argent Multisig class is declared on this network, asking each RPC endpoint
 * in turn; null when no endpoint gave an answer. An extension so the store keeps to its state.
 */
suspend fun CoordinationStore.classDeclared(): Boolean? = withContext(Dispatchers.IO) { readClassDeclared(network()) }

/** Blocking: whether the pinned multisig class is declared, per the first endpoint that answers. */
internal fun readClassDeclared(info: NetworkInfo): Boolean? {
    for (url in info.rpcUrls) {
        val read = ClassDeclaredRead(info.network)
        drive(URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
        read.declared()?.let { return it }
    }
    return null
}

/** Posts each request the core plans until it has none; a transport failure is reported, not thrown. */
private fun drive(
    url: URL,
    next: () -> org.bramble.core.RpcRequest?,
    accept: (ULong, String) -> Unit,
    failed: (ULong) -> Unit,
) {
    while (true) {
        val request = next() ?: return
        // The app's one HTTP path, bounded by the core's limit for this request.
        val limit = request.maxResponseBytes.coerceAtMost(Int.MAX_VALUE.toULong()).toInt()
        runCatching {
            accept(
                request.id,
                RpcClient.post(url, request.body, maxBytes = limit),
            )
        }.onFailure { failed(request.id) }
    }
}

/** One wss socket per relay; the core decides when it is finished. Timeouts end the relay. */
internal suspend fun runRelay(
    plan: NostrSyncPlan,
    relay: UInt,
    url: String,
    policy: RelayPolicy,
) {
    if (!url.startsWith("wss://", ignoreCase = true)) return plan.relayEnded(relay)
    val done = CompletableDeferred<Unit>()
    val client =
        OkHttpClient
            .Builder()
            .connectTimeout(policy.connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    val socket =
        client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(
                    webSocket: WebSocket,
                    response: Response,
                ) {
                    webSocket.send(plan.openFrame(relay))
                }

                override fun onMessage(
                    webSocket: WebSocket,
                    text: String,
                ) {
                    val step = plan.acceptFrame(relay, text)
                    if (step is RelayStep.Finish) {
                        step.closeFrame?.let(webSocket::send)
                        webSocket.close(NORMAL_CLOSURE, null)
                        done.complete(Unit)
                    }
                }

                override fun onClosed(
                    webSocket: WebSocket,
                    code: Int,
                    reason: String,
                ) {
                    plan.relayEnded(relay)
                    done.complete(Unit)
                }

                override fun onFailure(
                    webSocket: WebSocket,
                    t: Throwable,
                    response: Response?,
                ) {
                    plan.relayEnded(relay)
                    done.complete(Unit)
                }
            },
        )
    val total = policy.connectTimeoutMs.toLong() + policy.requestTimeoutMs.toLong()
    try {
        if (withTimeoutOrNull(total) { done.await() } == null) plan.relayEnded(relay)
    } finally {
        socket.cancel()
        client.dispatcher.executorService.shutdown()
    }
}
