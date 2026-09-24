package org.bramble.wallet

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
import org.bramble.core.CoreException
import org.bramble.core.InternalException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.SecurityStatus
import org.bramble.core.TransferPlan
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.ThemeChoice
import org.bramble.wallet.portfolio.rawBalances
import org.bramble.wallet.security.BiometricVault
import org.bramble.wallet.send.SendFlowModel
import org.bramble.wallet.send.SendHooks

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
    /** The biometric slot's Keystore half; used by this file and `WalletStoreBiometrics.kt` only. */
    internal val biometrics: BiometricVault,
    /** Main-thread scope that outlives screens: background locks, the idle timer, clipboard expiry. */
    val appScope: CoroutineScope,
    /** Where the portfolio's public caches live (`noBackupFilesDir/portfolio`). */
    portfolioDirectory: java.io.File,
) {
    /** The lock epoch every action checks; shared with `WalletStoreBiometrics.kt`. */
    internal val session = SessionGuard()

    /** Runs core calls off the main thread under [session]; shared with `WalletStoreBiometrics.kt`. */
    internal val calls = CoreCalls(core, appScope, session, ::relocked)

    /**
     * Prices, tracked tokens, the one balance read, and the account's one activity list (the core's
     * log), for Home, Activity and Send (mobile/docs/portfolio-activity.md).
     */
    val portfolio =
        org.bramble.wallet.portfolio
            .PortfolioStore(portfolioDirectory, core.activityBook())

    /** For the discovery scan's sans-IO steps (`RecoveryScanDriver`); restoring goes through [accountCall]. */
    internal val walletCore: WalletCore get() = core

    /** Whether a vault exists on disk, tracked here so `lock()` never waits on the core mutex. */
    private var vaultWritten = core.status() != WalletStatus.NO_WALLET

    /** Shows the unlock screen at the core's idle deadline (the core refuses work past it anyway). */
    private var idleTimer: Job? = null

    /** Open transfer plans, closed on lock (defence in depth: the core voids them on any lock). */
    private val plans = mutableListOf<TransferPlan>()

    /** The top-level screen; in memory only, and back to [Route.LOCKED] on every lock. */
    var route by mutableStateOf(if (vaultWritten) Route.LOCKED else Route.ONBOARDING)
        private set

    /** The selected dock tab; reset to Home on lock. */
    var tab by mutableStateOf(Tab.HOME)

    /** The account state as last read from the core; emptied on lock and before each entry. */
    private var accountState by mutableStateOf(AccountsSnapshot())

    /** This network's accounts as the core renders them (name, label, type, group). */
    val records: List<AccountRecord> get() = accountState.records

    /** Every network's accounts, for group membership lists. */
    val allRecords: List<AccountRecord> get() = accountState.allRecords

    /** The vault's account groups (folders), as last read from the core. */
    val groups: List<AccountGroup> get() = accountState.groups

    /** The vault's one active account (on this network once [enterWallet] has run); signing uses its id. */
    val activeRecord: AccountRecord? get() = accountState.active

    /**
     * Bumped when a lock lands before any vault exists. Root keys the onboarding flow on it, so a
     * typed recovery phrase or passphrase is disposed with the flow instead of surviving the lock.
     */
    var onboardingGeneration by mutableStateOf(0)
        private set

    /** False while the portfolio's last balance read failed. */
    val networkHealthy: Boolean get() = portfolio.balanceError == null

    /** True while a core call runs ([CoreCalls]); the screens disable their actions on it. */
    val busy: Boolean get() = calls.busy

    /** Words of a just-created wallet; never persisted, cleared on finish or lock. */
    var pendingBackup by mutableStateOf(emptyList<String>())
        private set

    /** A transient message shown as a toast; an error unless [toastPositive]. */
    var toast by mutableStateOf<String?>(null)
        private set

    /** True when [toast] is a confirmation rather than an error. */
    var toastPositive by mutableStateOf(false)
        private set

    /** The selected network, from the non-secret `network` preference. */
    var network by mutableStateOf(NetworkPreference.fromStored(prefs.getString(NetworkPreference.KEY, null)))
        private set

    /** The appearance choice, from the non-secret theme preference. */
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
        internal set

    init {
        // A Keystore key or wrap-secret file left by a removed wallet is useless: drop it.
        if (!vaultWritten) biometrics.delete()
        applySecurity(security)
    }

    /** Wallet card, contacts, shared accounts, and Nostr coordination (public state only). */
    val coordination =
        org.bramble.wallet.coordination
            .CoordinationStore(core) { networkInfo }

    /** The active account's private-balance reading (docs/privacy.md); never persisted. */
    val privacy =
        org.bramble.wallet.privacy
            .PrivacyModel()

    /** The core's bundled description of [network] (endpoints, tokens, explorer). */
    val networkInfo: NetworkInfo get() = supportedNetworks().first { it.network == network }

    /** The header's network label ("Starknet" or "Sepolia"). */
    val networkLabel: String get() = NetworkPreference.label(network)

    /** Whether a strong biometric is enrolled and usable on this device now. */
    val biometricsAvailable: Boolean get() = biometrics.available

    /** Where the biometric key lives (StrongBox or the TEE), for the Security screen. */
    val keyStorageLabel: String
        get() = if (biometrics.strongBox) BrambleCopy.keyStorageStrongBox else BrambleCopy.keyStorageSecureHardware

    /** Milliseconds until a passphrase attempt is allowed, for countdowns; 0 when it is now. */
    fun retryRemainingMs(now: Long = SystemClock.elapsedRealtime()): Long = (retryAtElapsedMs - now).coerceAtLeast(0L)

    /** Shows [error] as a toast, unless it only reports that a lock overtook the call. */
    fun showError(error: Throwable) {
        if (error !is CancellationException) showToast(describe(error))
    }

    /** Shows a fixed [message]: an error by default, or a confirmation when [positive]. */
    fun showToast(
        message: String,
        positive: Boolean = false,
    ) {
        toastPositive = positive
        toast = message
    }

    /** A confirmation toast, such as "Clipboard cleared". */
    fun showNotice(message: String) = showToast(message, positive = true)

    /** Hides the current toast. */
    fun dismissToast() {
        toast = null
    }

    /** Applies a lock that overtook a running call ([CoreCalls]), once the core is locked again. */
    private fun relocked(
        exists: Boolean,
        status: SecurityStatus,
    ) {
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

    // Onboarding

    /**
     * Writes a new vault with a 12-word phrase on this network and keeps the words in
     * [pendingBackup] for the backup steps. Throws the core's error (or [SessionEndedException]).
     */
    suspend fun create(password: String) {
        val ticket = session.ticket()
        val network = network
        val words = calls.work(ticket) { core.createWalletOnNetwork(password, 12u, network) }.words
        vaultWritten = true
        pendingBackup = words
    }

    /** Writes the vault with recovery pending and no accounts; "Find your accounts" comes next. */
    suspend fun importWallet(
        phrase: String,
        password: String,
    ) {
        val ticket = session.ticket()
        calls.work(ticket) { core.importWallet(password, phrase, null) }
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
            calls.work(ticket) { core.unlock(password) }
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
        privacy.reset()
        pendingBackup = emptyList()
        accountState = AccountsSnapshot()
        portfolio.lock()
        tab = Tab.HOME
        if (!vaultWritten) onboardingGeneration += 1
        route = if (vaultWritten) Route.LOCKED else Route.ONBOARDING
        calls.pendingLock =
            appScope.launch {
                val status =
                    withContext(Dispatchers.Default) {
                        core.lock()
                        core.securityStatus()
                    }
                applySecurity(status)
            }
    }

    /** Switches to [next], remembers it, and re-enters the wallet on it (accounts, balances). */
    suspend fun switchNetwork(next: NetworkId) {
        privacy.reset()
        network = next
        portfolio.lock()
        prefs.edit().putString(NetworkPreference.KEY, NetworkPreference.stored(next)).apply()
        enterWallet(session.ticket())
    }

    /** Applies and remembers the appearance [choice]. */
    fun setTheme(choice: ThemeChoice) {
        theme = choice
        prefs.edit().putString(ThemeChoice.STORAGE_KEY, choice.stored).apply()
    }

    /**
     * One account call (WalletAccounts.kt) for this session, then with [reload] a fresh read of
     * accounts and balances.
     */
    internal suspend fun <T> accountCall(
        reload: Boolean = true,
        body: (WalletCore) -> T,
    ): T {
        val ticket = session.ticket()
        val before = activeRecord?.id
        val result = calls.work(ticket) { body(core) }
        scheduleIdleLock()
        if (!reload) return result
        reloadAccounts(ticket, ensure = false)
        if (activeRecord?.id != before) {
            portfolio.lock()
            refreshBalances(ticket)
        }
        return result
    }

    /** Re-reads records and groups; with [ensure], first keeps, picks or projects this network's active account. */
    private suspend fun reloadAccounts(
        ticket: Long,
        ensure: Boolean,
    ) {
        val network = network
        accountState =
            calls.work(ticket) {
                if (ensure) core.ensureNetworkAccount(network)
                AccountsSnapshot(core.accountRecords(network), core.allAccountRecords(), core.accountGroups())
            }
        account?.let { privacy.refresh(core, networkInfo, it.index) }
    }

    /**
     * Re-checks the password in the core (throttled; biometrics never reveal) and returns the
     * phrase for display only.
     */
    suspend fun revealPhrase(password: String): List<String> {
        val ticket = session.ticket()
        val words =
            try {
                calls.work(ticket) { core.revealRecoveryPhrase(password) }.words
            } finally {
                refreshSecurity()
            }
        scheduleIdleLock()
        return words
    }

    /**
     * Removes the vault after the core re-checks [password] (throttled), then the biometric key,
     * the session and the portfolio caches. Throws the core's error; nothing is removed then.
     */
    suspend fun deleteWallet(password: String) {
        val ticket = session.ticket()
        try {
            calls.work(ticket) { core.deleteWallet(password) }
        } finally {
            refreshSecurity()
        }
        vaultWritten = false
        biometrics.delete()
        lock()
        portfolio.deleteFiles()
    }

    /**
     * On unlock and every network switch: back to "Find your accounts" while recovery is pending
     * (never a wallet with zero accounts), else `ensureNetworkAccount` runs before anything renders.
     */
    internal suspend fun enterWallet(ticket: Long) {
        accountState = AccountsSnapshot()
        if (calls.work(ticket) { core.recoveryPending() }) {
            route = Route.DISCOVERY
            scheduleIdleLock()
            return
        }
        try {
            reloadAccounts(ticket, ensure = true)
        } catch (error: CoreException) {
            showError(error)
        } catch (error: InternalException) {
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
    internal fun scheduleIdleLock() {
        idleTimer?.cancel()
        val remaining = core.sessionRemainingMs()
        if (remaining == null) {
            if (route.unlocked) lock()
            return
        }
        idleTimer =
            appScope.launch {
                delay(remaining.toLong())
                if (core.status() == WalletStatus.UNLOCKED) scheduleIdleLock() else lock()
            }
    }

    // Send

    /**
     * A Send journey for the active account, with balances of this view only. Null while locked
     * and for an account the core will not sign for ([sendRefusal]: Braavos, Ready).
     */
    fun makeSendModel(): SendFlowModel? {
        val account = activeRecord?.takeIf { sendRefusal(it) == null } ?: return null
        val current = portfolio.rawBalances(networkInfo)
        return SendFlowModel(
            core,
            networkInfo,
            account,
            records.filter {
                it.id != account.id
            },
            current,
            SendHooks(track = { plans += it }) { message, success ->
                showToast(message, positive = success)
            },
        )
    }

    /**
     * Balances through the portfolio (the one read; a new scope serves saved figures first), then
     * privacy.
     */
    suspend fun refreshBalances(ticket: Long = session.ticket()) {
        val account = activeRecord ?: return
        if (!session.isCurrent(ticket)) return
        if (portfolio.scope?.accountId !=
            account.id
        ) {
            portfolio.load(account, networkInfo)
        } else {
            portfolio.refresh(force = true)
        }
        privacy.retain(network, account.id) // one reading per account record, fed into Home's rows
        privacy.refresh(core, networkInfo, account.id)
        portfolio.setPrivacy(privacy.reading, privacy.state)
    }

    internal fun coreStatus(): WalletStatus = core.status() // tests and diagnostics; takes the session mutex
}
