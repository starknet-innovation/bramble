package org.bramble.wallet

import android.content.SharedPreferences
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
import org.bramble.core.DeploymentState
import org.bramble.core.InternalException
import org.bramble.core.NetworkInfo
import org.bramble.core.SecurityStatus
import org.bramble.core.TransferPlan
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.ThemeChoice
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
    /** Non-secret preferences (network, theme); written by `WalletStoreSettings.kt`. */
    internal val prefs: SharedPreferences,
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
    internal var vaultWritten = core.status() != WalletStatus.NO_WALLET

    /** Shows the unlock screen at the core's idle deadline (the core refuses work past it anyway). */
    private var idleTimer: Job? = null

    /** Open transfer plans, closed on lock (defence in depth: the core voids them on any lock). */
    internal val plans = mutableListOf<TransferPlan>()

    /**
     * Chain reads for deployment state, deployment and activity reconciliation. HTTPS in the app;
     * instrumented tests swap in an offline fixture node before the wallet opens.
     */
    internal var rpc = RpcClient()

    /**
     * The core's judgement of the active account's deployment (`WalletStoreDeploy.kt`), for the
     * deploy notice and the privacy gates. `UNKNOWN` until read, after a lock and on account switch.
     */
    var deployment by mutableStateOf(DeploymentState.UNKNOWN)
        internal set

    /** When each pending transaction hash was last observed, so each is read once per period. */
    internal val observedAtMs = mutableMapOf<String, ULong>()

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
        internal set

    /** A transient message shown as a toast; an error unless [toastPositive]. */
    var toast by mutableStateOf<String?>(null)
        private set

    /** True when [toast] is a confirmation rather than an error. */
    var toastPositive by mutableStateOf(false)
        private set

    /** The selected network, from the non-secret `network` preference. */
    var network by mutableStateOf(NetworkPreference.fromStored(prefs.getString(NetworkPreference.KEY, null)))
        internal set

    /** The appearance choice, from the non-secret theme preference. */
    var theme by mutableStateOf(ThemeChoice.fromStored(prefs.getString(ThemeChoice.STORAGE_KEY, null)))
        internal set

    /** Lock, backoff and biometric state from the core. Passive: reading it never renews the session. */
    var security by mutableStateOf(core.securityStatus())
        internal set

    /** `elapsedRealtime` at which the next passphrase attempt is allowed; 0 when it is now. */
    var retryAtElapsedMs by mutableStateOf(0L)
        internal set

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

    // Session

    /**
     * Ends the session: wipes UI state at once on the main thread and locks the core on
     * `Dispatchers.Default`, where it may wait behind a running vault write without stalling the UI.
     * Any action still running when this is called drops its result ([SessionGuard]).
     */
    fun lock() {
        session.end()
        plans.forEach { it.cancel() }
        plans.clear()
        deployment = DeploymentState.UNKNOWN
        observedAtMs.clear()
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
            deployment = DeploymentState.UNKNOWN
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
        // A private reading belongs to one account record on one network; any other is dropped.
        // The read itself runs in `refreshBalances`, after deployment, never while entering.
        privacy.retain(network, accountState.active?.id)
    }

    /**
     * On unlock and every network switch: back to "Find your accounts" while recovery is pending
     * (never a wallet with zero accounts), else `ensureNetworkAccount` runs before anything renders.
     */
    internal suspend fun enterWallet(ticket: Long) {
        accountState = AccountsSnapshot()
        deployment = DeploymentState.UNKNOWN
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
}
