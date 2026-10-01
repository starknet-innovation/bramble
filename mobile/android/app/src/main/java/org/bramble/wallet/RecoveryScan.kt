package org.bramble.wallet

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.bramble.core.AccountFamily
import org.bramble.core.NetworkInfo
import org.bramble.core.RecoveryCandidate
import org.bramble.core.RecoveryScanStep
import org.bramble.core.RecoverySelection
import org.bramble.core.RpcRequest
import org.bramble.core.RpcResponse
import org.bramble.core.WalletCore
import org.bramble.core.recoveryLimits
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId
import java.io.IOException
import java.net.URL

// "Find your accounts" over the core's sans-IO scan, twin of iOS RecoveryScanDriver.swift and
// RpcTransport.swift. The core derives every address and judges every answer; this layer moves
// bytes and keeps the user's picks.

/** Moves a batch of core-built JSON-RPC bodies. */
fun interface RpcTransport {
    /**
     * Posts every request to one endpoint that proved [network]'s chain and returns the replies
     * (in any order; the core matches them by id). Throws when no endpoint answers them all.
     */
    suspend fun send(
        requests: List<RpcRequest>,
        network: NetworkInfo,
    ): List<RpcResponse>
}

/**
 * The first bundled endpoint that proves the chain, then every body with at most four in flight,
 * each through [RpcClient.post] (HTTPS, bounded replies, never a write).
 */
class LiveRpcTransport : RpcTransport {
    override suspend fun send(
        requests: List<RpcRequest>,
        network: NetworkInfo,
    ): List<RpcResponse> =
        withContext(Dispatchers.IO) {
            val gate = Semaphore(MAX_IN_FLIGHT)
            // The loop fails over to the next proven endpoint as the iOS twin does; the last
            // endpoint's failure becomes the cause of the final error.
            var lastFailure: Throwable? = null
            val responses =
                network.rpcUrls.map(::URL).firstNotNullOfOrNull { url ->
                    if (proves(url, network)) {
                        attempt(url, requests, gate).onFailure { lastFailure = it }.getOrNull()
                    } else {
                        null
                    }
                }
            responses ?: throw IllegalStateException("no endpoint reachable", lastFailure)
        }

    /**
     * Every reply from [url], or the failure that ended this endpoint's attempt. A nested scope per
     * endpoint: one failed POST cancels only this endpoint's siblings and surfaces here.
     * Cancellation of the caller is rethrown, never swallowed.
     */
    private suspend fun attempt(
        url: URL,
        requests: List<RpcRequest>,
        gate: Semaphore,
    ): Result<List<RpcResponse>> =
        try {
            Result.success(postAll(url, requests, gate))
        } catch (cancelled: CancellationException) {
            currentCoroutineContext().ensureActive()
            Result.failure(cancelled)
        } catch (failed: IOException) {
            Result.failure(failed)
        } catch (failed: IllegalStateException) {
            Result.failure(failed)
        }

    /** True when [url] answers the chain-id probe with [network]'s chain; any failure is false. */
    private fun proves(
        url: URL,
        network: NetworkInfo,
    ): Boolean =
        runCatching { rpcVerifyChainId(RpcClient.post(url, rpcChainIdRequest(0u)), 0u, network.network) }
            .getOrDefault(false)

    /** Posts every request to [url], at most [MAX_IN_FLIGHT] at once; the first failure cancels the rest. */
    private suspend fun postAll(
        url: URL,
        requests: List<RpcRequest>,
        gate: Semaphore,
    ): List<RpcResponse> =
        coroutineScope {
            requests
                .map { request ->
                    async {
                        gate.withPermit {
                            RpcResponse(
                                request.id,
                                RpcClient.post(url, request.body),
                            )
                        }
                    }
                }.awaitAll()
        }
}

/** How many recovery reads one endpoint serves at once. */
private const val MAX_IN_FLIGHT = 4

