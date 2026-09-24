import BrambleCore
import Foundation
import Observation

/// UI state over the Rust `WalletCore`. Everything secret stays inside the core: this type holds
/// public account metadata, and a new recovery phrase only while onboarding shows and verifies it
/// (`pendingBackup`), cleared when onboarding finishes or the app locks.
@MainActor
@Observable
final class WalletStore {
    /// `discovery`: an imported vault still waiting for "Find your accounts" (recovery pending).
    enum Route: Equatable { case onboarding, locked, discovery, wallet }
    enum Tab: Equatable { case home, activity, settings }

    private(set) var route: Route = .onboarding
    var tab: Tab = .home
    /// Every account on the selected network, as the core renders it (name, label, type, group).
    var records: [AccountRecord] = []
    /// Every account on every network, for the groups editor.
    var allRecords: [AccountRecord] = []
    var groups: [AccountGroup] = []
    /// The active account: one for the whole vault, as in the extension. Everything that acts for
    /// an account (send, deploy, activity) names it by `activeRecord.id`, never by index.
    var activeRecord: AccountRecord?
    private(set) var balances: [String: String] = [:]
    private(set) var networkHealthy = true
    private(set) var busy = false
    /// Words of a just-created wallet; never persisted, cleared on finish or lock.
    private(set) var pendingBackup: [String] = []
    /// A transient message shown as a toast: an error unless it was raised through `notify`.
    var toast: String?
    /// The message `notify` raised last. Only while it is still the toast does the toast take the
    /// success tone, so an error assigned over a notice is always shown as an error.
    @ObservationIgnored private var notice: String?
    var toastTone: ToastTone { toast != nil && toast == notice ? .success : .error }
    /// Lock, backoff and biometric state from the core (passive; never renews the session).
    private(set) var security: SecurityStatus
    /// When the next passphrase attempt is allowed, on the monotonic clock; nil when it is now.
    private(set) var retryAt: ContinuousClock.Instant?
    /// Set when biometrics were invalidated, so the unlock screen can explain why.
    var biometricNotice: String?
    /// Fires the idle lock in the UI at the core's deadline (the core enforces it regardless).
    @ObservationIgnored private var idleTimer: Task<Void, Never>?
    /// The core's judgement of the selected account's deployment, for the home deploy notice.
    var deployment: DeploymentState = .unknown
    /// Locally recorded transactions for the selected account (WalletStore+Send.swift).
    var activity: [ActivityRecord] = []
    /// Open transfer plans, closed on lock (defence in depth: the core refuses them anyway).
    var plans: [TransferPlan] = []
    /// When each pending record was last read (ms), so reconciliation keeps the extension's cadence.
    var observedAtMs: [String: UInt64] = [:]

    var network: NetworkId {
        didSet { UserDefaults.standard.set(network == .sepolia ? "sepolia" : "mainnet", forKey: "network") }
    }

    let core: WalletCore
    let rpc = RpcClient()

    init(core: WalletCore) {
        self.core = core
        network = UserDefaults.standard.string(forKey: "network") == "sepolia" ? .sepolia : .mainnet
        security = core.securityStatus()
        route = core.status() == .noWallet ? .onboarding : .locked
        if route == .onboarding { BiometricKeychain.delete() }
        refreshSecurity()
    }

    /// Shows a confirmation (not an error) as the toast, in the success tone.
    func notify(_ message: String) {
        notice = message
        toast = message
    }

    var networkInfo: NetworkInfo {
        supportedNetworks().first { $0.network == network }!
    }

    /// The header's network label, as the side panel's `.account-network-label`.
    var networkLabel: String { network == .mainnet ? "Starknet" : "Sepolia" }

    /// The active account on the selected network.
    var account: AccountRecord? { activeRecord }

