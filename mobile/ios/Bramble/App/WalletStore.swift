import BrambleCore
import Foundation
import Observation

/// UI state over the Rust `WalletCore`. Everything secret stays inside the core: this type holds
/// public account metadata, and a new recovery phrase only while onboarding shows and verifies it
/// (`pendingBackup`), cleared when onboarding finishes or the app locks.
@MainActor
@Observable
final class WalletStore {
    enum Route: Equatable { case onboarding, locked, wallet }
    enum Tab: Equatable { case home, activity, settings }

    private(set) var route: Route = .onboarding
    var tab: Tab = .home
    private(set) var accounts: [AccountInfo] = []
    private(set) var balances: [String: String] = [:]
    private(set) var networkHealthy = true
    private(set) var busy = false
    var selectedAccount: UInt32 = 0
    /// Words of a just-created wallet; never persisted, cleared on finish or lock.
    private(set) var pendingBackup: [String] = []
    /// A transient error shown as a toast.
    var toast: String?

    var network: NetworkId {
        didSet { UserDefaults.standard.set(network == .sepolia ? "sepolia" : "mainnet", forKey: "network") }
    }

    let core: WalletCore
    private let rpc = RpcClient()
    /// Prices, tracked tokens, saved balances and activity (mobile/docs/portfolio-activity.md).
    let portfolio = PortfolioStore()

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

    var account: AccountInfo? {
        accounts.first { $0.index == selectedAccount } ?? accounts.first
    }

    /// Runs PBKDF2-bound core work off the main actor.
    private func work<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        busy = true
        defer { busy = false }
        return try await Task.detached(priority: .userInitiated, operation: body).value
    }

    // MARK: Onboarding

    func create(password: String) async throws {
        let core = core
        pendingBackup = try await work { try core.createWallet(password: password, wordCount: 12) }.words
    }

    func importWallet(phrase: String, password: String) async throws {
        let core = core
        try await work { try core.importWallet(password: password, phrase: phrase, passphrase: nil) }
    }

    /// The first account of a just-written vault, for the review step.
    func previewAccount() async throws -> AccountInfo? {
        let core = core, network = network
        return try await work { try core.accounts(network: network) }.first
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
        portfolio.lock()
        pendingBackup = []
        accounts = []
        balances = [:]
        tab = .home
        if core.status() != .noWallet { route = .locked }
    }

    func switchNetwork(_ next: NetworkId) async {
        network = next
        await enterWallet()
    }

    func addAccount() async throws {
        let core = core, network = network
        let account = try await work { try core.addAccount(network: network) }
        accounts.append(account)
        selectedAccount = account.index
        await refreshBalances()
    }

    func select(_ index: UInt32) async {
        selectedAccount = index
        balances = [:]
        await refreshBalances()
    }

    func revealPhrase(password: String) async throws -> [String] {
        let core = core
        return try await work { try core.revealRecoveryPhrase(password: password).words }
    }

    func deleteWallet(password: String) async throws {
        let core = core
        try await work { try core.deleteWallet(password: password) }
        lock()
        portfolio.deleteFiles()
        route = .onboarding
    }

    private func enterWallet() async {
        let core = core, network = network
        accounts = (try? await work { try core.accounts(network: network) }) ?? []
        if !accounts.contains(where: { $0.index == selectedAccount }) { selectedAccount = 0 }
        route = .wallet
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
        await portfolio.load(account: account, network: networkInfo)
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
