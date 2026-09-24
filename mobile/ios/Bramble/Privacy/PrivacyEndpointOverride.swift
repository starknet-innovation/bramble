#if DEBUG
import BrambleCore
import Foundation

/// DEBUG-only: points the Mainnet discovery service at another host, so a developer can run the
/// app or the tests against their own privacy infrastructure (mobile/README.md). The URL comes
/// from the launch argument `-BramblePrivacyDiscoveryURL <url>`, else the environment variable
/// `BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL` (XCTest hands a `TEST_RUNNER_`-prefixed variable to the
/// test process with the prefix removed).
///
/// Swift does not judge the URL: the core applies the same rules it applies to the generated
/// routing (`https`, bounded, no credentials, query or fragment), refuses a network that is not
/// routed (Sepolia, or any OHTTP network), and a release core refuses every override. A refused
/// override throws; callers must stop rather than fall back to the default service.
enum PrivacyEndpointOverride {
    static let argument = "-BramblePrivacyDiscoveryURL"
    static let environmentKey = "BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL"

    /// The requested URL, or `nil` when neither the argument nor the variable is set.
    static func requested(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> String? {
        if let index = arguments.firstIndex(of: argument), index + 1 < arguments.count {
            return arguments[index + 1]
        }
        return environment[environmentKey].flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Hands the requested URL, if any, to the core. Returns the URL now in effect for Mainnet.
    @discardableResult
    static func apply(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> String? {
        if let url = requested(arguments: arguments, environment: environment) {
            try setPrivacyDiscoveryOverride(network: .mainnet, url: url)
        }
        return privacyDiscoveryUrl(network: .mainnet)
    }
}
#endif
