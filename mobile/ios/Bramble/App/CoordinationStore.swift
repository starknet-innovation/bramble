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

    private var rpc: JsonRpcTransport {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BrambleStubNetwork"), let key = wallet.accounts.first?.publicKey,
           let guid = try? argentSignerGuid(publicKey: key) {
            return StubRpcTransport(chainId: wallet.networkInfo.chainId, signerGuid: guid)
        }
        #endif
        return UrlSessionRpcTransport()
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
        let core = core, started = generation
        do {
            let key = try await work { try core.nostrPublicKey() }
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
        let core = core, network = wallet.network, started = generation
        let nextContacts = (try? await work { try core.contacts(network: network) }) ?? []
        let nextMultisigs = (try? await work { try core.multisigs(network: network) }) ?? []
        let nextPolicy = try? await work { try core.relayPolicy() }
        guard started == generation else { return }
        contacts = nextContacts
        multisigs = nextMultisigs
        relayPolicy = nextPolicy
    }

    func saveContact(label: String, address: String, publicKeyX: String?, nostrPublicKey: String?) async throws {
        let core = core, network = wallet.network
        _ = try await work {
            try core.saveContact(network: network, label: label, address: address, publicKeyX: publicKeyX, nostrPublicKey: nostrPublicKey)
        }
        await refresh()
    }

    func removeContact(_ id: String) async throws {
        let core = core
        try await work { try core.removeContact(id: id) }
        await refresh()
    }

    /// Reads the address's authority from Starknet and saves it, as the extension's `addMultisig`.
    /// Returns the status-line copy; throws `Refusal` with the extension's error copy.
    func addShared(address raw: String) async throws -> String {
        let address = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let network = wallet.networkInfo, rpc = rpc, core = core
        let read: MultisigAuthorityRead
        do {
            read = try await ChainReads.authority(of: address, on: network, via: rpc)
        } catch {
            throw Refusal(message: "Enter a valid non-zero Starknet account address.")
        }
        switch read.status() {
        case .available?, .undeployed?: break
        case .invalidConfig?: throw Refusal(message: "This Argent multisig returned an invalid signer configuration")
        case .unsupportedClass?: throw Refusal(message: "This address is not the pinned Argent Multisig 0.2 account")
        case .networkUnavailable?, nil:
            throw Refusal(message: "Argent multisig authority could not be verified. Check the network and retry")
        }
        let record = try await work { try core.addMultisig(read: read) }
        await refresh()
        if read.status() == .undeployed { return "Undeployed multisig added · complete setup to deploy" }
        let matched = record.localSignerIndexes.count
        return matched == 0 ? "Multisig synced · watch-only" : "Multisig synced · \(matched) wallet signer\(matched == 1 ? "" : "s") found"
    }

    func saveSetup(name: String, signerKeys: [String], threshold: UInt32, salt: String, deployer: UInt32) async throws -> MultisigRecord {
        let core = core, network = wallet.network
        let config = ArgentMultisigConfig(threshold: threshold, signerPublicKeys: signerKeys)
        let record = try await work {
            try core.saveMultisigSetup(network: network, name: name, config: config, salt: salt, deployerAccountIndex: deployer)
        }
        await refresh()
        return record
    }

    func removeShared(_ id: String) async throws {
        let core = core
        try await work { try core.removeMultisig(id: id) }
        await refresh()
    }

    func classDeclared() async -> Bool? {
        await ChainReads.classDeclared(on: wallet.networkInfo, via: rpc)
    }

    /// Saves the custom relay (empty restores the defaults); returns the extension's toast copy.
    func setRelay(_ raw: String) async throws -> String {
        let core = core, started = generation
        let saved = try await work { try core.setNostrRelayUrl(raw: raw) }
        let nextPolicy = try? await work { try core.relayPolicy() }
        if started == generation { relayPolicy = nextPolicy }
        return saved == nil ? "Coordination relay reset" : "Coordination relay saved"
    }

    /// One "Check for updates": the core plans, the transport moves frames, the core judges.
    func sync(_ multisigId: String) async throws -> CoordinationSyncOutcome {
        let core = core, relays = relays
        let now = UInt64(Date().timeIntervalSince1970)
        let task = Task.detached(priority: .userInitiated) { () throws -> CoordinationSyncOutcome in
            let plan = try core.coordinationSyncBegin(multisigId: multisigId, now: now)
            let policy = try core.relayPolicy()
            await relays.sync(plan, policy: policy)
            try Task.checkCancellation()
            return try core.coordinationSyncFinish(plan: plan)
        }
        syncTask = task
        defer { syncTask = nil }
        return try await task.value
    }

    /// STRK and ETH balances of a shared account, through the existing balance reader.
    func balances(of address: String) async -> [String: String]? {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "BrambleStubNetwork") {
            return Dictionary(uniqueKeysWithValues: wallet.networkInfo.tokens.map { ($0.symbol, "0") })
        }
        #endif
        return try? await RpcClient().balances(of: address, on: wallet.networkInfo)
    }

    /// A refusal carrying the extension's user-facing copy.
    struct Refusal: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
}
