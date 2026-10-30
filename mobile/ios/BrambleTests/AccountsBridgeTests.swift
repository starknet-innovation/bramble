@testable import Bramble
import BrambleCore
import UIKit
import XCTest

/// Account rules through the generated Swift bindings, against the same `accounts-parity-*.json`
/// the Rust suite reads (written from the extension's own code), plus the host pieces that sit on
/// top of the core: the clipboard policy, the discovery driver, and discovery-first routing.
final class AccountsBridgeTests: XCTestCase {
    private struct Rules: Decodable {
        struct Name: Decodable { let address: String; let name: String; let short: String }
        struct Label: Decodable { let value: String; let valid: Bool }

        let names: [Name]
        let labels: [Label]
    }

    private struct Families: Decodable {
        struct Family: Decodable {
            let accountContractType: String
            let accountIndex: UInt32
            let address: String
            let networkId: String
            let passphrase: String?
            let requestedClassHash: String?
            /// The extension's derivation kind; Braavos's `starknet-bip44` is its address ladder.
            let derivation: String
        }

        let vectors: [Family]
        let mnemonic: String
        let passphrase: String
    }

    private func load<T: Decodable>(_ name: String) throws -> T {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    private func rules() throws -> Rules { try load("accounts-parity-rules") }
    /// The derivation vectors, committed one file per network and read here as one set.
    private func fixture() throws -> Families {
        let mainnet: Families = try load("accounts-parity-families-mainnet")
        let sepolia: Families = try load("accounts-parity-families-sepolia")
        // The merge below keeps the mainnet file's phrase, so the two files must agree on it.
        XCTAssertEqual(mainnet.mnemonic, sepolia.mnemonic)
        XCTAssertEqual(mainnet.passphrase, sepolia.passphrase)
        return Families(
            vectors: mainnet.vectors + sepolia.vectors,
            mnemonic: mainnet.mnemonic,
            passphrase: mainnet.passphrase
        )
    }

    private func directory() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    }

    func testNamesTruncationAndLabelsMatchTheExtension() throws {
        let fixture = try rules()
        for name in fixture.names {
            XCTAssertEqual(accountDisplayName(address: name.address, label: nil), name.name, name.address)
            XCTAssertEqual(accountLabel(address: name.address), name.short, name.address)
        }
        for label in fixture.labels {
            XCTAssertEqual(isAccountLabel(label: label.value), label.valid, label.value)
        }
        XCTAssertEqual(accountDisplayName(address: "0x1", label: "Savings"), "Savings")
        XCTAssertEqual(shortAddress("0x0"), "0x0…0x0", "the design-system helper is the core's rule")
        XCTAssertEqual(shortAddress("0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"), "0x2083…98d9")
    }

    func testRestoredFamiliesDeriveTheExtensionsAddresses() throws {
        let fixture = try fixture()
        let vectors = fixture.vectors.filter { vector in
            vector.networkId == "SN_SEPOLIA" && vector.passphrase == nil && vector.accountIndex == 3
        }
        let core = try WalletCore(dataDir: directory(), clock: DeviceClock())
        try core.importWallet(password: "parity password", phrase: fixture.mnemonic, passphrase: nil)
        let families: [String: AccountFamily] = ["openzeppelin": .openZeppelin, "argent": .argent, "braavos": .braavos]
        let selections = try vectors.map { vector in
            RecoverySelection(
                family: try XCTUnwrap(families[vector.accountContractType]),
                accountIndex: vector.accountIndex,
                classHash: vector.requestedClassHash,
                ladder: vector.derivation == "argentx-bip44"
                    ? .argentX
                    : vector.accountContractType == "braavos" ? .address : .account
            )
        }
        let restored = try core.restoreRecoveredAccounts(network: .sepolia, selections: selections)
        XCTAssertEqual(restored.map(\.address), vectors.map(\.address))
        XCTAssertEqual(restored.filter { $0.family == .braavos }.count, 2)
    }

