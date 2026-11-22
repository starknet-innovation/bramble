@testable import Bramble
import BrambleCore
import XCTest

/// Hidden accounts through a real core (the store's `setHidden`, `visibleRecords`,
/// `hiddenRecords`).
final class AccountVisibilityTests: XCTestCase {
    /// The published parity phrase the accounts fixtures use; public, never a real wallet.
    private func phrase() throws -> String {
        struct Families: Decodable { let mnemonic: String }
        let url = try XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "accounts-parity-families-mainnet",
            withExtension: "json"
        ))
        return try JSONDecoder().decode(Families.self, from: Data(contentsOf: url)).mnemonic
    }

    /// A wallet store with two Bramble accounts on its network, the first active.
    @MainActor
    private func twoAccountStore() async throws -> WalletStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let core = try WalletCore(dataDir: directory, clock: DeviceClock())
        let store = WalletStore(core: core)
        try await store.importWallet(phrase: try phrase(), password: "a strong password")
        _ = try core.restoreRecoveredAccounts(network: store.network, selections: [
            RecoverySelection(family: .openZeppelin, accountIndex: 0, classHash: nil),
            RecoverySelection(family: .openZeppelin, accountIndex: 1, classHash: nil)
        ])
        await store.finishOnboarding()
        XCTAssertEqual(store.visibleRecords.count, 2)
        return store
    }

    @MainActor
    func testHiddenAccountsLeaveTheListsAndComeBack() async throws {
        let store = try await twoAccountStore()
        let active = try XCTUnwrap(store.activeRecord)
        let other = try XCTUnwrap(store.records.first { $0.id != active.id })

        await store.setHidden(true, for: other.id)
        XCTAssertEqual(store.toast, "Account hidden")
        XCTAssertEqual(store.visibleRecords.map(\.id), [active.id])
        XCTAssertEqual(store.hiddenRecords.map(\.id), [other.id])
        XCTAssertEqual(store.makeSendModel()?.accounts.map(\.id), [active.id], "Send's picker leaves it out")

        await store.setHidden(false, for: other.id)
        XCTAssertEqual(store.toast, "Account shown")
        XCTAssertTrue(store.hiddenRecords.isEmpty)
    }

    @MainActor
    func testTheCoreRefusesHidingTheLastVisibleAccount() async throws {
        let store = try await twoAccountStore()
        let active = try XCTUnwrap(store.activeRecord)
        let other = try XCTUnwrap(store.records.first { $0.id != active.id })
        await store.setHidden(true, for: other.id)

        await store.setHidden(true, for: active.id)
        XCTAssertEqual(store.toast, "Can't hide the last account on this network", "the core's refusal, as worded")
        XCTAssertEqual(store.toastTone, .error)
        XCTAssertEqual(store.visibleRecords.map(\.id), [active.id])
    }

    @MainActor
    func testHidingTheActiveAccountMovesOffIt() async throws {
        let store = try await twoAccountStore()
        let active = try XCTUnwrap(store.activeRecord)
        await store.setHidden(true, for: active.id)
        XCTAssertNotEqual(store.activeRecord?.id, active.id)
        XCTAssertEqual(store.hiddenRecords.map(\.id), [active.id])
    }
}
