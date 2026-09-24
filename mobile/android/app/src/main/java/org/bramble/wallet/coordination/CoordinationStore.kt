package org.bramble.wallet.coordination

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.bramble.core.ClassDeclaredRead
import org.bramble.core.Contact
import org.bramble.core.CoordinationSyncOutcome
import org.bramble.core.MultisigAuthorityRead
import org.bramble.core.MultisigAuthorityStatus
import org.bramble.core.MultisigRecord
import org.bramble.core.NetworkInfo
import org.bramble.core.NostrSyncPlan
import org.bramble.core.RelayPolicy
import org.bramble.core.RelayStep
import org.bramble.core.WalletCore
import org.bramble.core.ArgentMultisigConfig

/**
 * Public UI state for the wallet card, contacts, shared accounts, and Nostr coordination, as the
 * iOS `CoordinationStore`. The core keeps the coordination private key, gift-wrap plaintext, and
 * raw relay events; this class moves bytes (HTTPS for chain reads, one OkHttp WebSocket per relay
 * for a sync) and holds public values. `reset()` runs on lock and cancels any sync.
 *
 * Uncompiled: there is no Android SDK on the machine this was written on (mobile/docs/nostr-multisig.md §10).
 */
class CoordinationStore(private val core: WalletCore, private val network: () -> NetworkInfo) {
    var nostrKey by mutableStateOf<String?>(null)
        private set
    var nostrUnavailable by mutableStateOf(false)
        private set
    var contacts by mutableStateOf(emptyList<Contact>())
        private set
    var multisigs by mutableStateOf(emptyList<MultisigRecord>())
        private set
    var relayPolicy by mutableStateOf<RelayPolicy?>(null)
        private set
    private var syncJob: Job? = null
    /** Bumped on lock; a core call that finishes after it must not write back. */
    private var generation = 0

    /** A refusal carrying the extension's user-facing copy. */
    class Refusal(message: String) : Exception(message)

    fun reset() {
        generation += 1
        syncJob?.cancel()
        syncJob = null
        nostrKey = null
        nostrUnavailable = false
        contacts = emptyList()
        multisigs = emptyList()
        relayPolicy = null
    }

    private suspend fun <T> work(body: () -> T): T = withContext(Dispatchers.Default) { body() }

    suspend fun loadNostrKey() {
        if (nostrKey != null) return
        val started = generation
        val result = runCatching { work { core.nostrPublicKey() } }
        if (started != generation) return
        result.onSuccess { nostrKey = it; nostrUnavailable = false }.onFailure { nostrUnavailable = true }
    }

    suspend fun refresh() {
        val id = network().network
        val started = generation
        val nextContacts = runCatching { work { core.contacts(id) } }.getOrDefault(emptyList())
        val nextMultisigs = runCatching { work { core.multisigs(id) } }.getOrDefault(emptyList())
        val nextPolicy = runCatching { work { core.relayPolicy() } }.getOrNull()
        if (started != generation) return
        contacts = nextContacts
        multisigs = nextMultisigs
        relayPolicy = nextPolicy
    }

    suspend fun saveContact(label: String, address: String, publicKeyX: String?, nostrPublicKey: String?) {
        work { core.saveContact(network().network, label, address, publicKeyX, nostrPublicKey) }
        refresh()
    }

    suspend fun removeContact(id: String) {
        work { core.removeContact(id) }
        refresh()
    }

    suspend fun saveSetup(name: String, keys: List<String>, threshold: UInt, salt: String, deployer: UInt): MultisigRecord {
        val record = work { core.saveMultisigSetup(network().network, name, ArgentMultisigConfig(threshold, keys), salt, deployer) }
        refresh()
        return record
    }

    suspend fun removeShared(id: String) {
        work { core.removeMultisig(id) }
        refresh()
    }

    /** `addMultisig`: returns the status copy, or throws [Refusal] with the extension's error copy. */
    suspend fun addShared(raw: String): String {
        val info = network()
        val read = runCatching { authority(raw.trim().lowercase(), info) }
            .getOrElse { throw Refusal("Enter a valid non-zero Starknet account address.") }
        when (read.status()) {
            MultisigAuthorityStatus.AVAILABLE, MultisigAuthorityStatus.UNDEPLOYED -> Unit
            MultisigAuthorityStatus.INVALID_CONFIG -> throw Refusal("This Argent multisig returned an invalid signer configuration")
            MultisigAuthorityStatus.UNSUPPORTED_CLASS -> throw Refusal("This address is not the pinned Argent Multisig 0.2 account")
            else -> throw Refusal("Argent multisig authority could not be verified. Check the network and retry")
        }
        val record = work { core.addMultisig(read) }
        refresh()
        if (read.status() == MultisigAuthorityStatus.UNDEPLOYED) return "Undeployed multisig added · complete setup to deploy"
        val matched = record.localSignerIndexes.size
        return if (matched == 0) "Multisig synced · watch-only" else "Multisig synced · $matched wallet signer${if (matched == 1) "" else "s"} found"
    }