/**
 * Runs "Find your accounts" for the UI: drives the core's scan steps through an [RpcTransport] and
 * keeps the candidates, the status line, and the person's picks (bounded by the core's
 * `maxSelections`). Main-thread state; the core derives every address and judges every reply, and
 * a [cancel] or restart drops any result still in flight.
 */
class RecoveryScanDriver(
    private val core: WalletCore,
    private val transport: RpcTransport,
) {
    /** The core's rows for the current scan, in its order. */
    var candidates by mutableStateOf(emptyList<RecoveryCandidate>())
        private set

    /** The core's progress line, or the paused message after a failure. */
    var status by mutableStateOf("Ready to search.")
        private set

    /** True once the core reports the automatic search finished. */
    var complete by mutableStateOf(false)
        private set

    /** True while a scan is running; a second scan is refused until it ends. */
    var scanning by mutableStateOf(false)
        private set

    /** True when the last scan stopped on a failure (network or core); retry resumes it. */
    var failed by mutableStateOf(false)
        private set

    /** Keys of the checked rows. */
    var selected by mutableStateOf(emptySet<String>())
        private set

    /** The checked rows as the core's restore input (`WalletStore.restoreRecoveredAccounts`). */
    val selections: List<RecoverySelection>
        get() =
            candidates.filter { it.key in selected }.map {
                RecoverySelection(
                    it.family,
                    it.accountIndex,
                    if (it.family ==
                        AccountFamily.OPEN_ZEPPELIN
                    ) {
                        null
                    } else {
                        it.classHash
                    },
                )
            }

    private var seen = emptySet<String>()
    private var generation = 0
    private val maxSelections = recoveryLimits().maxSelections.toInt()

    /** Clears every row and pick, resets the core's scan, and runs the automatic search. */
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

    /** Drops the running scan's results (the screen left); the core's scan state is kept. */
    fun cancel() {
        generation += 1
        scanning = false
    }

    /**
     * Continues the automatic search to completion, or checks one [manual] index. Any failure
     * pauses the scan with a retry message instead of throwing; a [cancel] meanwhile discards it.
     */
    suspend fun scan(
        network: NetworkInfo,
        manual: UInt?,
    ) {
        if (scanning) return
        scanning = true
        failed = false
        val active = generation
        try {
            runSteps(network, manual, active)
        } catch (ignored: Exception) {
            // By design any failure pauses the scan with fixed retry copy; its detail is not shown.
            if (active == generation) {
                failed = true
                status = "Account search paused. Check the network and retry."
            }
        } finally {
            if (active == generation) scanning = false
        }
    }

    /** Moves the core's steps until it needs no more reads; stops quietly once [active] is stale. */
    private suspend fun runSteps(
        network: NetworkInfo,
        manual: UInt?,
        active: Int,
    ) {
        do {
            var step = withContext(Dispatchers.Default) { core.recoveryScanNext(network.network, manual) }
            while (step.requests.isNotEmpty()) {
                val responses = transport.send(step.requests, network)
                step = withContext(Dispatchers.Default) { core.recoveryScanSubmit(responses) }
            }
            if (active != generation) return
            apply(step)
        } while (manual == null && !complete)
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

    /** Checks [key] unless the bound is reached; true when it is (or already was) checked. */
    private fun trySelect(key: String): Boolean {
        if (key !in selected && selected.size < maxSelections) selected = selected + key
        return key in selected
    }

    /** Checks or unchecks one row; false when the 40-account bound refuses it. */
    fun toggle(candidate: RecoveryCandidate): Boolean {
        if (candidate.key in selected) {
            selected = selected - candidate.key
            return true
        }
        return candidate.selectable && trySelect(candidate.key)
    }
}

/** Commits the discovery picks in one vault write on this network; returns how many were restored. */
suspend fun WalletStore.restoreRecoveredAccounts(selections: List<RecoverySelection>): Int {
    val network = network
    return accountCall(reload = false) { it.restoreRecoveredAccounts(network, selections) }.size
}
