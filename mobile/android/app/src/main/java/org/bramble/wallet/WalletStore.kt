package org.bramble.wallet

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bramble.core.AccountGroup
import org.bramble.core.AccountRecord
import org.bramble.core.BiometricDomain
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.SecurityStatus
import org.bramble.core.TokenInfo
import org.bramble.core.TransferPlan
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.ThemeChoice
import org.bramble.wallet.send.SendFlowModel
import org.bramble.wallet.security.BiometricVault

/**
 * UI state over the Rust `WalletCore`, mirroring the iOS `WalletStore`. Everything secret stays in
 * the core: this holds public account metadata, and a new recovery phrase only while onboarding
 * shows and verifies it ([pendingBackup]), cleared when onboarding finishes or the app locks.
 * The biometric wrap secret passes through only inside [unlockWithBiometric] and
 * [enableBiometric], and is zero-filled before they return.
 *
 * Main-thread only. Core calls run on `Dispatchers.Default`; every action checks its
 * [SessionGuard] ticket after each call, so a lock that lands while PBKDF2 is running wins: the
 * late result is dropped and the core is locked again (see `docs/android-parity.md`, T3). The core
 * enforces backoff and the idle lock itself (`docs/vault-security.md` §4); the store only mirrors
 * them so the screens stay honest.
 */
