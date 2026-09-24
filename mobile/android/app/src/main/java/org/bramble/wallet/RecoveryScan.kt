package org.bramble.wallet

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.RecoveryCandidate
import org.bramble.core.RecoverySelection
import org.bramble.core.RecoveryScanStep
import org.bramble.core.RpcRequest
import org.bramble.core.RpcResponse
import org.bramble.core.WalletCore
import org.bramble.core.AccountFamily
import org.bramble.core.recoveryLimits
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId

// "Find your accounts" over the core's sans-IO scan, twin of iOS RecoveryScanDriver.swift and
// RpcTransport.swift. The core derives every address and judges every answer; this layer moves
// bytes and keeps the user's picks. UNCOMPILED (no Android SDK on the authoring machine).

/** Moves a batch of core-built JSON-RPC bodies. */
fun interface RpcTransport {
    suspend fun send(requests: List<RpcRequest>, network: NetworkInfo): List<RpcResponse>
}

/**
 * The first bundled endpoint that proves the chain, then every body with at most four in flight,
 * each through [RpcClient.post] (HTTPS, bounded replies, never a write).
 */
class LiveRpcTransport : RpcTransport {
    override suspend fun send(requests: List<RpcRequest>, network: NetworkInfo): List<RpcResponse> =
        withContext(Dispatchers.IO) {
            val gate = Semaphore(4)
            for (url in network.rpcUrls.map(::URL)) {
                val proven = runCatching { rpcVerifyChainId(RpcClient.post(url, rpcChainIdRequest(0u)), 0u, network.network) }
                    .getOrDefault(false)
                if (!proven) continue
                // A nested scope per endpoint: one failed POST cancels only this endpoint's
                // siblings and surfaces here, so the loop fails over to the next proven endpoint
                // as the iOS twin does. Cancellation of the caller is rethrown, never swallowed.
                val responses = try {
                    coroutineScope {
                        requests.map { request ->
                            async { gate.withPermit { RpcResponse(request.id, RpcClient.post(url, request.body)) } }
                        }.awaitAll()
                    }
                } catch (cancelled: CancellationException) {
                    ensureActive()
                    null
                } catch (failed: Exception) {
                    null
                }
                if (responses != null) return@withContext responses
            }
            error("no endpoint reachable")
        }
}

class RecoveryScanDriver(private val core: WalletCore, private val transport: RpcTransport) {
    var candidates by mutableStateOf(emptyList<RecoveryCandidate>())
        private set
    var status by mutableStateOf("Ready to search.")
        private set
    var complete by mutableStateOf(false)
        private set
    var scanning by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    var selected by mutableStateOf(emptySet<String>())
        private set
    private var seen = emptySet<String>()
    private var generation = 0
    private val maxSelections = recoveryLimits().maxSelections.toInt()

    suspend fun start(network: NetworkInfo) {
        generation += 1
        candidates = emptyList()
        complete = false
        selected = emptySet()
        seen = emptySet()
        core.recoveryScanReset()
        status = "Searching every account type…"
        scan(network, null)
    }

    fun cancel() {
        generation += 1
        scanning = false
    }

    suspend fun scan(network: NetworkInfo, manual: UInt?) {
        if (scanning) return
        scanning = true
        failed = false
        val active = generation
        try {
            do {
                var step = withContext(Dispatchers.Default) { core.recoveryScanNext(network.network, manual) }
                while (step.requests.isNotEmpty()) {
                    val responses = transport.send(step.requests, network)
                    step = withContext(Dispatchers.Default) { core.recoveryScanSubmit(responses) }
                }
                if (active != generation) return
                apply(step)
            } while (manual == null && !complete)
        } catch (error: Exception) {
            if (active != generation) return
            failed = true
            status = "Account search paused. Check the network and retry."
        } finally {
            if (active == generation) scanning = false
        }
    }

    private fun apply(step: RecoveryScanStep) {
        for (candidate in step.candidates) {
            if (candidate.key in seen) continue
            if (candidate.autoSelect) trySelect(candidate.key)
            seen = seen + candidate.key
        }
        candidates = step.candidates
        complete = step.complete
        status = step.status
    }

    private fun trySelect(key: String): Boolean {
        if (key in selected) return true
        if (selected.size >= maxSelections) return false
        selected = selected + key
        return true
    }

    /** Checks or unchecks one row; false when the 40-account bound refuses it. */
    fun toggle(candidate: RecoveryCandidate): Boolean {
        if (candidate.key in selected) {
            selected = selected - candidate.key
            return true
        }
        return candidate.selectable && trySelect(candidate.key)
    }

    /** The checked rows as the core's restore input (`WalletStore.restoreRecoveredAccounts`). */
    val selections: List<RecoverySelection>
        get() = candidates.filter { it.key in selected }.map {
            RecoverySelection(it.family, it.accountIndex, if (it.family == AccountFamily.OPEN_ZEPPELIN) null else it.classHash)
        }
}
