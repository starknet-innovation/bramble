package org.bramble.wallet.portfolio

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.bramble.core.AccountRecord
import org.bramble.core.ActivityBook
import org.bramble.core.ActivityDayGroup
import org.bramble.core.ActivityView
import org.bramble.core.BalanceHealth
import org.bramble.core.BalanceOutcome
import org.bramble.core.BalancePlan
import org.bramble.core.BalanceSnapshots
import org.bramble.core.BalanceView
import org.bramble.core.DisplayCurrency
import org.bramble.core.HomeRows
import org.bramble.core.NetworkInfo
import org.bramble.core.PortfolioHero
import org.bramble.core.PriceBook
import org.bramble.core.PriceOutcome
import org.bramble.core.PricePlan
import org.bramble.core.PriceView
import org.bramble.core.PrivacyReading
import org.bramble.core.PrivacyState
import org.bramble.core.TokenPreferences
import org.bramble.core.UnifiedBalance
import org.bramble.core.activityGroups
import org.bramble.core.balanceFailureCopy
import org.bramble.core.networkDataIssue
import org.bramble.core.portfolioHero
import org.bramble.core.rpcLimits
import org.bramble.core.tokenConfigId
import org.bramble.core.unifiedHomeBalances
import java.io.File

/**
 * Android counterpart of iOS `PortfolioStore` (UNCOMPILED: written against the generated Kotlin
 * bindings, not built here). The Rust core decides every rule and judges every response; this
 * class sequences reads, fails over across chain-id-verified endpoints ([PortfolioReads]), and
 * writes the documents the core produces into `noBackupFilesDir/portfolio/`. Activity is the
 * exception: the core owns the wallet's one activity log (submitted transactions and on-chain
 * history), read through [activity]. It is also the wallet's one balance read ([WalletStore]
 * derives Send's balances from it, see [rawBalances]). Results that land after a scope change or
 * lock carry an old generation and are dropped.
 */
