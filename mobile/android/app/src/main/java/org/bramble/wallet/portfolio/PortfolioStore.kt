package org.bramble.wallet.portfolio

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.bramble.core.*

/**
 * Android counterpart of iOS `PortfolioStore` (UNCOMPILED: written against the generated Kotlin
 * bindings, not built here). The Rust core decides every rule and judges every response; this
 * class sequences reads, fails over across chain-id-verified endpoints, and writes the documents
 * the core produces into `noBackupFilesDir/portfolio/`. Activity is the exception: the core owns the
 * wallet's one activity log (submitted transactions and on-chain history), read through [activity].
 * It is also the wallet's one balance read ([WalletStore] derives Send's balances from it).
 * Results that land after a scope change or lock carry an old generation and are dropped.
 */
class PortfolioStore(
    private val directory: File,
    /** The core's `activityBook()`: the one activity log. */
    private val activity: ActivityBook,
    private val transport: PortfolioTransport = BoundedHttp,
    private val clock: () -> Double = { System.currentTimeMillis().toDouble() },
) {
    data class Scope(val accountId: String, val address: String, val network: NetworkInfo)

    private fun read(name: String) = runCatching { File(directory, "$name.json").readText() }.getOrNull()

    var preferences = TokenPreferences(read("preferences")); private set
    private var prices = PriceBook(read("prices"))
    private var snapshots = BalanceSnapshots(read("snapshots"))

    var scope by mutableStateOf<Scope?>(null); private set
    var balances by mutableStateOf<BalanceView?>(null); private set
    var balanceError by mutableStateOf<String?>(null); private set
    var priceView by mutableStateOf<PriceView?>(null); private set
    var home by mutableStateOf<HomeRows?>(null); private set
    var hero by mutableStateOf(PortfolioHero(null, null, null)); private set
    var currency by mutableStateOf(preferences.displayCurrency()); private set
    var activityView by mutableStateOf<ActivityView?>(null); private set
    var groups by mutableStateOf(emptyList<ActivityDayGroup>()); private set
    private var generation = 0

    private val limits = rpcLimits()
    /** No prices yet, in the display currency. */
    val emptyPrices get() = PriceView(currency, emptyList(), emptyList(), null, false)
    private val tracked get() = scope?.let { preferences.tracked(it.network.network) } ?: emptyList()

    val issue: String?
        get() {
            val health = when {
                balanceError != null -> BalanceHealth.Failed
                balances != null -> BalanceHealth.Loaded(balances!!.stale, balances!!.fetchedAtMs)
                else -> BalanceHealth.Loading
            }
            return networkDataIssue(health, priceView)
        }

    /** Enters the account's scope; its id is the account record id (`activityAccountId`'s form). */
    suspend fun load(account: AccountRecord, network: NetworkInfo) {
        val id = account.id
        val next = Scope(id, account.address, network)
        if (scope != next) { lock(); scope = next }
        (snapshots.plan(id, network.network, clock(), true, false) as? BalancePlan.Serve)?.let { balances = it.view }
        (prices.plan(network.network, addresses(), currency, clock(), true) as? PricePlan.Serve)?.let { priceView = it.view }
        activityView = activity.cached(id, network.network)
        recompute()
        refresh(force = false)
    }

    suspend fun refresh(force: Boolean) {
        val current = scope ?: return
        val gen = generation
        when (val plan = snapshots.plan(current.accountId, current.network.network, clock(), false, force)) {
            is BalancePlan.Serve -> balances = plan.view
            is BalancePlan.Empty -> Unit
            is BalancePlan.Load -> {
                val tokens = tracked.map { it.token }
                val outcome = firstAnswer(current.network) { url ->
                    // A refused address is a failed read, as iOS's `try?` makes it; never a crash.
                    val calls = runCatching { balanceRequests(1u, current.address, tokens) }.getOrNull()
                        ?: return@firstAnswer BalanceOutcome.Failed
                    val judged = balanceJudge(1u, tokens, send(calls, url))
                    if (judged is BalanceOutcome.Transport) null else judged
                }
                if (gen != generation) return
                if (outcome is BalanceOutcome.Balances) {
                    balances = snapshots.loaded(current.accountId, current.network.network, outcome.rows, clock()); balanceError = null
                } else {
                    val saved = snapshots.failed(current.accountId, current.network.network)
                    if (saved != null) balances = saved else balanceError = balanceFailureCopy(outcome == null)
                }
                persist()
            }
        }
        refreshPrices()
    }

    suspend fun refreshPrices() {
        val current = scope ?: return
        val gen = generation
        val now = clock()
        when (val plan = prices.plan(current.network.network, addresses(), currency, now, false)) {
            is PricePlan.Serve -> priceView = plan.view
            is PricePlan.Fetch -> {
                val outcomes = coroutineScope { plan.requests.map { r -> async { PriceOutcome(r.address, transport.perform(r.request)) } }.awaitAll() }
                if (gen != generation) return
                priceView = prices.apply(current.network.network, addresses(), currency, outcomes, now)
                persist()
            }
        }
        recompute()
    }

    /** Starkscan when permitted and answering, else the RPC scan with failover; see iOS. */
    suspend fun refreshActivity(force: Boolean) {
        val current = scope ?: return
        val gen = generation
        val net = current.network.network
        val now = clock()
        if (!activity.historyDue(current.accountId, net, force, now)) return
        val tokens = tracked.map { it.token }
        val request = activity.starkscanRequest(current.accountId, net, tokens, preferences.explorerFallbackAllowed(net), now)
        val lane = request?.let {
            val outcome = transport.perform(it)
            if (gen != generation) return
            activity.starkscanApply(current.accountId, net, tokens, outcome, now)
        }
        val view = lane ?: run {
            // CoreException from the constructor or `finish()` marks history unavailable (iOS `try?`).
            val scan = runCatching { HistoryScan(current.accountId, net, tokens) }.getOrNull()
            val rows = if (scan == null) null else firstAnswer(current.network) { url ->
                scan.restart()
                while (true) {
                    val calls = scan.nextCalls()
                    if (calls.isEmpty()) break
                    if (send(calls, url).any { scan.accept(it) == ScanStep.TRANSPORT }) return@firstAnswer null
                }
                runCatching { scan.finish() }.getOrNull()
            }
            if (rows != null) activity.scanApply(current.accountId, net, rows, now) else activity.markUnavailable(current.accountId, net, now)
        }
        if (gen != generation) return
        activityView = view
        persist()
        recompute()
    }

    suspend fun setCurrency(next: DisplayCurrency) {
        preferences.setDisplayCurrency(next); currency = next; persist(); refreshPrices()
    }

    fun lock() {
        generation += 1
        scope = null; balances = null; balanceError = null; priceView = null; home = null
        hero = PortfolioHero(null, null, null); activityView = null; groups = emptyList()
    }

    /** Re-reads the scope's activity from the core's log (after a send was recorded or settled). */
    fun reloadActivity() {
        val current = scope ?: return
        activityView = activity.cached(current.accountId, current.network.network)
        recompute()
    }

    /** Base units per symbol of the network's own tokens, for Send's checks; empty until loaded. */
    fun rawBalances(network: NetworkInfo): Map<String, String> {
        val loaded = balances ?: return emptyMap()
        return network.tokens.mapNotNull { token ->
            val id = tokenConfigId(network.network, token.symbol, token.address)
            loaded.balances.firstOrNull { it.token.id == id }?.let { token.symbol to it.balance }
        }.toMap()
    }

    fun deleteFiles() {
        lock()
        directory.deleteRecursively()
        preferences = TokenPreferences(null); prices = PriceBook(null); snapshots = BalanceSnapshots(null)
        currency = preferences.displayCurrency()
    }

    private fun addresses() = tracked.map { it.token.address }

    private fun recompute() {
        val view = priceView ?: emptyPrices
        val loaded = balances
        home = loaded?.let { preferences.homeRows(it.balances) }
        hero = portfolioHero(home?.visible, view, scope != null)
        val current = scope
        groups = if (current != null && activityView != null) {
            activityGroups(activityView!!.entries, tracked.map { it.token }, view, clock())
        } else emptyList()
    }

    private fun persist() {
        directory.mkdirs()
        fun write(name: String, text: String) {
            val target = File(directory, "$name.json")
            val temp = File(directory, "$name.json.tmp")
            temp.writeText(text)
            temp.renameTo(target)
        }
        preferences.persisted()?.let { write("preferences", it) }
        write("prices", prices.persisted())
        write("snapshots", snapshots.persisted())
    }

    private suspend fun send(call: RpcRequest, url: String): RpcReply {
        val outcome = transport.perform(HttpRequest(HttpMethod.POST, url, listOf(HttpHeader("Content-Type", "application/json")), call.body, call.maxResponseBytes, limits.deadlineMs))
        return RpcReply(call.id, outcome.status, outcome.body?.decodeToString())
    }

    private suspend fun send(calls: List<RpcRequest>, url: String): List<RpcReply> = coroutineScope {
        calls.chunked(4).flatMap { batch -> batch.map { async { send(it, url) } }.awaitAll() }
    }

    /** `withRpcFallback`: each endpoint proves its chain id first; `null` from `attempt` = next. */
    private suspend fun <T> firstAnswer(network: NetworkInfo, attempt: suspend (String) -> T?): T? {
        for (url in network.rpcUrls) {
            val reply = send(RpcRequest(0u, rpcChainIdRequest(0u), limits.maxBodyBytes), url)
            val proven = reply.body?.let { runCatching { rpcVerifyChainId(it, 0u, network.network) }.getOrDefault(false) } ?: false
            if (!proven) continue
            attempt(url)?.let { return it }
        }
        return null
    }
}
