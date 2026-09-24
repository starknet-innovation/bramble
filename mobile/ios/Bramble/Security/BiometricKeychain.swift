import BrambleCore
import Foundation
import LocalAuthentication
import Security

/// Holds the biometric wrap secret W in the Keychain behind `.biometryCurrentSet`, and reports
/// the device's biometric state to the core.
///
/// W is generated here with the platform CSPRNG, stored before the core ever sees it, and held in
/// Swift only inside a `WrapSecret`, whose single buffer is handed to the core and zeroed in place.
/// The Keychain's own reply (an immutable `CFData`) and UniFFI's lowering copy are released
/// without being wiped; SCOPE.md lists both as known limits. The item is device-only, never synchronised, needs a device
/// passcode to exist, and becomes unreadable (`errSecItemNotFound`) after any enrolment change.
/// There is no passcode fallback: the flags do not include `.devicePasscode`.
enum BiometricKeychain {
    static let service = "org.bramble.wallet.biometric"
    static let account = "wrap-secret.v1"

    /// Outcome of asking the Keychain for W.
    enum Read {
        /// The caller owns it and must call `wipe()` once the core has taken its copy.
        case secret(WrapSecret)
        /// Non-match, cancel, lockout or anything transient: offer the passphrase, keep the slot.
        case fallback
        /// The item is gone (enrolment changed under `.biometryCurrentSet`): drop the slot.
        case invalidated
    }

    enum Failure: Error { case unavailable, cancelled, keychain(OSStatus) }

    /// "Face ID", "Touch ID" or "Optic ID"; the Face ID copy when the device has no biometry yet.
    static var name: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Face ID"
        }
    }

    static var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// The tri-state the core reconciles against: `State` only when policy evaluation succeeds,
    /// `NotEnrolled` when every face or finger was removed, `Unavailable` for lockout and the rest.
    static func domain() -> BiometricDomain {
        let context = LAContext()
        var error: NSError?
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error),
           let state = context.evaluatedPolicyDomainState {
            return .state(value: state)
        }
        if let error, error.code == LAError.biometryNotEnrolled.rawValue {
            return .notEnrolled
        }
        return .unavailable
    }

    /// The domain state to bind a new slot to; nil when biometrics are not usable now.
    static func enrolmentState() -> Data? {
        if case .state(let value) = domain() { return value }
        return nil
    }

    /// 32 bytes from the system CSPRNG.
    static func newWrapSecret() throws -> Data {
        var secret = Data(count: 32)
        let status = secret.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        return secret
    }

    static func accessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error
        ) else { throw Failure.unavailable }
        return control
    }

    private static var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Stores W, replacing any earlier item.
    static func store(_ secret: Data) throws {
        delete()
        var query = base
        query[kSecAttrAccessControl as String] = try accessControl()
        query[kSecAttrSynchronizable as String] = false
        query[kSecValueData as String] = secret
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure.keychain(status) }
    }

    /// One biometric check before a slot is created, so the person proves the face or finger
    /// works (and grants the Face ID permission) before the passphrase-only path changes.
    static func confirm(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        return (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)) ?? false
    }

    /// Asks for W. The biometric check runs first as an explicit policy evaluation, whose context
    /// then authorises the Keychain read (no second prompt on a device, and a real prompt on the
    /// simulator too). Any evaluation failure (no match, cancel, lockout) is `fallback`.
    static func read(reason: String) async -> Read {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) else {
                return .fallback
            }
        } catch {
            return .fallback
        }
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            // Copy straight out of the Keychain's CFData into one owned buffer; never bridge it
            // to `Data`, whose copy-on-write storage would leave copies that `wipe()` cannot reach.
            guard let result, CFGetTypeID(result) == CFDataGetTypeID() else { return .invalidated }
            let item = unsafeBitCast(result, to: CFData.self)
            guard CFDataGetLength(item) == 32 else { return .invalidated }
            return .secret(WrapSecret(copying: item))
        case errSecItemNotFound:
            return .invalidated
        default:
            // errSecAuthFailed (no match), errSecUserCanceled, lockout: keep the slot.
            return .fallback
        }
    }

    /// The stored item's attributes, read without authentication (for tests and diagnostics).
    static func attributes() -> [String: Any]? {
        var query = base
        query[kSecReturnAttributes as String] = true
        let context = LAContext()
        context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? [String: Any]
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}

/// The single owner of a wrap secret while it is in Swift memory. Callers pass `data` to the core
/// without keeping a copy (a borrowed `Data` shares this buffer) and call `wipe()` when done, which
/// zeroes the buffer in place because no other reference is alive by then.
final class WrapSecret: @unchecked Sendable {
    private(set) var data: Data

    init(_ data: Data) { self.data = data }

    /// Copies a Keychain reply into a buffer this object alone owns.
    init(copying item: CFData) {
        var owned = Data(count: CFDataGetLength(item))
        owned.withUnsafeMutableBytes { buffer in
            CFDataGetBytes(item, CFRange(location: 0, length: buffer.count), buffer.bindMemory(to: UInt8.self).baseAddress)
        }
        data = owned
    }

    func wipe() { data.resetBytes(in: 0..<data.count) }
}