class PortfolioStore(
    private val directory: File,
    /** The core's `activityBook()`: the one activity log. */
    private val activity: ActivityBook,
    private val transport: PortfolioTransport = BoundedHttp,
    private val clock: () -> Double = { System.currentTimeMillis().toDouble() },
) {
    /**
     * The account a portfolio is read for.
     *
     * @property accountId The account record id (`activityAccountId`'s form).
     * @property address The account's public address.
     * @property network The network it is read on, with its RPC endpoints.
     */
    data class Scope(
        val accountId: String,
        val address: String,
        val network: NetworkInfo,
    )

    /** The core's token preferences (tracked, hidden, display currency), loaded from disk. */
    var preferences = TokenPreferences(readDocument(directory, "preferences"))
        private set
    private var prices = PriceBook(readDocument(directory, "prices"))
    private var snapshots = BalanceSnapshots(readDocument(directory, "snapshots"))

    /** The account being shown; null while locked. */
    var scope by mutableStateOf<Scope?>(null)
        private set

    /** The latest balances the core accepted for [scope]; null until the first read lands. */
    var balances by mutableStateOf<BalanceView?>(null)
        private set

    /** The core's failure copy when balances could not be read and nothing was saved. */
    var balanceError by mutableStateOf<String?>(null)
        private set

    /** Prices in the display currency, as the core last judged them. */
    var priceView by mutableStateOf<PriceView?>(null)
        private set

    /** Home's visible and hidden rows, derived by the core from [balances]. */
    var home by mutableStateOf<HomeRows?>(null)
        private set

    /** The portfolio total shown at the top of Home. */
    var hero by mutableStateOf(PortfolioHero(null, null, null))
        private set

    /** The display currency, as stored in [preferences]. */
    var currency by mutableStateOf(preferences.displayCurrency())
        private set

    /** The scope's activity, from the core's log; null until read. */
    var activityView by mutableStateOf<ActivityView?>(null)
        private set

    /** [activityView]'s entries grouped by day, with prices applied. */
    var groups by mutableStateOf(emptyList<ActivityDayGroup>())
        private set

    /** Home rows with private value summed in (`unifiedHomeBalances` over the visible rows). */
    var unified by mutableStateOf(emptyList<UnifiedBalance>())
        private set
    private var privacyReading: PrivacyReading = PrivacyReading.Idle
    private var privacyState: PrivacyState? = null
    private var generation = 0

    private val reads = PortfolioReads(transport, rpcLimits())

    /** No prices yet, in the display currency. */
    val emptyPrices get() = PriceView(currency, emptyList(), emptyList(), null, false)
    private val tracked get() = scope?.let { preferences.tracked(it.network.network) } ?: emptyList()
    private val addresses get() = tracked.map { it.token.address }

    /** Tokens hidden from Home, whose private balances Home must not count either. */
    val hiddenTokenAddresses: List<String> get() = tracked.filter { it.hiddenFromHome }.map { it.token.address }

    /** The core's one-line data-health notice for Home (balances and prices), or null when healthy. */
    val issue: String?
        get() {
            val health =
                when {
                    balanceError != null -> BalanceHealth.Failed
                    balances != null -> BalanceHealth.Loaded(balances!!.stale, balances!!.fetchedAtMs)
                    else -> BalanceHealth.Loading
                }
            return networkDataIssue(health, priceView)
        }

    /** Enters the account's scope; its id is the account record id (`activityAccountId`'s form). */
    suspend fun load(
        account: AccountRecord,
        network: NetworkInfo,
    ) {
        val id = account.id
        val next = Scope(id, account.address, network)
        if (scope != next) {
            lock()
            scope = next
        }
        (snapshots.plan(id, network.network, clock(), true, false) as? BalancePlan.Serve)?.let { balances = it.view }
        (prices.plan(network.network, addresses, currency, clock(), true) as? PricePlan.Serve)?.let {
            priceView =
                it.view
        }
        activityView = activity.cached(id, network.network)
        recompute()
        refresh(force = false)
    }

    /**
     * Serves or reloads balances as the core plans (a [force] reload skips the cache), then prices.
     * A failed read keeps the saved balances or shows the core's failure copy; it never throws.
     */
    suspend fun refresh(force: Boolean) {
        val current = scope ?: return
        val gen = generation
        when (val plan = snapshots.plan(current.accountId, current.network.network, clock(), false, force)) {
            is BalancePlan.Serve -> {
                balances = plan.view
            }

            is BalancePlan.Empty -> {
                // Nothing cached to serve and nothing to load.
            }

            is BalancePlan.Load -> {
                val tokens = tracked.map { it.token }
                val outcome =
                    reads.firstAnswer(current.network) { url -> reads.balancesAt(current.address, tokens, url) }
                if (gen != generation) return
                if (outcome is BalanceOutcome.Balances) {
                    balances = snapshots.loaded(current.accountId, current.network.network, outcome.rows, clock())
                    balanceError =
                        null
                } else {
                    val saved = snapshots.failed(current.accountId, current.network.network)
                    if (saved != null) balances = saved else balanceError = balanceFailureCopy(outcome == null)
                }
                persistDocuments(directory, preferences, prices, snapshots)
            }
        }
        refreshPrices()
    }

    /** Serves or fetches prices for the tracked tokens as the core plans; failures are the core's to judge. */
    suspend fun refreshPrices() {
        val current = scope ?: return
        val gen = generation
        val now = clock()
        when (val plan = prices.plan(current.network.network, addresses, currency, now, false)) {
            is PricePlan.Serve -> {
                priceView = plan.view
            }

            is PricePlan.Fetch -> {
                val outcomes =
                    coroutineScope {
                        plan.requests
                            .map { r ->
                                async { PriceOutcome(r.address, transport.perform(r.request)) }
                            }.awaitAll()
                    }
                if (gen != generation) return
                priceView = prices.apply(current.network.network, addresses, currency, outcomes, now)
                persistDocuments(directory, preferences, prices, snapshots)
            }
        }
        recompute()
    }

    /** Starkscan when permitted and answering, else the RPC scan with failover; see iOS. */
    suspend fun refreshActivity(force: Boolean) {
        val now = clock()
        val current = scope?.takeIf { activity.historyDue(it.accountId, it.network.network, force, now) } ?: return
        val gen = generation
        val target = ActivityTarget(current.accountId, current.network, tracked.map { it.token }, now)
        val view = reads.activityView(activity, preferences, target) { gen == generation }
        if (view == null || gen != generation) return
        activityView = view
        persistDocuments(directory, preferences, prices, snapshots)
        recompute()
    }

    /** Stores [next] as the display currency and re-reads prices in it. */
    suspend fun setCurrency(next: DisplayCurrency) {
        preferences.setDisplayCurrency(next)
        currency = next
        persistDocuments(directory, preferences, prices, snapshots)
        refreshPrices()
    }

    /** Leaves the scope and drops every shown value; reads still in flight are then discarded. */
    fun lock() {
        generation += 1
        scope = null
        balances = null
        balanceError = null
        priceView = null
        home = null
        unified = emptyList()
        privacyReading = PrivacyReading.Idle
        privacyState = null
        hero = PortfolioHero(null, null, null)
        activityView = null
        groups = emptyList()
    }

    /** Re-reads the scope's activity from the core's log (after a send was recorded or settled). */
    fun reloadActivity() {
        val current = scope ?: return
        activityView = activity.cached(current.accountId, current.network.network)
        recompute()
    }

    /** Locks, then deletes every stored document (wallet removal) and starts from empty preferences. */
    fun deleteFiles() {
        lock()
        directory.deleteRecursively()
        preferences = TokenPreferences(null)
        prices = PriceBook(null)
        snapshots = BalanceSnapshots(null)
        currency = preferences.displayCurrency()
    }

    /** Takes the latest private reading (PrivacyModel) and recomputes the unified rows and hero. */
    fun setPrivacy(
        reading: PrivacyReading,
        state: PrivacyState?,
    ) {
        privacyReading = reading
        privacyState = state
        recompute()
    }

    private fun recompute() {
        val view = priceView ?: emptyPrices
        val loaded = balances
        home = loaded?.let { preferences.homeRows(it.balances) }
        val current = scope
        unified =
            if (current != null && home != null) {
                unifiedHomeBalances(
                    current.network.network,
                    home!!.visible,
                    hiddenTokenAddresses,
                    privacyReading,
                    privacyState,
                )
            } else {
                emptyList()
            }
        hero = portfolioHero(home?.let { unified.map { it.balance } }, view, scope != null)
        groups =
            if (current != null && activityView != null) {
                activityGroups(activityView!!.entries, tracked.map { it.token }, view, clock())
            } else {
                emptyList()
            }
    }
}

