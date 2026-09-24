@testable import Bramble
import BrambleCore
import Security
import SwiftUI
import XCTest

/// Host-side vault security: the monotonic clock bridge, backoff and copy mapping, wrap-secret
/// wiping, the Keychain item's protection attributes, and the dark default.
@MainActor
final class SecurityTests: XCTestCase {
    private func core() throws -> WalletCore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return try WalletCore(dataDir: dir.path, clock: DeviceClock())
    }

    func testTheClockIsMonotonicAndBootScoped() {
        let clock = DeviceClock()
        let first = clock.monotonicMs()
        Thread.sleep(forTimeInterval: 0.02)
        XCTAssertGreaterThanOrEqual(clock.monotonicMs() - first, 15)
        XCTAssertFalse(clock.bootId().isEmpty)
        XCTAssertEqual(clock.bootId(), DeviceClock().bootId())
    }

    func testTheCoreThrottlesAfterFiveWrongPassphrases() throws {
        let core = try core()
        _ = try core.createWallet(password: "a strong password", wordCount: 12)
        core.lock()
        for _ in 0..<5 {
            XCTAssertThrowsError(try core.unlock(password: "wrong password"))
        }
        XCTAssertThrowsError(try core.unlock(password: "a strong password")) { error in
            guard case .Throttled(let retry) = error as? CoreError else {
                return XCTFail("expected Throttled, got \(error)")
            }
            XCTAssertGreaterThan(retry, 29_000)
            XCTAssertEqual(describe(error), "Too many attempts. Try again in 0:30.")
        }
        XCTAssertEqual(core.securityStatus().failedAttempts, 5)
    }

    func testThrottleCountdownText() {
        XCTAssertEqual(throttledText(ms: 119_001), "Too many attempts. Try again in 2:00.")
        XCTAssertEqual(throttledText(ms: 59_000), "Too many attempts. Try again in 0:59.")
        XCTAssertEqual(throttledText(ms: 3_600_000), "Too many attempts. Try again in 1:00:00.")
    }

    func testCopyComesFromTheExtension() {
        XCTAssertEqual(BrambleCopy.incorrectPassphrase, "Incorrect passphrase")
        XCTAssertEqual(describe(CoreError.WrongPassword), "Incorrect passphrase")
        XCTAssertEqual(BrambleCopy.idleLockMs, 1_800_000)
        XCTAssertEqual(
            Bundle.main.object(forInfoDictionaryKey: "NSFaceIDUsageDescription") as? String,
            BrambleCopy.faceIdUsage
        )
    }

    func testTheWrapSecretIsWipedAfterUse() throws {
        let secret = WrapSecret(try BiometricKeychain.newWrapSecret())
        XCTAssertEqual(secret.data.count, 32)
        XCTAssertFalse(secret.data.allSatisfy { $0 == 0 })
        secret.wipe()
        XCTAssertTrue(secret.data.allSatisfy { $0 == 0 })

        // A Keychain reply is copied into one owned buffer, and wipe() zeroes that same buffer
        // in place (no copy-on-write copy is left holding W).
        let reply = Data(repeating: 7, count: 32) as CFData
        let copied = WrapSecret(copying: reply)
        XCTAssertEqual(copied.data, Data(repeating: 7, count: 32))
        let before = copied.data.withUnsafeBytes { UInt(bitPattern: $0.baseAddress) }
        copied.wipe()
        let after = copied.data.withUnsafeBytes { UInt(bitPattern: $0.baseAddress) }
        XCTAssertEqual(before, after, "wiped in place, not in a fresh copy")
        XCTAssertTrue(copied.data.allSatisfy { $0 == 0 })
    }

    func testTheKeychainItemIsDeviceOnlyAndBiometryBound() throws {
        defer { BiometricKeychain.delete() }
        do {
            try BiometricKeychain.store(Data(repeating: 1, count: 32))
        } catch BiometricKeychain.Failure.keychain(let status) where Self.simulatorRefusesPasscodeItems(status) {
            throw XCTSkip("this simulator cannot hold passcode-bound items (status \(status))")
        }
        let attributes = BiometricKeychain.attributes()
        XCTAssertFalse(attributes.isEmpty, "the stored item is readable")
        XCTAssertEqual(
            attributes[kSecAttrAccessible as String] as? String,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String
        )
        XCTAssertNotEqual(attributes[kSecAttrSynchronizable as String] as? Bool, true)
        XCTAssertNotNil(attributes[kSecAttrAccessControl as String])
        BiometricKeychain.delete()
        XCTAssertTrue(BiometricKeychain.attributes().isEmpty)
    }

    /// The statuses a simulator without a passcode (or the entitlement, -34018) answers a
    /// passcode-bound store with.
    private static func simulatorRefusesPasscodeItems(_ status: OSStatus) -> Bool {
        status == errSecNotAvailable || status == -34_018 || status == errSecAuthFailed || status == errSecParam
    }

    func testDarkIsTheDefaultTheme() {
        XCTAssertEqual(ThemeChoice.resolve(nil), .dark)
        XCTAssertEqual(ThemeChoice.resolve("system"), .dark)
        XCTAssertEqual(ThemeChoice.resolve("light"), .light)
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "UIUserInterfaceStyle") as? String, "Dark")
    }

    func testTheScreenshotShieldFindsItsSecureLayer() {
        // Fails closed when false (words stay masked); this pins that the shield works on the
        // iOS the suite runs on.
        XCTAssertTrue(ScreenshotShield<EmptyView>.isAvailable)
    }
}
