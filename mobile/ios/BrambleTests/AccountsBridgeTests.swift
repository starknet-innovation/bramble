import BrambleCore
import UIKit
import XCTest
@testable import Bramble

/// Account rules through the generated Swift bindings, against the same `accounts-parity-*.json`
/// the Rust suite reads (written from the extension's own code), plus the host pieces that sit on
/// top of the core: the clipboard policy, the discovery driver, and discovery-first routing.
final class AccountsBridgeTests: XCTestCase {
    private struct Rules: Decodable {
        struct Name: Decodable { let address: String; let name: String; let short: String }
        struct Label: Decodable { let value: String; let valid: Bool; let stored: String? }
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
        }
        let vectors: [Family]
        let mnemonic: String
    }

    private func load<T: Decodable>(_ name: String) throws -> T {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    private func rules() throws -> Rules { try load("accounts-parity-rules") }
    private func fixture() throws -> Families { try load("accounts-parity-families") }

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
    }

    func testRestoredFamiliesDeriveTheExtensionsAddresses() throws {
        let fixture = try fixture()
        let vectors = fixture.vectors.filter { $0.networkId == "SN_SEPOLIA" && $0.passphrase == nil && $0.accountIndex == 3 }
        let core = try WalletCore(dataDir: directory())
        try core.importWallet(password: "parity password", phrase: fixture.mnemonic, passphrase: nil)
        let families: [String: AccountFamily] = ["openzeppelin": .openZeppelin, "argent": .argent, "braavos": .braavos]
        let restored = try core.restoreRecoveredAccounts(network: .sepolia, selections: vectors.map {
            RecoverySelection(family: families[$0.accountContractType]!, accountIndex: $0.accountIndex, classHash: $0.requestedClassHash)
        })
        XCTAssertEqual(restored.map(\.address), vectors.map(\.address))
        XCTAssertEqual(restored.filter(\.viewOnly).map(\.family), [.braavos, .braavos])
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

    /// A transport that fails the first `failures` batches, then answers like the UI-test node.
    private final class FlakyTransport: RpcTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var failures: Int
        init(failures: Int) { self.failures = failures }

        func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse] {
            let fail = lock.withLock { () -> Bool in
                defer { failures -= 1 }
                return failures > 0
            }
            if fail { throw RpcClient.Failure.unreachable }
            return try await StubRpcTransport().send(requests, on: network)
        }
    }

    @MainActor
    func testDiscoveryPausesRetriesAndRestores() async throws {
        let core = try WalletCore(dataDir: directory())
        try core.importWallet(password: "a strong password", phrase: try fixture().mnemonic, passphrase: nil)
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .sepolia })
        let driver = RecoveryScanDriver(core: core, transport: FlakyTransport(failures: 1))
        await driver.start(on: network)
        XCTAssertTrue(driver.failed)
        XCTAssertEqual(driver.status, "Account search paused. Check the network and retry.")
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
        func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse] {
            await cancel()
            return try await StubRpcTransport().send(requests, on: network)
        }
    }

    @MainActor
    func testCancelledDiscoveryIgnoresLateResults() async throws {
        let core = try WalletCore(dataDir: directory())
        try core.importWallet(password: "a strong password", phrase: try fixture().mnemonic, passphrase: nil)
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .sepolia })
        var driver: RecoveryScanDriver?
        let transport = CancellingTransport { await MainActor.run { driver?.cancel() } }
        driver = RecoveryScanDriver(core: core, transport: transport)
        await driver?.start(on: network)
        XCTAssertEqual(driver?.candidates.count, 0, "a cancelled scan does not apply its results")
        XCTAssertEqual(driver?.complete, false)
    }

    @MainActor
    func testAnImportedVaultRoutesToDiscoveryUntilRestored() async throws {
        let core = try WalletCore(dataDir: directory())
        let store = WalletStore(core: core)
        try await store.importWallet(phrase: try fixture().mnemonic, password: "a strong password")
        store.lock()
        try await store.unlock(password: "a strong password")
        XCTAssertEqual(store.route, .discovery)
        _ = try core.restoreRecoveredAccounts(network: store.network, selections: [
            RecoverySelection(family: .openZeppelin, accountIndex: 0, classHash: nil),
        ])
        await store.finishOnboarding()
        XCTAssertEqual(store.route, .wallet)
        XCTAssertEqual(store.activeRecord?.network, store.network)
        XCTAssertFalse(store.activeRecord?.displayName.hasPrefix("Account") ?? true)
    }
}
