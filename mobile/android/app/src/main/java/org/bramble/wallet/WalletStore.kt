package org.bramble.wallet

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bramble.core.AccountInfo
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.TokenInfo
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.formatTokenAmount
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.ThemeChoice

/**
 * UI state over the Rust `WalletCore`, mirroring the iOS `WalletStore`. Everything secret stays in
 * the core: this holds public account metadata, and a new recovery phrase only while onboarding
 * shows and verifies it ([pendingBackup]), cleared when onboarding finishes or the app locks.
 *
 * Main-thread only. Core calls run on `Dispatchers.Default`; every action checks its
 * [SessionGuard] ticket after each call, so a lock that lands while PBKDF2 is running wins: the
 * late result is dropped and the core is locked again (see `docs/android-parity.md`, T3).
 */
class WalletStore(
    private val core: WalletCore,
    private val prefs: SharedPreferences,
    /** Main-thread scope that outlives screens: background locks and clipboard expiry. */
    val appScope: CoroutineScope,
) {
    private val session = SessionGuard()
    private val rpc = RpcClient()
    /** Whether a vault exists on disk, tracked here so `lock()` never waits on the core mutex. */
    private var vaultWritten = core.status() != WalletStatus.NO_WALLET
    private var pendingLock: Job? = null

    var route by mutableStateOf(if (vaultWritten) Route.LOCKED else Route.ONBOARDING)
        private set
    var tab by mutableStateOf(Tab.HOME)
    var accounts by mutableStateOf(emptyList<AccountInfo>())
        private set
    var balances by mutableStateOf(emptyMap<String, String>())
        private set
    /** Network and address [balances] were read for; [amount] shows nothing for any other view. */
    private var balancesOwner by mutableStateOf<Pair<NetworkId, String>?>(null)
    /**
     * Bumped when a lock lands before any vault exists. Root keys the onboarding flow on it, so a
     * typed recovery phrase or passphrase is disposed with the flow instead of surviving the lock.
     */
    var onboardingGeneration by mutableStateOf(0)
        private set
    var networkHealthy by mutableStateOf(true)
        private set
    var busy by mutableStateOf(false)
        private set
    var selectedAccount by mutableStateOf(0u)
        private set
    /** Words of a just-created wallet; never persisted, cleared on finish or lock. */
    var pendingBackup by mutableStateOf(emptyList<String>())
        private set
    /** A transient error shown as a toast. */
    var toast by mutableStateOf<String?>(null)
    var network by mutableStateOf(NetworkPreference.fromStored(prefs.getString(NetworkPreference.KEY, null)))
        private set
    var theme by mutableStateOf(ThemeChoice.fromStored(prefs.getString(ThemeChoice.STORAGE_KEY, null)))
        private set

    val networkInfo: NetworkInfo get() = supportedNetworks().first { it.network == network }
    val networkLabel: String get() = NetworkPreference.label(network)
    val account: AccountInfo? get() = accounts.firstOrNull { it.index == selectedAccount } ?: accounts.firstOrNull()

    /** Shows [error] as a toast, unless it only reports that a lock overtook the call. */
    fun showError(error: Throwable) {
        if (error !is CancellationException) toast = describe(error)
    }

    /** Runs one PBKDF2-bound core call off the main thread, for the action holding [ticket]. */
    private suspend fun <T> work(ticket: Long, body: () -> T): T {
        pendingLock?.join()
        busy = true
        try {
            val result = withContext(Dispatchers.Default) { body() }
            ensureCurrent(ticket)
            return result
        } finally {
            busy = false
        }
    }

    /** Drops a result that arrived after a lock: re-locks the core, then fails the action. */
    private fun ensureCurrent(ticket: Long) {
        if (session.isCurrent(ticket)) return
        pendingLock = appScope.launch {
            val exists = withContext(Dispatchers.Default) {
                core.lock()
                core.status() != WalletStatus.NO_WALLET
            }
            vaultWritten = exists
            // A create or import that finished after the lock has written a vault: go to unlock.
            if (route == Route.ONBOARDING && exists) route = Route.LOCKED
        }
        throw SessionEndedException()
    }

    // Onboarding

    suspend fun create(password: String) {
        val ticket = session.ticket()
        val words = work(ticket) { core.createWallet(password, 12u) }.words
        vaultWritten = true
        pendingBackup = words
    }

    suspend fun importWallet(phrase: String, password: String) {
        val ticket = session.ticket()
        work(ticket) { core.importWallet(password, phrase, null) }
        vaultWritten = true
    }

    /** The first account of a just-written vault, for the review step. */
    suspend fun previewAccount(): AccountInfo? {
        val ticket = session.ticket()
        val network = network
        return work(ticket) { core.accounts(network) }.firstOrNull()
    }

    /** Leaves onboarding for the wallet; the backup words are dropped here. */
    suspend fun finishOnboarding() {
        pendingBackup = emptyList()
        enterWallet(session.ticket())
    }

    // Session

    suspend fun unlock(password: String) {
        val ticket = session.ticket()
        work(ticket) { core.unlock(password) }
        enterWallet(ticket)
    }

    /**
     * Ends the session: wipes UI state at once on the main thread and locks the core on
     * `Dispatchers.Default`, where it may wait behind a running vault write without stalling the UI.
     * Any action still running when this is called drops its result ([SessionGuard]).
     */
    fun lock() {
        session.end()
        pendingBackup = emptyList()
        accounts = emptyList()
        clearBalances()
        tab = Tab.HOME
        if (!vaultWritten) onboardingGeneration += 1
        route = if (vaultWritten) Route.LOCKED else Route.ONBOARDING
        pendingLock = appScope.launch(Dispatchers.Default) { core.lock() }
    }

    suspend fun switchNetwork(next: NetworkId) {
        network = next
        clearBalances()
        prefs.edit().putString(NetworkPreference.KEY, NetworkPreference.stored(next)).apply()
        enterWallet(session.ticket())
    }

    fun setTheme(choice: ThemeChoice) {
        theme = choice
        prefs.edit().putString(ThemeChoice.STORAGE_KEY, choice.stored).apply()
    }

    suspend fun addAccount() {
        val ticket = session.ticket()
        val network = network
        val added = work(ticket) { core.addAccount(network) }
        accounts = accounts + added
        selectedAccount = added.index
        clearBalances()
        refreshBalances(ticket)
    }

    suspend fun select(index: UInt) {
        selectedAccount = index
        clearBalances()
        refreshBalances()
    }

    /** Re-checks the password in the core and returns the phrase for display only. */
    suspend fun revealPhrase(password: String): List<String> {
        val ticket = session.ticket()
        return work(ticket) { core.revealRecoveryPhrase(password) }.words
    }

    suspend fun deleteWallet(password: String) {
        val ticket = session.ticket()
        work(ticket) { core.deleteWallet(password) }
        vaultWritten = false
        lock()
    }

    private suspend fun enterWallet(ticket: Long) {
        val network = network
        val loaded = try {
            work(ticket) { core.accounts(network) }
        } catch (ended: SessionEndedException) {
            throw ended
        } catch (ignored: Exception) {
            emptyList()
        }
        accounts = loaded
        if (loaded.none { it.index == selectedAccount }) selectedAccount = 0u
        route = Route.WALLET
        refreshBalances(ticket)
    }

    private fun clearBalances() {
        balances = emptyMap()
        balancesOwner = null
    }

    private fun currentView(): Pair<NetworkId, String>? = account?.let { network to it.address }

    /**
     * Reads public balances for the selected account; a failure only marks the network unhealthy.
     * The read is tied to the network and account it was sent for: a result that returns after a
     * lock, a network switch, or an account change is dropped, never shown under the new view.
     */
    suspend fun refreshBalances(ticket: Long = session.ticket()) {
        val view = currentView() ?: return
        val info = networkInfo
        val result = runCatching { rpc.balances(view.second, info) }
        if (!session.isCurrent(ticket) || currentView() != view) return
        result.onSuccess {
            balances = it
            balancesOwner = view
            networkHealthy = true
        }.onFailure { networkHealthy = false }
    }

    /** Base-unit balance formatted for display, or null until it has loaded for this view. */
    fun amount(token: TokenInfo): String? {
        if (balancesOwner == null || balancesOwner != currentView()) return null
        val raw = balances[token.symbol] ?: return null
        return runCatching { formatTokenAmount(raw, token.decimals, 4u) }.getOrNull()
    }

    /** Core lifecycle state, for tests and diagnostics. Takes the core's session mutex. */
    internal fun coreStatus(): WalletStatus = core.status()
}
