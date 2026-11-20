import BrambleCore
import Foundation
import Observation

/// UI state for the wallet card, contacts, shared accounts, and Nostr coordination. Every value
/// held here is public: the core keeps the coordination private key, the phrase, gift-wrap
/// plaintext, and raw relay events, and returns counts. Locking cancels any sync and clears state.
@MainActor
@Observable
final class CoordinationStore {
    @ObservationIgnored private unowned let wallet: WalletStore
    @ObservationIgnored private var syncTask: Task<CoordinationSyncOutcome, Error>?
    /// Bumped on lock; a core call that finishes after it must not write public state back.
    @ObservationIgnored private var generation = 0

    /// The coordination public key, once derived.
    private(set) var nostrKey: String?
    /// Derivation failed: Receive hides the card and says coordination is unavailable.
    private(set) var nostrUnavailable = false
    private(set) var contacts: [Contact] = []
    private(set) var multisigs: [MultisigRecord] = []
    private(set) var relayPolicy: RelayPolicy?

    init(wallet: WalletStore) {
        self.wallet = wallet
    }

    private var core: WalletCore { wallet.core }

    private var rpc: RpcTransport {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BrambleStubNetwork"), let key = wallet.records.first?.publicKey,
           let guid = try? argentSignerGuid(publicKey: key) {
            return StubRpcTransport(chainId: wallet.networkInfo.chainId, signerGuid: guid)
        }
        #endif
        return RpcTransports.launch
    }

    private var relays: RelayTransport {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BrambleStubRelay") {
            let events = ProcessInfo.processInfo.environment["BRAMBLE_STUB_RELAY_EVENTS"]
                .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String] } ?? []
            return StubRelayTransport(events: events)
        }
        #endif
        return WebSocketRelayTransport()
    }

    private func work<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated, operation: body).value
    }

    /// Called when the wallet locks: sockets close and nothing public lingers in memory.
    func reset() {
        generation &+= 1
        syncTask?.cancel()
        syncTask = nil
        nostrKey = nil
        nostrUnavailable = false
        contacts = []
        multisigs = []
        relayPolicy = nil
    }

    func loadNostrKey() async {
        guard nostrKey == nil else { return }
        let walletCore = core, started = generation
        do {
            let key = try await work { try walletCore.nostrPublicKey() }
            guard started == generation else { return }
            nostrKey = key
            nostrUnavailable = false
        } catch {
            guard started == generation else { return }
            nostrUnavailable = true
        }
    }

    /// Reloads contacts, shared accounts, and the relay choice for the active network.
    func refresh() async {
        let walletCore = core, network = wallet.network, started = generation
        let nextContacts = (try? await work { try walletCore.contacts(network: network) }) ?? []
        let nextMultisigs = (try? await work { try walletCore.multisigs(network: network) }) ?? []
        let nextPolicy = try? await work { try walletCore.relayPolicy() }
        guard started == generation else { return }
        contacts = nextContacts
        multisigs = nextMultisigs
        relayPolicy = nextPolicy
    }

    func saveContact(label: String, address: String, publicKeyX: String?, nostrPublicKey: String?) async throws {
        let walletCore = core, network = wallet.network
        _ = try await work {
            try walletCore.saveContact(
                network: network,
                label: label,
                address: address,
                publicKeyX: publicKeyX,
                nostrPublicKey: nostrPublicKey
            )
        }
        await refresh()
    }

    func removeContact(_ id: String) async throws {
        let walletCore = core
        try await work { try walletCore.removeContact(id: id) }
        await refresh()
    }

    /// Reads the address's authority from Starknet and saves it, as the extension's `addMultisig`.
    /// Returns the status-line copy; throws `Refusal` with the extension's error copy.
    func addShared(address raw: String) async throws -> String {
        let address = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let network = wallet.networkInfo, transport = rpc, walletCore = core
        let read: MultisigAuthorityRead
        do {
            read = try await ChainReads.authority(of: address, on: network, via: transport)
        } catch {
            throw Refusal(message: "Enter a valid non-zero Starknet account address.")
        }
        switch read.status() {
        case .available, .undeployed:
            break

        case .invalidConfig:
            throw Refusal(message: "This Argent multisig returned an invalid signer configuration")

        case .unsupportedClass:
            throw Refusal(message: "This address is not the pinned Argent Multisig 0.2 account")

        case .networkUnavailable, nil:
            throw Refusal(message: Self.authorityUnverified)
        }
        let record = try await work { try walletCore.addMultisig(read: read) }
        await refresh()
        if read.status() == .undeployed { return "Undeployed multisig added · complete setup to deploy" }
        let matched = record.localSignerAccountIds.count
        guard matched != 0 else { return "Multisig synced · watch-only" }
        return "Multisig synced · \(matched) wallet signer\(matched == 1 ? "" : "s") found"
    }

    /// `deployer` is the account record id that signs and pays for deployment.
    func saveSetup(
        name: String,
        signerKeys: [String],
        threshold: UInt32,
        salt: String,
        deployer: String
    ) async throws -> MultisigRecord {
        let walletCore = core, network = wallet.network
        let config = ArgentMultisigConfig(threshold: threshold, signerPublicKeys: signerKeys)
        let record = try await work {
            try walletCore.saveMultisigSetup(
                network: network,
                name: name,
                config: config,
                salt: salt,
                deployerAccountId: deployer
            )
        }
        await refresh()
        return record
    }

    func removeShared(_ id: String) async throws {
        let walletCore = core
        try await work { try walletCore.removeMultisig(id: id) }
        await refresh()
    }

    func classDeclared() async -> ClassDeclaration {
        await ChainReads.classDeclared(on: wallet.networkInfo, via: rpc)
    }

    /// Saves the custom relay (empty restores the defaults); returns the extension's toast copy.
    func setRelay(_ raw: String) async throws -> String {
        let walletCore = core, started = generation
        let saved = try await work { try walletCore.setNostrRelayUrl(raw: raw) }
        let nextPolicy = try? await work { try walletCore.relayPolicy() }
        if started == generation { relayPolicy = nextPolicy }
        return saved == nil ? "Coordination relay reset" : "Coordination relay saved"
    }

    /// One "Check for updates": the core plans, the transport moves frames, the core judges.
    func sync(_ multisigId: String) async throws -> CoordinationSyncOutcome {
        let walletCore = core, relayTransport = relays
        let now = UInt64(Date().timeIntervalSince1970)
        let task = Task.detached(priority: .userInitiated) { () throws -> CoordinationSyncOutcome in
            let plan = try walletCore.coordinationSyncBegin(multisigId: multisigId, now: now)
            let policy = try walletCore.relayPolicy()
            await relayTransport.sync(plan, policy: policy)
            try Task.checkCancellation()
            return try walletCore.coordinationSyncFinish(plan: plan)
        }
        syncTask = task
        defer { syncTask = nil }
        return try await task.value
    }

    /// STRK and ETH balances of a shared account, through the existing balance reader. Throws when
    /// no endpoint could read them.
    func balances(of address: String) async throws -> [String: String] {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BrambleStubNetwork") {
            return Dictionary(uniqueKeysWithValues: wallet.networkInfo.tokens.map { ($0.symbol, "0") })
        }
        #endif
        return try await wallet.rpc.balances(of: address, on: wallet.networkInfo)
    }

    /// The extension's copy when no endpoint could read the multisig's authority.
    private static let authorityUnverified =
        "Argent multisig authority could not be verified. Check the network and retry"

    /// A refusal carrying the extension's user-facing copy.
    struct Refusal: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
}
