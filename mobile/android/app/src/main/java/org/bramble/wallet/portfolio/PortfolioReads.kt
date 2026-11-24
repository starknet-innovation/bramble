package org.bramble.wallet.portfolio

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.bramble.core.ActivityBook
import org.bramble.core.ActivityEntry
import org.bramble.core.ActivityView
import org.bramble.core.BalanceOutcome
import org.bramble.core.HistoryScan
import org.bramble.core.HttpHeader
import org.bramble.core.HttpMethod
import org.bramble.core.HttpRequest
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcLimits
import org.bramble.core.RpcReply
import org.bramble.core.RpcRequest
import org.bramble.core.ScanStep
import org.bramble.core.TokenConfig
import org.bramble.core.balanceJudge
import org.bramble.core.balanceRequests
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId
import org.bramble.wallet.ReliabilityDiagnostics
import java.net.URL

/** JSON-RPC calls sent at once to one endpoint; the rest wait for the batch before them. */
private const val RPC_BATCH = 4

private const val NANOS_PER_MS = 1_000_000L

/**
 * One activity read for [PortfolioStore.refreshActivity].
 *
 * @property accountId The account record id.
 * @property network The network, with the RPC endpoints the scan fails over across.
 * @property tokens The tracked tokens whose transfers count as activity.
 * @property now The read's timestamp in milliseconds.
 */
internal data class ActivityTarget(
    val accountId: String,
    val network: NetworkInfo,
    val tokens: List<TokenConfig>,
    val now: Double,
)

/**
 * The byte-moving half of [PortfolioStore]: posts the core's JSON-RPC calls through [transport]
 * under the core's [limits], and fails over across endpoints that first prove their chain id. The
 * core builds every request and judges every reply; a transport failure is an answer to judge,
 * never an exception here.
 */
internal class PortfolioReads(
    val transport: PortfolioTransport,
    private val limits: RpcLimits,
) {
    /** One balance read at [url]; null when the endpoint failed in transport, so the next is tried. */
    suspend fun balancesAt(
        address: String,
        tokens: List<TokenConfig>,
        url: String,
    ): BalanceOutcome? {
        // A refused address is a failed read, as iOS's `try?` makes it; never a crash.
        val calls =
            runCatching { balanceRequests(1u, address, tokens) }.getOrNull()
                ?: return BalanceOutcome.Failed
        val judged = balanceJudge(1u, tokens, sendAll(calls, url))
        return if (judged is BalanceOutcome.Transport) null else judged
    }

    /**
     * The scope's activity: Starkscan when the core permits and it answers, else the RPC scan with
     * failover. Null only when [current] reports a lock overtook the Starkscan read; nothing is
     * applied to [book] then.
     */
    suspend fun activityView(
        book: ActivityBook,
        explorerAllowed: Boolean,
        target: ActivityTarget,
        current: () -> Boolean,
    ): ActivityView? {
        val net = target.network.network
        val request =
            book.starkscanRequest(
                target.accountId,
                net,
                target.tokens,
                explorerAllowed,
                target.now,
            )
        val lane =
            request?.let {
                val started = System.nanoTime()
                val outcome = transport.perform(it)
                val elapsedMs = (System.nanoTime() - started) / NANOS_PER_MS
                if (!current()) return null
                book.starkscanApply(target.accountId, net, target.tokens, outcome, target.now).also { view ->
                    ReliabilityDiagnostics.recordExplorer(outcome, applied = view != null, elapsedMs = elapsedMs)
                }
            }
        return lane ?: scanHistory(book, target)
    }

    /** The RPC history scan; an unavailable scan or no answering endpoint marks history unavailable. */
    private suspend fun scanHistory(
        book: ActivityBook,
        target: ActivityTarget,
    ): ActivityView {
        val net = target.network.network
        // CoreException from the constructor or `finish()` marks history unavailable (iOS `try?`).
        val scan = runCatching { HistoryScan(target.accountId, net, target.tokens) }.getOrNull()
        val rows = scan?.let { firstAnswer(target.network) { url -> scanAt(it, url) } }
        return if (rows != null) {
            book.scanApply(target.accountId, net, rows, target.now)
        } else {
            book.markUnavailable(target.accountId, net, target.now)
        }
    }

    /** Runs [scan] from the start against [url]; null when the endpoint failed in transport. */
    private suspend fun scanAt(
        scan: HistoryScan,
        url: String,
    ): List<ActivityEntry>? {
        scan.restart()
        var calls = scan.nextCalls()
        while (calls.isNotEmpty()) {
            if (sendAll(calls, url).any { scan.accept(it) == ScanStep.TRANSPORT }) return null
            calls = scan.nextCalls()
        }
        return runCatching { scan.finish() }.getOrNull()
    }

    /** `withRpcFallback`: each endpoint proves its chain id first; `null` from `attempt` = next. */
    suspend fun <T> firstAnswer(
        network: NetworkInfo,
        attempt: suspend (String) -> T?,
    ): T? {
        for (url in network.rpcUrls) {
            val reply = send(RpcRequest(0u, rpcChainIdRequest(0u), limits.maxBodyBytes), url)
            val proven =
                reply.body?.let { runCatching { rpcVerifyChainId(it, 0u, network.network) }.getOrDefault(false) }
                    ?: false
            if (!proven) continue
            attempt(url)?.let { return it }
        }
        return null
    }

    private suspend fun send(
        call: RpcRequest,
        url: String,
    ): RpcReply {
        val started = System.nanoTime()
        val outcome =
            transport.perform(
                HttpRequest(
                    HttpMethod.POST,
                    url,
                    listOf(HttpHeader("Content-Type", "application/json")),
                    call.body,
                    call.maxResponseBytes,
                    limits.deadlineMs,
                ),
            )
        runCatching { URL(url) }.getOrNull()?.let {
            ReliabilityDiagnostics.recordRpc(it, outcome, (System.nanoTime() - started) / NANOS_PER_MS)
        }
        return RpcReply(call.id, outcome.status, outcome.body?.decodeToString())
    }

    /** Posts [calls] to [url] in batches; each reply carries its request id, unanswered on failure. */
    suspend fun sendAll(
        calls: List<RpcRequest>,
        url: String,
    ): List<RpcReply> =
        coroutineScope {
            calls.chunked(RPC_BATCH).flatMap { batch -> batch.map { async { send(it, url) } }.awaitAll() }
        }
}
