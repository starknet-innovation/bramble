import BrambleCore
import Foundation
import Observation

/// Fixed parameters of the store's core calls.
private enum WalletDefaults {
    /// Words in a newly created recovery phrase.
    static let newPhraseWordCount: UInt8 = 12
    /// Fraction digits shown for a formatted token balance.
    static let balanceFractionDigits: UInt8 = 4
}

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
    /// Open transfer plans, closed on lock (defence in depth: the core refuses them anyway).
    var plans: [TransferPlan] = []
    /// When each observed record was last read (ms), so reconciliation keeps the extension's cadence.
    var observedAtMs: [String: UInt64] = [:]
    /// Ticks `observeActivity` while the wallet is open (WalletStore+Send.swift); cancelled on lock.
    @ObservationIgnored var observationTicker: Task<Void, Never>?
    /// The selected account's private-balance reading (WalletStore+Privacy.swift); never persisted.
    let privacy = PrivacyModel()

    var network: NetworkId {
        didSet { UserDefaults.standard.set(network == .sepolia ? "sepolia" : "mainnet", forKey: "network") }
    }

    let core: WalletCore
    let rpc = RpcClient()
    /// Wallet card, contacts, shared accounts, and Nostr coordination (public state only).
    @ObservationIgnored private(set) lazy var coordination = CoordinationStore(wallet: self)
    /// Prices, tracked tokens, balances, and the account's one activity list (the core's log),
    /// for Home, Activity and Send (mobile/docs/portfolio-activity.md).
    let portfolio: PortfolioStore

    init(core: WalletCore) {
        self.core = core
        portfolio = PortfolioStore(activity: core.activityBook())
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
        guard let info = supportedNetworks().first(where: { $0.network == network }) else {
            preconditionFailure("the core supports every NetworkId")
        }
        return info
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
        let walletCore = core, selected = network
        pendingBackup = try await work {
            try walletCore.createWalletOnNetwork(
                password: password,
                wordCount: WalletDefaults.newPhraseWordCount,
                network: selected
            )
        }.words
    }

    func importWallet(phrase: String, password: String) async throws {
        let walletCore = core
        try await work { try walletCore.importWallet(password: password, phrase: phrase, passphrase: nil) }
    }

    /// The first account of a just-created vault, for the review step.
    func previewAccount() async throws -> AccountRecord? {
        let walletCore = core
        return try await work { try walletCore.activeAccount() }
    }

    /// Leaves onboarding for the wallet; the backup words are dropped here.
    func finishOnboarding() async {
        pendingBackup = []
        await enterWallet()
    }

    // MARK: Session

    func unlock(password: String) async throws {
        let walletCore = core
        do {
            try await work { try walletCore.unlock(password: password) }
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
        observationTicker?.cancel()
        observationTicker = nil
        privacy.reset()
        plans.forEach { $0.close() }
        plans = []
        observedAtMs = [:]
        deployment = .unknown
        core.lock()
        refreshSecurity()
        coordination.reset()
        portfolio.lock()
        pendingBackup = []
        records = []
        allRecords = []
        groups = []
        activeRecord = nil
        tab = .home
        if core.status() != .noWallet { route = .locked }
    }

    func switchNetwork(_ next: NetworkId) async {
        privacy.reset()
        network = next
        await enterWallet()
    }

    func revealPhrase(password: String) async throws -> [String] {
        let walletCore = core
        defer { refreshSecurity(); scheduleIdleLock() }
        return try await work { try walletCore.revealRecoveryPhrase(password: password).words }
    }

    func deleteWallet(password: String) async throws {
        let walletCore = core
        do {
            try await work { try walletCore.deleteWallet(password: password) }
        } catch {
            refreshSecurity()
            throw error
        }
        BiometricKeychain.delete()
        lock()
        portfolio.deleteFiles()
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
        startActivityObservation()
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
            if core.status() == .unlocked { scheduleIdleLock() } else { lock() }
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
        } catch {
            // Any other failure leaves the biometric slot as it is; the core still guards unlock.
        }
        if route == .wallet || route == .discovery, core.status() != .unlocked { lock() }
        refreshSecurity()
    }

    private func invalidateBiometric() {
        BiometricKeychain.delete()
        biometricNotice = BrambleCopy.biometricInvalidated
            .replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)
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
        let walletCore = core
        do {
            try await work {
                try walletCore.enableBiometricUnlock(password: password, wrapSecret: secret.data, domainState: domain)
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

    /// Reads the active account's balances through the portfolio (the one balance read: tracked
    /// tokens, saved snapshots, prices). `reset` enters the account's scope, serving its saved
    /// figures first; otherwise the read is forced, as pull-to-refresh and Retry ask.
    func refreshBalances(reset: Bool = false) async {
        // A private reading belongs to one account record on one network; anything else is dropped.
        privacy.retain(network: network, accountId: activeRecord?.id)
        guard let active = activeRecord else { return }
        if reset || portfolio.scope?.accountId != active.id {
            await portfolio.load(account: active, network: networkInfo)
        } else {
            await portfolio.refresh(force: true)
        }
        await refreshSendState()
        await refreshPrivacy()
    }

    /// Base units per symbol of the network's own tokens, from the portfolio's loaded balances
    /// (Send's amount checks and the deploy notice). Empty until they have loaded.
    var balances: [String: String] {
        guard case let .loaded(view) = portfolio.balances else { return [:] }
        var bySymbol: [String: String] = [:]
        for token in networkInfo.tokens {
            let id = tokenConfigId(network: network, symbol: token.symbol, address: token.address)
            if let row = view.balances.first(where: { $0.token.id == id }) { bySymbol[token.symbol] = row.balance }
        }
        return bySymbol
    }

    /// Whether the last balance read answered (or saved figures are showing).
    var networkHealthy: Bool {
        if case .failed = portfolio.balances { return false }
        return true
    }

    /// The active account's one activity list: this wallet's transactions and on-chain history,
    /// as the core's log holds them (the same rows the Activity screen groups).
    var activity: [ActivityEntry] { portfolio.activityView?.entries ?? [] }

    /// Base-unit balance formatted for display, or nil until it has loaded.
    func amount(of token: TokenInfo) -> String? {
        guard let raw = balances[token.symbol] else { return nil }
        return try? formatTokenAmount(
            raw: raw,
            decimals: token.decimals,
            maxFraction: WalletDefaults.balanceFractionDigits
        )
    }
}

/// User-facing text for a core error, in the extension's wording. Never includes input.
func describe(_ error: Error) -> String {
    switch error as? CoreError {
    case .WrongPassword:
        BrambleCopy.incorrectPassphrase

    case .Throttled(let retryAfterMs):
        throttledText(ms: retryAfterMs)

    case .BiometricInvalidated:
        BrambleCopy.biometricInvalidated.replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)

    case .InvalidInput(let reason):
        reason.prefix(1).uppercased() + reason.dropFirst()

    case .WalletExists:
        "A wallet already exists on this device"

    case .Locked:
        "The wallet is locked"

    default:
        "Something went wrong. Try again."
    }
}

/// Unit sizes for the throttle countdown.
private enum ThrottleClock {
    static let millisecondsPerSecond: UInt64 = 1_000
    static let secondsPerMinute = 60
    static let secondsPerHour = 3_600
}

/// "Too many attempts. Try again in 1:59." for a remaining delay.
func throttledText(ms milliseconds: UInt64) -> String {
    // Rounds up, so a partial second still shows as one.
    let perSecond = ThrottleClock.millisecondsPerSecond
    let seconds = Int((milliseconds + perSecond - 1) / perSecond)
    let minute = ThrottleClock.secondsPerMinute, hour = ThrottleClock.secondsPerHour
    let clockSeconds = String(format: "%02d", seconds % minute)
    let time = seconds >= hour
        ? "\(seconds / hour):\(String(format: "%02d", seconds % hour / minute)):\(clockSeconds)"
        : "\(seconds / minute):\(clockSeconds)"
    return BrambleCopy.throttled.replacingOccurrences(of: "{time}", with: time)
}
