import Foundation

/// Product analytics, as the extension's `gateway-analytics.ts`: while the person has it on, a
/// request to the wallet's own gateway carries a random installation id and the app's version,
/// platform and release channel as headers. It adds headers only, never a request, and only to
/// `https://wallet.nodes.starknet.org`; every redirect is refused by `BoundedHttp`, so the id
/// cannot leave that origin. Off by default on mobile (the extension defaults on).
///
/// The id is a random UUIDv4 kept in `UserDefaults` (not the Keychain, which survives an
/// uninstall), never derived from the device or the wallet, and removed by "Remove wallet".
/// Fails open: anything wrong with the stored id or the version leaves every header out, and the
/// request goes as it would have.
final class GatewayAnalytics: @unchecked Sendable {
    static let shared = GatewayAnalytics()

    /// The only host that receives the headers (over https, default port).
    static let host = "wallet.nodes.starknet.org"
    static let enabledKey = "bramble:product-analytics"
    /// The extension's storage key for the same id.
    static let installationIdKey = "bramble:analytics-installation-id"

    private static let httpsPort = 443
    private static let uuidV4 = #/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/#
    private static let appVersion = #/[A-Za-z0-9.+-]{1,32}/#

    private let defaults: UserDefaults
    private let version: String
    private let lock = NSLock()

    init(
        defaults: UserDefaults = .standard,
        version: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    ) {
        self.defaults = defaults
        self.version = version
    }

    /// The person's choice; read on every request, so turning it off takes effect at once.
    var enabled: Bool {
        get { defaults.bool(forKey: Self.enabledKey) }
        set { defaults.set(newValue, forKey: Self.enabledKey) }
    }

    /// Whether `name` is one of the analytics headers, which only this type may set.
    static func isAnalyticsHeader(_ name: String) -> Bool {
        name.lowercased().hasPrefix("x-mc-")
    }

    /// The headers for a request to `url`: all four, or none.
    func headers(for url: URL) -> [String: String] {
        guard enabled,
              url.scheme == "https",
              url.host == Self.host,
              url.port == nil || url.port == Self.httpsPort,
              version.wholeMatch(of: Self.appVersion) != nil,
              let id = installationId()
        else { return [:] }
        #if DEBUG
        let channel = "development"
        #else
        let channel = "production"
        #endif
        return [
            "X-MC-Installation-ID": id,
            "X-MC-App-Version": version,
            "X-MC-Platform": "ios",
            "X-MC-Release-Channel": channel
        ]
    }

    /// Removes the id; the next request while on makes a new one ("Remove wallet").
    func reset() {
        lock.withLock { defaults.removeObject(forKey: Self.installationIdKey) }
    }

    private func installationId() -> String? {
        lock.withLock {
            if let stored = defaults.string(forKey: Self.installationIdKey),
               stored.wholeMatch(of: Self.uuidV4) != nil {
                return stored
            }
            let generated = UUID().uuidString.lowercased()
            defaults.set(generated, forKey: Self.installationIdKey)
            return generated
        }
    }
}
