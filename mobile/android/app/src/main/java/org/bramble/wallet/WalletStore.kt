package org.bramble.wallet

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.AccountGroup
import org.bramble.core.AccountInfo
import org.bramble.core.AccountRecord
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks

/**
 * UI state over the Rust `WalletCore`, mirroring the iOS `WalletStore`. Holds only public account
 * metadata; a recovery phrase lives here only while the backup screen is showing it.
 */
class WalletStore(private val core: WalletCore, private val prefs: SharedPreferences) {
    /** DISCOVERY: an imported vault waiting for "Find your accounts" (recovery pending). */
    enum class Route { WELCOME, BACKUP, LOCKED, DISCOVERY, HOME }

    var route by mutableStateOf(if (core.status() == WalletStatus.NO_WALLET) Route.WELCOME else Route.LOCKED)
        private set
    /** Deprecated OZ-only view of the core's `accounts()`; new code reads [records]. */
    var accounts by mutableStateOf(emptyList<AccountInfo>())
        private set
    /** This network's accounts as the core renders them (name, label, type, group). */
    var records by mutableStateOf(emptyList<AccountRecord>())
        private set
    var allRecords by mutableStateOf(emptyList<AccountRecord>())
        private set
    var groups by mutableStateOf(emptyList<AccountGroup>())
        private set
    var activeRecord by mutableStateOf<AccountRecord?>(null)
        private set
    /** A transient message for the snackbar-style toast, and whether it reports success. */
    var toast by mutableStateOf<Pair<String, Boolean>?>(null)
    var balances by mutableStateOf(emptyMap<String, String>())
        private set
    var balanceError by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var pendingBackup by mutableStateOf(emptyList<String>())
        private set
    var network by mutableStateOf(if (prefs.getString("network", null) == "sepolia") NetworkId.SEPOLIA else NetworkId.MAINNET)
        private set

    private val rpc = RpcClient()
    internal val walletCore: WalletCore get() = core

    val networkInfo: NetworkInfo get() = supportedNetworks().first { it.network == network }
    /** The active account in the pre-records shape; signing must use [activeRecord] ids. */
    val account: AccountInfo?
        get() = activeRecord?.let { AccountInfo(it.accountIndex, it.address, it.publicKey, it.classHash, it.network) }

    /** PBKDF2-bound core work runs off the main thread. */
    internal suspend fun <T> work(body: () -> T): T {
        busy = true
        try {
            return withContext(Dispatchers.Default) { body() }
        } finally {
            busy = false
        }
    }

    suspend fun create(password: String) {
        val network = network
        pendingBackup = work { core.createWalletOnNetwork(password, 12u, network) }.words
        route = Route.BACKUP
    }

    suspend fun confirmBackup() {
        pendingBackup = emptyList()
        enterHome()
    }

    suspend fun importWallet(phrase: String, password: String, passphrase: String?) {
        work { core.importWallet(password, phrase, passphrase) }
        route = Route.DISCOVERY
    }

    suspend fun unlock(password: String) {
        work { core.unlock(password) }
        enterHome()
    }

    fun lock() {
        core.lock()
        pendingBackup = emptyList()
        accounts = emptyList()
        records = emptyList()
        allRecords = emptyList()
        groups = emptyList()
        activeRecord = null
        balances = emptyMap()
        if (route != Route.WELCOME) route = if (core.status() == WalletStatus.NO_WALLET) Route.WELCOME else Route.LOCKED
    }

    suspend fun switchNetwork(next: NetworkId) {
        network = next
        prefs.edit().putString("network", if (next == NetworkId.MAINNET) "mainnet" else "sepolia").apply()
        enterHome()
    }

    /** "Regular account": OpenZeppelin at the next free index, made active. */
    suspend fun addRegularAccount() {
        val network = network
        work { core.addRegularAccount(network) }
        reloadAccounts()
        refreshBalances()
        toast = "Account added" to true
    }

    suspend fun select(id: String) {
        work { core.selectAccount(id) }
        reloadAccounts()
        refreshBalances()
    }

    /** Re-reads records and groups; with [ensure], first runs the network-switch rule. */
    suspend fun reloadAccounts(ensure: Boolean = false) {
        val network = network
        runCatching {
            work {
                if (ensure) core.ensureNetworkAccount(network)
                AccountsSnapshot(core.accountRecords(network), core.allAccountRecords(), core.accountGroups(), core.accounts(network))
            }
        }.onSuccess { snapshot ->
            records = snapshot.records
            allRecords = snapshot.allRecords
            groups = snapshot.groups
            accounts = snapshot.legacy
            activeRecord = records.firstOrNull { it.active }
        }.onFailure { toast = describe(it) to false }
    }

    /** Leaves "Find your accounts" once the core has restored the selection. */
    suspend fun finishRecovery() = enterHome()

    suspend fun revealPhrase(password: String): List<String> = work { core.revealRecoveryPhrase(password).words }

    suspend fun deleteWallet(password: String) {
        work { core.deleteWallet(password) }
        lock()
        route = Route.WELCOME
    }

    /** Back to discovery while recovery is pending; otherwise keep, pick, or project an account. */
    private suspend fun enterHome() {
        if (runCatching { core.recoveryPending() }.getOrDefault(false)) {
            route = Route.DISCOVERY
            return
        }
        reloadAccounts(ensure = true)
        route = Route.HOME
        refreshBalances()
    }

    suspend fun refreshBalances() {
        val address = account?.address ?: return
        balanceError = null
        balances = runCatching { rpc.balances(address, networkInfo) }.getOrElse {
            balanceError = "Couldn't reach ${networkInfo.name}."
            emptyMap()
        }
    }
}

/** One consistent read of the account state, taken off the main thread. */
private data class AccountsSnapshot(
    val records: List<AccountRecord>,
    val allRecords: List<AccountRecord>,
    val groups: List<AccountGroup>,
    val legacy: List<AccountInfo>,
)

/** User-facing text for a core error. Never includes input. */
fun describe(error: Throwable): String = when (error) {
    is CoreException.WrongPassword -> "Wrong password."
    is CoreException.InvalidInput -> error.reason.replaceFirstChar { it.uppercase() } + "."
    is CoreException.WalletExists -> "A wallet already exists on this device."
    is CoreException.Locked -> "The wallet is locked."
    else -> "Something went wrong. Please try again."
}
