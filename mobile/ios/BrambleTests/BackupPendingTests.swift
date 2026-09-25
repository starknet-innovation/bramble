@testable import Bramble
import BrambleCore
import XCTest

/// The backup-pending flow: a created vault is written before its backup is confirmed, so every
/// unlock returns to Save phrase (words revealed through the core's password-checked path) until
/// Confirm backup succeeds and clears the core's flag.
final class BackupPendingTests: XCTestCase {
    private let password = "a strong password"

    private func directory() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
    }

    @MainActor
    func testAnUnconfirmedBackupResumesAtSavePhraseUntilConfirmed() async throws {
        let core = try WalletCore(dataDir: directory(), clock: DeviceClock())
        let store = WalletStore(core: core)
        try await store.create(password: password)
        let words = store.pendingBackup
        XCTAssertEqual(words.count, 12)
        XCTAssertTrue(try core.backupPending())

        // Locked during Save phrase: the words are dropped, and the unlock brings them back.
        store.lock()
        XCTAssertEqual(store.pendingBackup, [])
        try await store.unlock(password: password)
        XCTAssertEqual(store.route, .backup)
        XCTAssertEqual(store.pendingBackup, words, "revealed with the passphrase just checked")

        // An unlock that did not reveal them (biometrics) asks for the passphrase first.
        store.lock()
        try core.unlock(password: password)
        await store.enterWallet()
        XCTAssertEqual(store.route, .backup)
        XCTAssertEqual(store.pendingBackup, [])
        do {
            try await store.revealPendingBackup(password: "wrong password")
            XCTFail("a wrong passphrase reveals nothing")
        } catch {
            XCTAssertEqual(store.pendingBackup, [])
        }
        try await store.revealPendingBackup(password: password)
        XCTAssertEqual(store.pendingBackup, words)

        try await store.confirmBackup()
        XCTAssertFalse(try core.backupPending())
        await store.finishOnboarding()
        XCTAssertEqual(store.route, .wallet)
        XCTAssertEqual(store.pendingBackup, [])

        store.lock()
        try await store.unlock(password: password)
        XCTAssertEqual(store.route, .wallet, "a confirmed backup is never asked for again")
        XCTAssertEqual(store.pendingBackup, [])
        store.lock()
    }
}
