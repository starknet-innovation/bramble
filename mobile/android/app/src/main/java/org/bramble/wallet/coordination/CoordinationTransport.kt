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
import org.bramble.core.MultisigStateRead
import org.bramble.core.NetworkInfo
import org.bramble.core.NostrSyncPlan
import org.bramble.core.RelayPolicy
import org.bramble.core.RelayStep
import org.bramble.wallet.RpcClient
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

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
    post: ChainPost,
): MultisigAuthorityRead =
    withContext(Dispatchers.IO) {
        var last = MultisigAuthorityRead(info.network, address)
        for (url in info.rpcUrls) {
            val read = MultisigAuthorityRead(info.network, address)
            drive(post, URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
            last = read
            if (read.status() != MultisigAuthorityStatus.NETWORK_UNAVAILABLE) break
        }
        last
    }

/**
 * A multisig state read (authority, then nonce, then any status lookups) from [make], asking each
 * of [info]'s endpoints with a fresh read until one is reachable. [make] is an import's plain read
 * or the read the core makes for one stored intent (`multisigIntentRead`).
 */
internal suspend fun readState(
    info: NetworkInfo,
    post: ChainPost,
    make: () -> MultisigStateRead,
): MultisigStateRead =
    withContext(Dispatchers.IO) {
        var last = make()
        for (url in info.rpcUrls) {
            val read = make()
            drive(post, URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
            last = read
            if (read.status() != MultisigAuthorityStatus.NETWORK_UNAVAILABLE) break
        }
        last
    }

/**
 * Whether the pinned Argent Multisig class is declared on this network, asking each RPC endpoint
 * in turn; null when no endpoint gave an answer. An extension so the store keeps to its state.
 */
suspend fun CoordinationStore.classDeclared(): Boolean? =
    withContext(Dispatchers.IO) { readClassDeclared(network(), chainPost) }

/** Blocking: whether the pinned multisig class is declared, per the first endpoint that answers. */
internal fun readClassDeclared(
    info: NetworkInfo,
    post: ChainPost,
): Boolean? {
    for (url in info.rpcUrls) {
        val read = ClassDeclaredRead(info.network)
        drive(post, URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
        read.declared()?.let { return it }
    }
    return null
}

/**
 * Posts one coordination chain read to an endpoint, bounded to the core's byte limit for it, and
 * returns the reply; throws on any transport failure. The app's is [RpcClient.post].
 */
fun interface ChainPost {
    /** Posts [body] to [url] and returns at most [maxBytes] of reply. */
    fun post(
        url: URL,
        body: String,
        maxBytes: Int,
    ): String
}

/** Posts each request the core plans until it has none; a transport failure is reported, not thrown. */
private fun drive(
    post: ChainPost,
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
                post.post(url, request.body, limit),
            )
        }.onFailure { failed(request.id) }
    }
}

/** What the read loop does next, once [followRelayStep] has sent what the core's step asks for. */
internal enum class RelayRead { KEEP_READING, PAGE_REQUESTED, FINISHED }

/**
 * Sends the frames [step] asks for, in order. A next page closes the full subscription and opens
 * the older one on the same socket.
 */
internal fun followRelayStep(
    step: RelayStep,
    send: (String) -> Unit,
): RelayRead =
    when (step) {
        RelayStep.Continue -> {
            RelayRead.KEEP_READING
        }

        is RelayStep.NextPage -> {
            send(step.closeFrame)
            send(step.request)
            RelayRead.PAGE_REQUESTED
        }

        is RelayStep.Finish -> {
            step.closeFrame?.let(send)
            RelayRead.FINISHED
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
    // Each page's request has its own timeout, as each extension subscription does: a next page
    // moves the deadline (monotonic nanoseconds) on.
    val requestNanos = TimeUnit.MILLISECONDS.toNanos(policy.requestTimeoutMs.toLong())
    val deadline =
        AtomicLong(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(policy.connectTimeoutMs.toLong()) + requestNanos)
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
                    when (followRelayStep(plan.acceptFrame(relay, text)) { webSocket.send(it) }) {
                        RelayRead.KEEP_READING -> {}

                        RelayRead.PAGE_REQUESTED -> {
                            deadline.set(System.nanoTime() + requestNanos)
                        }

                        RelayRead.FINISHED -> {
                            webSocket.close(NORMAL_CLOSURE, null)
                            done.complete(Unit)
                        }
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
    try {
        while (!done.isCompleted) {
            val left = TimeUnit.NANOSECONDS.toMillis(deadline.get() - System.nanoTime())
            if (left <= 0) {
                plan.relayEnded(relay)
                break
            }
            // Short slices, so a next page's moved deadline takes effect when it is earlier.
            withTimeoutOrNull(minOf(left, DEADLINE_POLL_MS)) { done.await() }
        }
    } finally {
        socket.cancel()
        client.dispatcher.executorService.shutdown()
    }
}

/** How often the relay wait re-reads its deadline, which a next page moves. */
private const val DEADLINE_POLL_MS = 250L
