package org.bramble.wallet

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.AccountInfo
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
    enum class Route { WELCOME, BACKUP, LOCKED, HOME }

    var route by mutableStateOf(if (core.status() == WalletStatus.NO_WALLET) Route.WELCOME else Route.LOCKED)
        private set
    var accounts by mutableStateOf(emptyList<AccountInfo>())
        private set
    var balances by mutableStateOf(emptyMap<String, String>())
        private set
    var balanceError by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var pendingBackup by mutableStateOf(emptyList<String>())
        private set
    var selectedAccount by mutableStateOf(0u)
    var network by mutableStateOf(if (prefs.getString("network", null) == "sepolia") NetworkId.SEPOLIA else NetworkId.MAINNET)
        private set

    private val rpc = RpcClient()
    /** Wallet card, contacts, shared accounts, and Nostr coordination (public state only). */
    val coordination = org.bramble.wallet.coordination.CoordinationStore(core) { networkInfo }

    val networkInfo: NetworkInfo get() = supportedNetworks().first { it.network == network }
    val account: AccountInfo? get() = accounts.firstOrNull { it.index == selectedAccount } ?: accounts.firstOrNull()

    /** PBKDF2-bound core work runs off the main thread. */
    private suspend fun <T> work(body: () -> T): T {
        busy = true
        try {
            return withContext(Dispatchers.Default) { body() }
        } finally {
            busy = false
        }
    }

    suspend fun create(password: String) {
        pendingBackup = work { core.createWallet(password, 12u) }.words
        route = Route.BACKUP
    }

    suspend fun confirmBackup() {
        pendingBackup = emptyList()
        enterHome()
    }

    suspend fun importWallet(phrase: String, password: String, passphrase: String?) {
        work { core.importWallet(password, phrase, passphrase) }
        enterHome()
    }

    suspend fun unlock(password: String) {
        work { core.unlock(password) }
        enterHome()
    }

    fun lock() {
        core.lock()
        coordination.reset()
        pendingBackup = emptyList()
        accounts = emptyList()
        balances = emptyMap()
        if (route != Route.WELCOME) route = if (core.status() == WalletStatus.NO_WALLET) Route.WELCOME else Route.LOCKED
    }

    suspend fun switchNetwork(next: NetworkId) {
        network = next
        prefs.edit().putString("network", if (next == NetworkId.MAINNET) "mainnet" else "sepolia").apply()
        enterHome()
    }

    suspend fun addAccount() {
        val added = work { core.addAccount(network) }
        accounts = accounts + added
        selectedAccount = added.index
        refreshBalances()
    }

    suspend fun revealPhrase(password: String): List<String> = work { core.revealRecoveryPhrase(password).words }

    suspend fun deleteWallet(password: String) {
        work { core.deleteWallet(password) }
        lock()
        route = Route.WELCOME
    }

    private suspend fun enterHome() {
        accounts = runCatching { work { core.accounts(network) } }.getOrDefault(emptyList())
        if (accounts.none { it.index == selectedAccount }) selectedAccount = 0u
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

/** User-facing text for a core error. Never includes input. */
fun describe(error: Throwable): String = when (error) {
    is CoreException.WrongPassword -> "Wrong password."
    is CoreException.InvalidInput -> error.reason.replaceFirstChar { it.uppercase() } + "."
    is CoreException.WalletExists -> "A wallet already exists on this device."
    is CoreException.Locked -> "The wallet is locked."
    else -> "Something went wrong. Please try again."
}
