@testable import Bramble
import BrambleCore
import XCTest

/// Turning biometric unlock on while it is already on must not touch the existing slot or its
/// secret: the host replaces its secret before the core checks the passphrase, so a mistyped
/// passphrase used to leave the slot without the secret that opens it (mobile audit F-3).
final class BiometricReenableTests: XCTestCase {
    private let password = "a strong password"

    @MainActor
    func testEnablingWhileAlreadyOnLeavesTheWorkingSlotAlone() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let core = try WalletCore(dataDir: dir, clock: DeviceClock())
        let store = WalletStore(core: core)
        try await store.create(password: password)
        let secret = Data(repeating: 7, count: 32)
        try core.enableBiometricUnlock(password: password, wrapSecret: secret, domainState: nil)

        // Returns before any prompt or Keychain write, whatever the passphrase.
        try await store.enableBiometric(password: "a mistyped passphrase")

        XCTAssertTrue(store.security.biometricEnabled)
        core.lock()
        try core.unlockWithBiometric(wrapSecret: secret)
        XCTAssertEqual(core.status(), .unlocked, "the original secret still opens the slot")
        core.lock()
    }
}
