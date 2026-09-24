import BrambleCore
import Foundation
import Observation

/// UI state over the Rust `WalletCore`. Everything secret stays inside the core: this type only
/// ever holds public account metadata, and a recovery phrase only for the length of the backup
/// screen (`pendingBackup`), cleared as soon as the user confirms it.
@MainActor
@Observable
final class WalletStore {
    enum Route: Equatable { case welcome, backup, locked, home }

    private(set) var route: Route = .welcome
    private(set) var accounts: [AccountInfo] = []
    private(set) var balances: [String: String] = [:]
    private(set) var balanceError: String?
    private(set) var busy = false
    var selectedAccount: UInt32 = 0
    /// Words shown once after creation; never persisted, cleared on confirm or lock.
    private(set) var pendingBackup: [String] = []

    var network: NetworkId {
        didSet { UserDefaults.standard.set(network == .mainnet ? "mainnet" : "sepolia", forKey: "network") }
    }

    let core: WalletCore
    private let rpc = RpcClient()

    init(core: WalletCore) {
        self.core = core
        network = UserDefaults.standard.string(forKey: "network") == "sepolia" ? .sepolia : .mainnet
        route = core.status() == .noWallet ? .welcome : .locked
    }

    var networkInfo: NetworkInfo {
        supportedNetworks().first { $0.network == network }!
    }

    var account: AccountInfo? {
        accounts.first { $0.index == selectedAccount } ?? accounts.first
    }

    /// Runs PBKDF2-bound core work off the main actor.
    private func work<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        busy = true
        defer { busy = false }
        return try await Task.detached(priority: .userInitiated, operation: body).value
    }

    func create(password: String) async throws {
        let core = core
        let phrase = try await work { try core.createWallet(password: password, wordCount: 12) }
        pendingBackup = phrase.words
        route = .backup
    }

    func confirmBackup() async {
        pendingBackup = []
        await enterHome()
    }

    func importWallet(phrase: String, password: String, passphrase: String?) async throws {
        let core = core
        try await work { try core.importWallet(password: password, phrase: phrase, passphrase: passphrase) }
        await enterHome()
    }

    func unlock(password: String) async throws {
        let core = core
        try await work { try core.unlock(password: password) }
        await enterHome()
    }

    func lock() {
        core.lock()
        pendingBackup = []
        accounts = []
        balances = [:]
        if route != .welcome { route = core.status() == .noWallet ? .welcome : .locked }
    }

    func switchNetwork(_ next: NetworkId) async {
        network = next
        await enterHome()
    }

    func addAccount() async throws {
        let core = core, network = network
        let account = try await work { try core.addAccount(network: network) }
        accounts.append(account)
        selectedAccount = account.index
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
        route = .welcome
    }

    private func enterHome() async {
        let core = core, network = network
        accounts = (try? await work { try core.accounts(network: network) }) ?? []
        if !accounts.contains(where: { $0.index == selectedAccount }) { selectedAccount = 0 }
        route = .home
        await refreshBalances()
    }

    func refreshBalances() async {
        guard let account else { return }
        balanceError = nil
        do {
            balances = try await rpc.balances(of: account.address, on: networkInfo)
        } catch {
            balanceError = "Couldn't reach \(networkInfo.name). Pull to retry."
        }
    }
}