/** Base units per symbol of the network's own tokens, for Send's checks; empty until loaded. */
fun PortfolioStore.rawBalances(network: NetworkInfo): Map<String, String> {
    val loaded = balances ?: return emptyMap()
    return network.tokens
        .mapNotNull { token ->
            val id = tokenConfigId(network.network, token.symbol, token.address)
            loaded.balances.firstOrNull { it.token.id == id }?.let { token.symbol to it.balance }
        }.toMap()
}

/** A stored document's text, or null when it is missing or unreadable (the core then starts empty). */
private fun readDocument(
    directory: File,
    name: String,
) = runCatching { File(directory, "$name.json").readText() }.getOrNull()

/** Writes the core's documents, each through a temporary file renamed over the old one. */
private fun persistDocuments(
    directory: File,
    preferences: TokenPreferences,
    prices: PriceBook,
    snapshots: BalanceSnapshots,
) {
    directory.mkdirs()

    fun write(
        name: String,
        text: String,
    ) {
        val target = File(directory, "$name.json")
        val temp = File(directory, "$name.json.tmp")
        temp.writeText(text)
        temp.renameTo(target)
    }
    preferences.persisted()?.let { write("preferences", it) }
    write("prices", prices.persisted())
    write("snapshots", snapshots.persisted())
}
