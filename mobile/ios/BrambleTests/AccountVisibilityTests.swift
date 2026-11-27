@testable import Bramble
import BrambleCore
import XCTest

/// Hidden accounts through a real core (the store's `setHidden`, `visibleRecords`,
/// `hiddenRecords`), the kept-accounts copy, and when Home shows the pre-fix Ready key notice.
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

    @MainActor
    func testANewWalletKeepsNoUnusableAccounts() async throws {
        let store = try await twoAccountStore()
        let kept = await store.unusableAccounts()
        XCTAssertTrue(kept.isEmpty)
    }

    func testEveryKeptReasonHasItsOwnLine() {
        let reasons: [UnusableReason] = [.ledger, .importedPhrase, .otherNetwork, .notDerivedHere]
        let lines = reasons.map { reason in
            unusableReasonText(UnusableAccount(
                id: "SN_DEVNET:0x1",
                networkId: "SN_DEVNET",
                address: "0x1",
                shortAddress: "0x0000…0001",
                reason: reason
            ))
        }
        XCTAssertEqual(Set(lines).count, reasons.count)
        XCTAssertTrue(lines.allSatisfy { !$0.isEmpty })
        XCTAssertTrue(lines[2].contains("SN_DEVNET"), "names the network mobile lacks")
    }

    @MainActor
    func testReadyKeyNoticeOnlyForAPreFixKey() async throws {
        let store = try await twoAccountStore()
        var record = try XCTUnwrap(store.activeRecord)
        XCTAssertFalse(record.preFixReadyKey, "a phrase-derived account is not affected")
        XCTAssertFalse(ReadyKeyNotice.shows(for: record))
        XCTAssertFalse(ReadyKeyNotice.shows(for: nil))
        record.preFixReadyKey = true
        XCTAssertTrue(ReadyKeyNotice.shows(for: record))
    }
}