    suspend fun setRelay(raw: String): String {
        val started = generation
        val saved = work { core.setNostrRelayUrl(raw) }
        val nextPolicy = runCatching { work { core.relayPolicy() } }.getOrNull()
        if (started == generation) relayPolicy = nextPolicy
        return if (saved == null) "Coordination relay reset" else "Coordination relay saved"
    }

    suspend fun classDeclared(): Boolean? = withContext(Dispatchers.IO) {
        val info = network()
        for (url in info.rpcUrls) {
            val read = ClassDeclaredRead(info.network)
            drive(URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
            read.declared()?.let { return@withContext it }
        }
        null
    }

    /** One "Check for updates": the core plans and judges; this only moves frames. */
    suspend fun sync(multisigId: String): CoordinationSyncOutcome = coroutineScope {
        val now = (System.currentTimeMillis() / 1000).toULong()
        val job = async(Dispatchers.IO) {
            val plan = core.coordinationSyncBegin(multisigId, now)
            val policy = core.relayPolicy()
            plan.relayUrls().mapIndexed { index, url -> async { runRelay(plan, index.toUInt(), url, policy) } }.awaitAll()
            core.coordinationSyncFinish(plan)
        }
        syncJob = job
        try { job.await() } finally { syncJob = null }
    }

    private suspend fun authority(address: String, info: NetworkInfo): MultisigAuthorityRead = withContext(Dispatchers.IO) {
        var last = MultisigAuthorityRead(info.network, address)
        for (url in info.rpcUrls) {
            val read = MultisigAuthorityRead(info.network, address)
            drive(URL(url), { read.nextRequest() }, read::acceptResponse, read::transportFailed)
            last = read
            if (read.status() != MultisigAuthorityStatus.NETWORK_UNAVAILABLE) break
        }
        last
    }

    private fun drive(
        url: URL,
        next: () -> org.bramble.core.RpcRequest?,
        accept: (ULong, String) -> Unit,
        failed: (ULong) -> Unit,
    ) {
        while (true) {
            val request = next() ?: return
            runCatching { accept(request.id, post(url, request.body, request.maxResponseBytes)) }.onFailure { failed(request.id) }
        }
    }

    /** Stops reading past `maxBytes` (the core's own limit for this request). */
    private fun post(url: URL, body: String, maxBytes: ULong): String {
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
            val limit = maxBytes.toLong()
            check(connection.contentLengthLong <= limit) { "response too large" }
            return connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    check(out.size().toLong() + read <= limit) { "response too large" }
                    out.write(buffer, 0, read)
                }
                out.toByteArray().decodeToString()
            }
        } finally {
            connection.disconnect()
        }
    }

    /** One wss socket per relay; the core decides when it is finished. Timeouts end the relay. */
    private suspend fun runRelay(plan: NostrSyncPlan, relay: UInt, url: String, policy: RelayPolicy) {
        if (!url.startsWith("wss://", ignoreCase = true)) return plan.relayEnded(relay)
        val done = CompletableDeferred<Unit>()
        val client = OkHttpClient.Builder()
            .connectTimeout(policy.connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
        val socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(plan.openFrame(relay))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val step = plan.acceptFrame(relay, text)
                if (step is RelayStep.Finish) {
                    step.closeFrame?.let(webSocket::send)
                    webSocket.close(1000, null)
                    done.complete(Unit)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                plan.relayEnded(relay)
                done.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                plan.relayEnded(relay)
                done.complete(Unit)
            }
        })
        val total = policy.connectTimeoutMs.toLong() + policy.requestTimeoutMs.toLong()
        try {
            if (withTimeoutOrNull(total) { done.await() } == null) plan.relayEnded(relay)
        } finally {
            socket.cancel()
            client.dispatcher.executorService.shutdown()
        }
    }
}