    /// Runs PBKDF2-bound core work off the main actor.
    func work<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        busy = true
        defer { busy = false }
        return try await Task.detached(priority: .userInitiated, operation: body).value
    }

    // MARK: Onboarding

    func create(password: String) async throws {
        let core = core, network = network
        pendingBackup = try await work {
            try core.createWalletOnNetwork(password: password, wordCount: 12, network: network)
        }.words
    }

    func importWallet(phrase: String, password: String) async throws {
        let core = core
        try await work { try core.importWallet(password: password, phrase: phrase, passphrase: nil) }
    }

    /// The first account of a just-created vault, for the review step.
    func previewAccount() async throws -> AccountRecord? {
        let core = core
        return try await work { try core.activeAccount() }
    }

    /// Leaves onboarding for the wallet; the backup words are dropped here.
    func finishOnboarding() async {
        pendingBackup = []
        await enterWallet()
    }

    // MARK: Session

    func unlock(password: String) async throws {
        let core = core
        do {
            try await work { try core.unlock(password: password) }
        } catch {
            refreshSecurity()
            throw error
        }
        biometricNotice = nil
        refreshSecurity()
        await enterWallet()
    }

    func lock() {
        idleTimer?.cancel()
        plans.forEach { $0.close() }
        plans = []
        observedAtMs = [:]
        deployment = .unknown
        activity = []
        core.lock()
        refreshSecurity()
        pendingBackup = []
        records = []
        allRecords = []
        groups = []
        activeRecord = nil
        balances = [:]
        tab = .home
        if core.status() != .noWallet { route = .locked }
    }

    func switchNetwork(_ next: NetworkId) async {
        network = next
        await enterWallet()
    }

    func revealPhrase(password: String) async throws -> [String] {
        let core = core
        defer { refreshSecurity(); scheduleIdleLock() }
        return try await work { try core.revealRecoveryPhrase(password: password).words }
    }

    func deleteWallet(password: String) async throws {
        let core = core
        do {
            try await work { try core.deleteWallet(password: password) }
        } catch {
            refreshSecurity()
            throw error
        }
        BiometricKeychain.delete()
        lock()
        route = .onboarding
    }

    /// Routes into the wallet: back to discovery while recovery is pending; otherwise the network
    /// switch rule (keep, pick, or project the active account) runs before anything renders.
    func enterWallet() async {
        if (try? core.recoveryPending()) == true {
            route = .discovery
            scheduleIdleLock()
            return
        }
        await reloadAccounts(ensure: true)
        route = .wallet
        scheduleIdleLock()
        await refreshBalances(reset: true)
    }

    // MARK: Security

    /// Re-reads the core's security state. Passive: never renews the idle window.
    func refreshSecurity() {
        security = core.securityStatus()
        retryAt = security.retryAfterMs > 0 ? .now + .milliseconds(Int64(security.retryAfterMs)) : nil
    }

    /// Shows the unlock screen at the core's idle deadline. The core refuses every operation past
    /// it anyway; this only keeps the screen honest.
    func scheduleIdleLock() {
        idleTimer?.cancel()
        guard let remaining = core.sessionRemainingMs() else {
            if route == .wallet || route == .discovery { lock() }
            return
        }
        idleTimer = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int64(remaining)))
            guard !Task.isCancelled, let self else { return }
            if self.core.status() == .unlocked { self.scheduleIdleLock() } else { self.lock() }
        }
    }

    /// Each time the app becomes active: clean up after a removed wallet, reconcile biometric
    /// enrolment (a real change locks and drops the slot), and apply the idle lock.
    func sceneBecameActive() {
        if core.status() == .noWallet {
            BiometricKeychain.delete()
            return
        }
        do {
            try core.reconcileBiometricDomain(domain: BiometricKeychain.domain())
        } catch CoreError.BiometricInvalidated {
            invalidateBiometric()
        } catch {}
        if (route == .wallet || route == .discovery) && core.status() != .unlocked { lock() }
        refreshSecurity()
    }

    private func invalidateBiometric() {
        BiometricKeychain.delete()
        biometricNotice = BrambleCopy.biometricInvalidated.replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)
        lock()
    }

    /// Prompts for biometrics and unlocks with the released wrap secret. A non-match, cancel or
    /// lockout returns quietly so the passphrase stays available, and keeps the slot.
    func unlockWithBiometric() async {
        guard security.biometricEnabled else { return }
        let reason = BrambleCopy.biometricPromptReason
        let read = await Task.detached(priority: .userInitiated) { await BiometricKeychain.read(reason: reason) }.value
        switch read {
        case .fallback:
            return
        case .invalidated:
            try? core.biometricInvalidated()
            invalidateBiometric()
        case .secret(let secret):
            // Wiped as soon as the core has its copy, before any suspension point.
            let unlocked = Result { try core.unlockWithBiometric(wrapSecret: secret.data) }
            secret.wipe()
            do {
                try unlocked.get()
                biometricNotice = nil
                refreshSecurity()
                await enterWallet()
            } catch CoreError.BiometricInvalidated {
                invalidateBiometric()
            } catch {
                toast = describe(error)
            }
        }
    }

    /// Re-checks the passphrase, stores a fresh wrap secret behind biometrics, and adds the slot.
    func enableBiometric(password: String) async throws {
        guard let domain = BiometricKeychain.enrolmentState() else { throw BiometricKeychain.Failure.unavailable }
        guard await BiometricKeychain.confirm(reason: BrambleCopy.biometricPromptReason) else {
            throw BiometricKeychain.Failure.cancelled
        }
        // One owner for W, wiped in place once the Keychain and the core have copied it.
        let secret = WrapSecret(try BiometricKeychain.newWrapSecret())
        defer { secret.wipe() }
        try BiometricKeychain.store(secret.data)
        let core = core
        do {
            try await work {
                try core.enableBiometricUnlock(password: password, wrapSecret: secret.data, domainState: domain)
            }
        } catch {
            BiometricKeychain.delete()
            refreshSecurity()
            throw error
        }
        refreshSecurity()
        scheduleIdleLock()
    }

    func disableBiometric() {
        try? core.disableBiometricUnlock()
        BiometricKeychain.delete()
        refreshSecurity()
    }

    /// Reads the active account's balances; `reset` first clears the previous account's figures.
    func refreshBalances(reset: Bool = false) async {
        if reset { balances = [:] }
        guard let account = activeRecord else { return }
        do {
            balances = try await rpc.balances(of: account.address, on: networkInfo)
            networkHealthy = true
        } catch {
            networkHealthy = false
        }
        await refreshSendState()
    }

    /// Base-unit balance formatted for display, or nil until it has loaded.
    func amount(of token: TokenInfo) -> String? {
        guard let raw = balances[token.symbol] else { return nil }
        return try? formatTokenAmount(raw: raw, decimals: token.decimals, maxFraction: 4)
    }
}

/// User-facing text for a core error, in the extension's wording. Never includes input.
func describe(_ error: Error) -> String {
    switch error as? CoreError {
    case .WrongPassword: BrambleCopy.incorrectPassphrase
    case .Throttled(let retryAfterMs): throttledText(ms: retryAfterMs)
    case .BiometricInvalidated: BrambleCopy.biometricInvalidated.replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)
    case .InvalidInput(let reason): reason.prefix(1).uppercased() + reason.dropFirst()
    case .WalletExists: "A wallet already exists on this device"
    case .Locked: "The wallet is locked"
    default: "Something went wrong. Try again."
    }
}

/// "Too many attempts. Try again in 1:59." for a remaining delay.
func throttledText(ms: UInt64) -> String {
    let seconds = Int((ms + 999) / 1000)
    let time = seconds >= 3600 ? "\(seconds / 3600):\(String(format: "%02d", seconds % 3600 / 60)):\(String(format: "%02d", seconds % 60))"
        : "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    return BrambleCopy.throttled.replacingOccurrences(of: "{time}", with: time)
}
