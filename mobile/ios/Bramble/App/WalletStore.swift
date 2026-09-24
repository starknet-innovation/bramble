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
    /// Deprecated OZ-only view (`accounts()` in the core); new code reads `records`.
    var accounts: [AccountInfo] = []
    /// Every account on the selected network, as the core renders it (name, label, type, group).
    var records: [AccountRecord] = []
    /// Every account on every network, for the groups editor.
    var allRecords: [AccountRecord] = []
    var groups: [AccountGroup] = []
    /// The active account (one for the whole vault, as in the extension).
    var activeRecord: AccountRecord?
    private(set) var balances: [String: String] = [:]
    private(set) var networkHealthy = true
    private(set) var busy = false
    /// Words of a just-created wallet; never persisted, cleared on finish or lock.
    private(set) var pendingBackup: [String] = []
    /// A transient message shown as a toast, and whether it reports success or an error.
    /// Set directly, a toast reports an error; `notify` sets the tone after the text.
    var toast: String? { didSet { toastTone = .error } }
    var toastTone: ToastTone = .error

    var network: NetworkId {
        didSet { UserDefaults.standard.set(network == .sepolia ? "sepolia" : "mainnet", forKey: "network") }
    }

    let core: WalletCore
    private let rpc = RpcClient()

    init(core: WalletCore) {
        self.core = core
        network = UserDefaults.standard.string(forKey: "network") == "sepolia" ? .sepolia : .mainnet
        route = core.status() == .noWallet ? .onboarding : .locked
    }

    var networkInfo: NetworkInfo {
        supportedNetworks().first { $0.network == network }!
    }

    /// The header's network label, as the side panel's `.account-network-label`.
    var networkLabel: String { network == .mainnet ? "Starknet" : "Sepolia" }

    /// The active account in the pre-records shape other screens read. Signing must go through
    /// `activeRecord.id` and `signHashForAccount`, never this `index` (docs/accounts.md §2.7).
    var account: AccountInfo? {
        activeRecord.map {
            AccountInfo(index: $0.accountIndex, address: $0.address, publicKey: $0.publicKey, classHash: $0.classHash, network: $0.network)
        }
    }

    /// Shows a toast; success toasts carry the check tile, errors the alert tile.
    func notify(_ message: String, tone: ToastTone = .success) {
        toast = message
        toastTone = tone
    }

    /// Runs PBKDF2-bound core work off the main actor.
    func work<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        busy = true
        defer { busy = false }
        return try await Task.detached(priority: .userInitiated, operation: body).value
    }

    // MARK: Onboarding

    func create(password: String) async throws {
        let core = core
        let network = network
        pendingBackup = try await work { try core.createWalletOnNetwork(password: password, wordCount: 12, network: network) }.words
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
        try await work { try core.unlock(password: password) }
        await enterWallet()
    }

    func lock() {
        core.lock()
        pendingBackup = []
        accounts = []
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
        return try await work { try core.revealRecoveryPhrase(password: password).words }
    }

    func deleteWallet(password: String) async throws {
        let core = core
        try await work { try core.deleteWallet(password: password) }
        lock()
        route = .onboarding
    }

    /// Routes into the wallet: back to discovery while recovery is pending; otherwise the network
    /// switch rule (keep, pick, or project the active account) runs before anything renders.
    private func enterWallet() async {
        let core = core
        if (try? core.recoveryPending()) == true {
            route = .discovery
            return
        }
        await reloadAccounts(ensure: true)
        route = .wallet
        balances = [:]
        await refreshBalances()
    }

    func refreshBalances() async {
        guard let account else { return }
        do {
            balances = try await rpc.balances(of: account.address, on: networkInfo)
            networkHealthy = true
        } catch {
            networkHealthy = false
        }
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
    case .WrongPassword: "Vault passphrase is incorrect"
    case .InvalidInput(let reason): reason.prefix(1).uppercased() + reason.dropFirst()
    case .WalletExists: "A wallet already exists on this device"
    case .Locked: "The wallet is locked"
    default: "Something went wrong. Try again."
    }
}