    func testClipboardIsLocalOnlyAndExpires() {
        let now = Date(timeIntervalSince1970: 1_000)
        let options = Clipboard.options(now: now)
        XCTAssertEqual(options[.localOnly] as? Bool, true)
        XCTAssertEqual(options[.expirationDate] as? Date, now.addingTimeInterval(120))
        let pasteboard = UIPasteboard.withUniqueName()
        Clipboard.copy("0x1234", to: pasteboard)
        XCTAssertEqual(pasteboard.string, "0x1234")
    }

    /// The offline fixture node (`FixtureTransport`) that goes offline on demand: every probed
    /// address undeployed and unfunded, every reply judged by the core as a live one would be.
    private final class SwitchableTransport: RpcTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var isOffline: Bool
        private let node = FixtureTransport(state: .unfunded)

        init(offline: Bool) { isOffline = offline }
        func setOffline(_ value: Bool) { lock.withLock { isOffline = value } }

        func post(_ body: String, to url: URL, write: Bool) throws -> String {
            if lock.withLock({ isOffline }) { throw RpcTransportFailure.unreachable }
            return try node.post(body, to: url, write: write)
        }
    }

    @MainActor
    func testDiscoveryPausesRetriesAndRestores() async throws {
        let core = try WalletCore(dataDir: directory(), clock: DeviceClock())
        try core.importWallet(password: "a strong password", phrase: try fixture().mnemonic, passphrase: nil)
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .sepolia })
        let transport = SwitchableTransport(offline: true)
        let driver = RecoveryScanDriver(core: core, rpc: RpcClient(transport: transport))
        await driver.start(on: network)
        XCTAssertTrue(driver.failed)
        XCTAssertEqual(driver.status, "Account search paused. Check the network and retry.")
        transport.setOffline(false)
        await driver.start(on: network)
        XCTAssertTrue(driver.complete)
        XCTAssertEqual(driver.status, "Search complete. Checked 20 indices across every account type.")
        XCTAssertTrue(driver.selected.isEmpty, "nothing active, nothing auto-selected")
        let bramble = try XCTUnwrap(driver.candidates.first { $0.family == .openZeppelin })
        XCTAssertTrue(driver.toggle(bramble))
        let restored = try await driver.restore(on: .sepolia)
        XCTAssertEqual(restored, 1)
        XCTAssertFalse(try core.recoveryPending())
    }

    /// Cancels the scan (as leaving the screen or locking does) while its first batch is in flight.
    private struct CancellingTransport: RpcTransport {
        let cancel: @Sendable () async -> Void

        func post(_ body: String, to url: URL, write: Bool) async throws -> String {
            await cancel()
            return try FixtureTransport(state: .unfunded).post(body, to: url, write: write)
        }
    }

    @MainActor
    func testCancelledDiscoveryIgnoresLateResults() async throws {
        let core = try WalletCore(dataDir: directory(), clock: DeviceClock())
        try core.importWallet(password: "a strong password", phrase: try fixture().mnemonic, passphrase: nil)
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .sepolia })
        var driver: RecoveryScanDriver?
        let transport = CancellingTransport { await MainActor.run { driver?.cancel() } }
        driver = RecoveryScanDriver(core: core, rpc: RpcClient(transport: transport))
        await driver?.start(on: network)
        XCTAssertEqual(driver?.candidates.count, 0, "a cancelled scan does not apply its results")
        XCTAssertEqual(driver?.complete, false)
    }

    @MainActor
    func testAnImportedVaultRoutesToDiscoveryUntilRestored() async throws {
        let core = try WalletCore(dataDir: directory(), clock: DeviceClock())
        let store = WalletStore(core: core)
        try await store.importWallet(phrase: try fixture().mnemonic, password: "a strong password")
        store.lock()
        try await store.unlock(password: "a strong password")
        XCTAssertEqual(store.route, .discovery)
        _ = try core.restoreRecoveredAccounts(network: store.network, selections: [
            RecoverySelection(family: .openZeppelin, accountIndex: 0, classHash: nil)
        ])
        await store.finishOnboarding()
        XCTAssertEqual(store.route, .wallet)
        XCTAssertEqual(store.activeRecord?.network, store.network)
        XCTAssertFalse(store.activeRecord?.displayName.hasPrefix("Account") ?? true)
    }
}
