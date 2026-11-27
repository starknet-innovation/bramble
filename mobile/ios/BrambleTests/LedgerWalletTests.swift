@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// Ledger onboarding's vault step (`WalletStore.createLedgerWallet`): no picks is refused before
/// the core is asked, and once the vault exists a pick the core refuses is a toast, not a throw.
@MainActor
final class LedgerWalletTests: XCTestCase {
    private static let key0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"

    private func store() throws -> WalletStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return WalletStore(core: try WalletCore(dataDir: dir.path, clock: DeviceClock()))
    }

    private func request() throws -> LedgerAccountRequest {
        try XCTUnwrap(ledgerAccountCandidates(
            network: .sepolia,
            family: .openZeppelin,
            keys: [LedgerKey(scheme: .bramble, accountIndex: 0, publicKeyX: Self.key0)]
        ).first).request
    }

    func testNoPicksCreatesNothingAndThrows() async throws {
        let store = try store()
        do {
            try await store.createLedgerWallet(password: testPassword, requests: [])
            XCTFail("an empty pick list must not finish onboarding")
        } catch LedgerWalletError.noAccounts {
            XCTAssertEqual(store.core.status(), .noWallet)
        }
    }

    func testAPickThatFailsAfterTheVaultExistsIsReportedNotThrown() async throws {
        let store = try store()
        let pick = try request()
        // The same account twice: the core refuses the second add.
        try await store.createLedgerWallet(password: testPassword, requests: [pick, pick])
        XCTAssertNotEqual(store.core.status(), .noWallet)
        XCTAssertEqual(store.toast, WalletStore.ledgerNotAdded(1))
        XCTAssertEqual(store.toastTone, .error)
    }

    func testTheSharedSignerNeverAsksForBluetoothUntilALedgerIsUsed() {
        // WalletShell and lock() touch LedgerSigner.shared at launch; its scanner must not create a
        // CBCentralManager (the permission prompt) until a Ledger screen or signature reads it.
        let scanner = LedgerBleScanner()
        let signer = LedgerSigner(scanner: scanner) { _ in throw LedgerLinkError.failed }
        signer.close()
        signer.finish()
        XCTAssertFalse(scanner.awake)
    }
}
