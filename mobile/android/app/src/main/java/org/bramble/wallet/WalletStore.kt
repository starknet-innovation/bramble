package org.bramble.wallet

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bramble.core.AccountInfo
import org.bramble.core.BiometricDomain
import org.bramble.core.SecurityStatus
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.security.BiometricVault

/**
 * UI state over the Rust `WalletCore`, mirroring the iOS `WalletStore`. Holds only public account
 * metadata; a recovery phrase lives here only while the backup screen is showing it.
 */
class WalletStore(
    private val core: WalletCore,
    private val prefs: SharedPreferences,
    private val biometrics: BiometricVault,
    private val scope: CoroutineScope = MainScope(),
) {
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

    /** Lock, backoff and biometric state from the core; passive, never renews the session. */
    var security by mutableStateOf(core.securityStatus())
        private set
    /** `elapsedRealtime` at which the next passphrase attempt is allowed; 0 when it is now. */
    var retryAtElapsedMs by mutableStateOf(0L)
        private set
    var biometricNotice by mutableStateOf<String?>(null)
        private set
    private var idleTimer: Job? = null

    val biometricsAvailable: Boolean get() = biometrics.available
    val keyStorageLabel: String
        get() = if (biometrics.strongBox) BrambleCopy.keyStorageStrongBox else BrambleCopy.keyStorageSecureHardware

    init {
        if (route == Route.WELCOME) biometrics.delete()
        refreshSecurity()
    }

    fun refreshSecurity() {
        security = core.securityStatus()
        val retry = security.retryAfterMs.toLong()
        retryAtElapsedMs = if (retry > 0) SystemClock.elapsedRealtime() + retry else 0L
    }

    /** Shows the lock screen at the core's idle deadline; the core enforces it regardless. */
    private fun scheduleIdleLock() {
        idleTimer?.cancel()
        val remaining = core.sessionRemainingMs() ?: return lock()
        idleTimer = scope.launch {
            delay(remaining.toLong())
            if (core.status() == WalletStatus.UNLOCKED) scheduleIdleLock() else lock()
        }
    }

    /** On every foreground: tidy after removal, check Keystore invalidation, apply the idle lock. */
    fun onForeground() {
        if (core.status() == WalletStatus.NO_WALLET) {
            biometrics.delete()
            return
        }
        // Android has no domain-state API: reconcile is a no-op (`Unavailable`); only a
        // permanently invalidated key drops the slot.
        runCatching { core.reconcileBiometricDomain(BiometricDomain.Unavailable) }
        if (security.biometricEnabled && biometrics.invalidated()) invalidateBiometric()
        if (route == Route.HOME && core.status() != WalletStatus.UNLOCKED) lock()
        refreshSecurity()
    }

    private fun invalidateBiometric() {
        runCatching { core.biometricInvalidated() }
        biometrics.delete()
        biometricNotice = BrambleCopy.biometricInvalidated.replace("{biometry}", "Fingerprint")
        lock()
    }

    /** Prompts, then unlocks with the released secret. Non-match, cancel, lockout: stay put. */
    suspend fun unlockWithBiometric(activity: Context) {
        if (!security.biometricEnabled) return
        when (val read = biometrics.read(activity, BrambleCopy.biometricPromptReason)) {
            BiometricVault.Read.Fallback -> Unit
            BiometricVault.Read.Invalidated -> invalidateBiometric()
            is BiometricVault.Read.Secret -> try {
                core.unlockWithBiometric(read.bytes)
                biometricNotice = null
                refreshSecurity()
                enterHome()
            } catch (_: CoreException.BiometricInvalidated) {
                invalidateBiometric()
            } finally {
                read.bytes.fill(0)
            }
        }
    }

    /** Re-checks the passphrase in the core, then stores a fresh W behind a biometric key. */
    suspend fun enableBiometric(activity: Context, password: String) {
        val secret = biometrics.newWrapSecret()
        try {
            if (!biometrics.store(activity, secret, BrambleCopy.biometricPromptReason)) return
            try {
                work { core.enableBiometricUnlock(password, secret, null) }
            } catch (error: Throwable) {
                biometrics.delete()
                throw error
            }
        } finally {
            secret.fill(0)
            refreshSecurity()
        }
        scheduleIdleLock()
    }

    fun disableBiometric() {
        runCatching { core.disableBiometricUnlock() }
        biometrics.delete()
        refreshSecurity()
    }

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
        try {
            work { core.unlock(password) }
        } finally {
            refreshSecurity()
        }
        biometricNotice = null
        enterHome()
    }

    fun lock() {
        idleTimer?.cancel()
        core.lock()
        refreshSecurity()
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
        scheduleIdleLock()
        accounts = accounts + added
        selectedAccount = added.index
        refreshBalances()
    }

    suspend fun revealPhrase(password: String): List<String> =
        try {
            work { core.revealRecoveryPhrase(password).words }
        } finally {
            refreshSecurity()
        }

    suspend fun deleteWallet(password: String) {
        try {
            work { core.deleteWallet(password) }
        } finally {
            refreshSecurity()
        }
        biometrics.delete()
        lock()
        route = Route.WELCOME
    }

    private suspend fun enterHome() {
        accounts = runCatching { work { core.accounts(network) } }.getOrDefault(emptyList())
        if (accounts.none { it.index == selectedAccount }) selectedAccount = 0u
        route = Route.HOME
        scheduleIdleLock()
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
    is CoreException.WrongPassword -> BrambleCopy.incorrectPassphrase
    is CoreException.Throttled -> throttledText(error.retryAfterMs.toLong())
    is CoreException.InvalidInput -> error.reason.replaceFirstChar { it.uppercase() } + "."
    is CoreException.WalletExists -> "A wallet already exists on this device."
    is CoreException.Locked -> "The wallet is locked."
    else -> "Something went wrong. Please try again."
}

/** "Too many attempts. Try again in 1:59." for a remaining delay. */
fun throttledText(ms: Long): String {
    val seconds = (ms + 999) / 1000
    val time = if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds % 3600 / 60, seconds % 60)
    else "%d:%02d".format(seconds / 60, seconds % 60)
    return BrambleCopy.throttled.replace("{time}", time)
}