class WalletStore(
    private val core: WalletCore,
    private val prefs: SharedPreferences,
    private val biometrics: BiometricVault,
    /** Main-thread scope that outlives screens: background locks, the idle timer, clipboard expiry. */
    val appScope: CoroutineScope,
) {
    private val session = SessionGuard()
    private val book = Balances()
    /** For the discovery scan's sans-IO steps (`RecoveryScanDriver`); restoring goes through [accountCall]. */
    internal val walletCore: WalletCore get() = core
    /** Whether a vault exists on disk, tracked here so `lock()` never waits on the core mutex. */
    private var vaultWritten = core.status() != WalletStatus.NO_WALLET
    private var pendingLock: Job? = null
    /** Shows the unlock screen at the core's idle deadline (the core refuses work past it anyway). */
    private var idleTimer: Job? = null
    /** Open transfer plans, closed on lock (defence in depth: the core voids them on any lock). */
    private val plans = mutableListOf<TransferPlan>()

    var route by mutableStateOf(if (vaultWritten) Route.LOCKED else Route.ONBOARDING)
        private set
    var tab by mutableStateOf(Tab.HOME)
    /** The account state as last read from the core; emptied on lock and before each entry. */
    private var accountState by mutableStateOf(AccountsSnapshot())
    /** This network's accounts as the core renders them (name, label, type, group). */
    val records: List<AccountRecord> get() = accountState.records
    /** Every network's accounts, for group membership lists. */
    val allRecords: List<AccountRecord> get() = accountState.allRecords
    val groups: List<AccountGroup> get() = accountState.groups
    /** The vault's one active account (on this network once [enterWallet] has run); signing uses its id. */
    val activeRecord: AccountRecord? get() = accountState.active
    /**
     * Bumped when a lock lands before any vault exists. Root keys the onboarding flow on it, so a
     * typed recovery phrase or passphrase is disposed with the flow instead of surviving the lock.
     */
    var onboardingGeneration by mutableStateOf(0)
        private set
    val networkHealthy: Boolean get() = book.networkHealthy
    var busy by mutableStateOf(false)
        private set
    /** Words of a just-created wallet; never persisted, cleared on finish or lock. */
    var pendingBackup by mutableStateOf(emptyList<String>())
        private set
    /** A transient message shown as a toast; an error unless [toastPositive]. */
    var toast by mutableStateOf<String?>(null)
        private set
    var toastPositive by mutableStateOf(false)
        private set
    var network by mutableStateOf(NetworkPreference.fromStored(prefs.getString(NetworkPreference.KEY, null)))
        private set
    var theme by mutableStateOf(ThemeChoice.fromStored(prefs.getString(ThemeChoice.STORAGE_KEY, null)))
        private set
    /** Lock, backoff and biometric state from the core. Passive: reading it never renews the session. */
    var security by mutableStateOf(core.securityStatus())
        private set
    /** `elapsedRealtime` at which the next passphrase attempt is allowed; 0 when it is now. */
    var retryAtElapsedMs by mutableStateOf(0L)
        private set
    /** Set when biometrics were invalidated, so the unlock screen can say why. */
    var biometricNotice by mutableStateOf<String?>(null)
        private set

    init {
        // A Keystore key or wrap-secret file left by a removed wallet is useless: drop it.
        if (!vaultWritten) biometrics.delete()
        applySecurity(security)
    }

    /** Wallet card, contacts, shared accounts, and Nostr coordination (public state only). */
    val coordination = org.bramble.wallet.coordination.CoordinationStore(core) { networkInfo }

    val networkInfo: NetworkInfo get() = supportedNetworks().first { it.network == network }
    val networkLabel: String get() = NetworkPreference.label(network)
    /** Whether a strong biometric is enrolled and usable on this device now. */
    val biometricsAvailable: Boolean get() = biometrics.available
    val keyStorageLabel: String
        get() = if (biometrics.strongBox) BrambleCopy.keyStorageStrongBox else BrambleCopy.keyStorageSecureHardware

    /** Milliseconds until a passphrase attempt is allowed, for countdowns; 0 when it is now. */
    fun retryRemainingMs(now: Long = SystemClock.elapsedRealtime()): Long = (retryAtElapsedMs - now).coerceAtLeast(0L)

    /** Shows [error] as a toast, unless it only reports that a lock overtook the call. */
    fun showError(error: Throwable) {
        if (error !is CancellationException) showToast(describe(error))
    }

    /** Shows a fixed [message]: an error by default, or a confirmation when [positive]. */
    fun showToast(message: String, positive: Boolean = false) {
        toastPositive = positive
        toast = message
    }

    /** A confirmation toast, such as "Clipboard cleared". */
    fun showNotice(message: String) = showToast(message, positive = true)

    fun dismissToast() {
        toast = null
    }

    /** Runs one core call off the main thread, for the action holding [ticket]. */
    private suspend fun <T> work(ticket: Long, body: () -> T): T {
        pendingLock?.join()
        busy = true
        try {
            val result = try {
                withContext(Dispatchers.Default) { body() }
            } catch (error: Throwable) {
                // A call the lock overtook fails as a lock, whatever the core said (it refuses to
                // install a session after `lock()`, so a late unlock reports `Locked`).
                ensureCurrent(ticket)
                throw error
            }
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
            val (exists, status) = withContext(Dispatchers.Default) {
                core.lock()
                (core.status() != WalletStatus.NO_WALLET) to core.securityStatus()
            }
            vaultWritten = exists
            applySecurity(status)
            // A create or import that finished after the lock has written a vault: go to unlock.
            if (route == Route.ONBOARDING && exists) route = Route.LOCKED
            // A removal that finished after the lock has deleted it: back to first run.
            if (route == Route.LOCKED && !exists) {
                biometrics.delete()
                route = Route.ONBOARDING
            }
        }
        throw SessionEndedException()
    }

    // Onboarding

    suspend fun create(password: String) {
        val ticket = session.ticket()
        val network = network
        val words = work(ticket) { core.createWalletOnNetwork(password, 12u, network) }.words
        vaultWritten = true
        pendingBackup = words
    }

    /** Writes the vault with recovery pending and no accounts; "Find your accounts" comes next. */
    suspend fun importWallet(phrase: String, password: String) {
        val ticket = session.ticket()
        work(ticket) { core.importWallet(password, phrase, null) }
        vaultWritten = true
    }

    /** Leaves onboarding (or "Find your accounts") for the wallet; the backup words are dropped here. */
    suspend fun finishOnboarding() {
        pendingBackup = emptyList()
        enterWallet(session.ticket())
    }

    // Session

    /** One throttled, counted passphrase attempt in the core; the countdown is refreshed either way. */
    suspend fun unlock(password: String) {
        val ticket = session.ticket()
        try {
            work(ticket) { core.unlock(password) }
        } finally {
            refreshSecurity()
        }
        biometricNotice = null
        enterWallet(ticket)
    }

    /**
     * Ends the session: wipes UI state at once on the main thread and locks the core on
     * `Dispatchers.Default`, where it may wait behind a running vault write without stalling the UI.
     * Any action still running when this is called drops its result ([SessionGuard]).
     */
    fun lock() {
        session.end()
        plans.forEach { it.close() }
        plans.clear()
        idleTimer?.cancel()
        idleTimer = null
        coordination.reset()
        pendingBackup = emptyList()
        accountState = AccountsSnapshot()
        clearBalances()
        tab = Tab.HOME
        if (!vaultWritten) onboardingGeneration += 1
        route = if (vaultWritten) Route.LOCKED else Route.ONBOARDING
        pendingLock = appScope.launch {
            val status = withContext(Dispatchers.Default) {
                core.lock()
                core.securityStatus()
            }
            applySecurity(status)
        }
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

    /** One account call (WalletAccounts.kt) for this session, then with [reload] a fresh read of accounts and balances. */
    internal suspend fun <T> accountCall(reload: Boolean = true, body: (WalletCore) -> T): T {
        val ticket = session.ticket()
        val before = activeRecord?.id
        val result = work(ticket) { body(core) }
        scheduleIdleLock()
        if (!reload) return result
        reloadAccounts(ticket, ensure = false)
        if (activeRecord?.id != before) {
            clearBalances()
            refreshBalances(ticket)
        }
        return result
    }

    /** Re-reads records and groups; with [ensure], first keeps, picks or projects this network's active account. */
    private suspend fun reloadAccounts(ticket: Long, ensure: Boolean) {
        val network = network
        accountState = work(ticket) {
            if (ensure) core.ensureNetworkAccount(network)
            AccountsSnapshot(core.accountRecords(network), core.allAccountRecords(), core.accountGroups())
        }
    }

    /** Re-checks the password in the core (throttled; biometrics never reveal) and returns the phrase for display only. */
    suspend fun revealPhrase(password: String): List<String> {
        val ticket = session.ticket()
        val words = try {
            work(ticket) { core.revealRecoveryPhrase(password) }.words
        } finally {
            refreshSecurity()
        }
        scheduleIdleLock()
        return words
    }

    suspend fun deleteWallet(password: String) {
        val ticket = session.ticket()
        try {
            work(ticket) { core.deleteWallet(password) }
        } finally {
            refreshSecurity()
        }
        vaultWritten = false
        biometrics.delete()
        lock()
    }

    /**
     * On unlock and every network switch: back to "Find your accounts" while recovery is pending
     * (never a wallet with zero accounts), else `ensureNetworkAccount` runs before anything renders.
     */
    private suspend fun enterWallet(ticket: Long) {
        accountState = AccountsSnapshot()
        if (work(ticket) { core.recoveryPending() }) {
            route = Route.DISCOVERY
            scheduleIdleLock()
            return
        }
        try {
            reloadAccounts(ticket, ensure = true)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            showError(error)
        }
        route = Route.WALLET
        scheduleIdleLock()
        refreshBalances(ticket)
    }

    // Security (docs/vault-security.md)

    /** Re-reads the core's security state. Passive: never renews the idle window. */
    fun refreshSecurity() = applySecurity(core.securityStatus())

    private fun applySecurity(status: SecurityStatus) {
        security = status
        val retry = status.retryAfterMs.toLong()
        retryAtElapsedMs = if (retry > 0) SystemClock.elapsedRealtime() + retry else 0L
    }

    /** Shows the unlock screen at the core's idle deadline; the core enforces it regardless. */
    private fun scheduleIdleLock() {
        idleTimer?.cancel()
        val remaining = core.sessionRemainingMs()
        if (remaining == null) {
            if (route.unlocked) lock()
            return
        }
        idleTimer = appScope.launch {
            delay(remaining.toLong())
            if (core.status() == WalletStatus.UNLOCKED) scheduleIdleLock() else lock()
        }
    }

    /**
     * Each time the app comes to the foreground: tidy up after a removed wallet, drop the slot if
     * the Keystore key was invalidated by an enrolment change, and apply the idle lock. Android
     * has no domain-state API, so reconciling reports `Unavailable`, which never drops a slot.
     */
    fun onForeground() {
        if (core.status() == WalletStatus.NO_WALLET) {
            biometrics.delete()
            return
        }
        refreshSecurity()
        try {
            core.reconcileBiometricDomain(BiometricDomain.Unavailable)
        } catch (ignored: CoreException.BiometricInvalidated) {
            invalidateBiometric()
        } catch (ignored: CoreException) {
        }
        if (security.biometricEnabled && biometrics.invalidated()) invalidateBiometric()
        if (route.unlocked && core.status() != WalletStatus.UNLOCKED) lock()
        refreshSecurity()
    }

    /** A real enrolment change: the core locks and drops the slot, the Keystore key goes too. */
    private fun invalidateBiometric() {
        runCatching { core.biometricInvalidated() }
        biometrics.delete()
        biometricNotice = securityCopy(BrambleCopy.biometricInvalidated)
        lock()
    }

    /**
     * Prompts for a strong biometric and unlocks with the released wrap secret. A non-match,
     * cancel or lockout returns quietly so the passphrase stays available, and keeps the slot.
     * Other failures show as a toast; a lock during the prompt wins ([SessionGuard]).
     */
    suspend fun unlockWithBiometric(activity: Context) {
        refreshSecurity()
        if (!security.biometricEnabled || busy) return
        val ticket = session.ticket()
        val read = try {
            biometrics.read(activity, BrambleCopy.biometricPromptReason)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (ignored: Exception) {
            BiometricVault.Read.Fallback
        }
        when (read) {
            BiometricVault.Read.Fallback -> Unit
            BiometricVault.Read.Invalidated -> invalidateBiometric()
            is BiometricVault.Read.Secret -> {
                try {
                    if (!session.isCurrent(ticket)) return
                    work(ticket) { core.unlockWithBiometric(read.bytes) }
                } catch (ignored: CoreException.BiometricInvalidated) {
                    invalidateBiometric()
                    return
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    showError(error)
                    return
                } finally {
                    read.bytes.fill(0)
                }
                biometricNotice = null
                refreshSecurity()
                enterWallet(ticket)
            }
        }
    }

    /**
     * Stores a fresh wrap secret behind a biometric-bound Keystore key (after a prompt), then has
     * the core re-check [password] (throttled and counted) and add the slot. Returns false when
     * the person cancelled the prompt. The secret is zero-filled before this returns.
     */
    suspend fun enableBiometric(activity: Context, password: String): Boolean {
        val ticket = session.ticket()
        val secret = biometrics.newWrapSecret()
        try {
            if (!biometrics.store(activity, secret, BrambleCopy.biometricPromptReason)) return false
            try {
                work(ticket) { core.enableBiometricUnlock(password, secret, null) }
            } catch (error: Throwable) {
                // Keep the key only if the core holds a slot for it (a lock can overtake a success).
                refreshSecurity()
                if (!security.biometricEnabled) biometrics.delete()
                throw error
            }
        } finally {
            secret.fill(0)
            refreshSecurity()
        }
        scheduleIdleLock()
        return true
    }

    /** Removes the slot; needs no key, so it works in any state. */
    fun disableBiometric() {
        runCatching { core.disableBiometricUnlock() }
        biometrics.delete()
        refreshSecurity()
    }

    // Send

    /**
     * A Send journey for the active account, with balances of this view only. Null while locked
     * and for an account the core will not sign for ([sendRefusal]: Braavos, Ready).
     */
    fun makeSendModel(): SendFlowModel? {
        val account = activeRecord ?: return null
        if (sendRefusal(account) != null) return null
        val current = book.of(currentView())
        return SendFlowModel(core, networkInfo, account, records.filter { it.id != account.id }, current, { plans += it }) { message, success ->
            showToast(message, positive = success)
        }
    }

    // Balances

    private fun clearBalances() = book.clear()

    private fun currentView(): BalanceView? = activeRecord?.let { network to it.address }

    /** Reads public balances for the active account; a late result is dropped ([Balances]). */
    suspend fun refreshBalances(ticket: Long = session.ticket()) {
        val view = currentView() ?: return
        book.refresh(view, networkInfo) { session.isCurrent(ticket) && currentView() == view }
    }

    /** Base-unit balance formatted for display, or null until it has loaded for this view. */
    fun amount(token: TokenInfo): String? = book.amount(token, currentView())

    /** Core lifecycle state, for tests and diagnostics. Takes the core's session mutex. */
    internal fun coreStatus(): WalletStatus = core.status()
}
