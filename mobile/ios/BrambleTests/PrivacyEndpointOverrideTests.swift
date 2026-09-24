import BrambleCore
import XCTest

/// The DEBUG discovery override (`-BramblePrivacyDiscoveryURL`, `BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL`):
/// the core judges it with the generated routing's URL rules and a refusal changes nothing.
final class PrivacyEndpointOverrideTests: XCTestCase {
    private let bundled = privacyDiscoveryUrl(network: .mainnet)

    override func tearDown() {
        try? setPrivacyDiscoveryOverride(network: .mainnet, url: nil)
        super.tearDown()
    }

    func testAnHttpsUrlIsTakenAndCanBeRestored() throws {
        let url = "https://privacy.example.org/api/strk20/discovery"
        XCTAssertEqual(try PrivacyEndpointOverride.apply(arguments: [], environment: [PrivacyEndpointOverride.environmentKey: url]), url)
        try setPrivacyDiscoveryOverride(network: .mainnet, url: nil)
        XCTAssertEqual(privacyDiscoveryUrl(network: .mainnet), bundled)
    }

    func testAnHttpUrlIsRefused() {
        XCTAssertThrowsError(try setPrivacyDiscoveryOverride(network: .mainnet, url: "http://privacy.example.org/discovery")) {
            XCTAssertEqual($0 as? PrivacyError, .InvalidEndpoint)
        }
        XCTAssertEqual(privacyDiscoveryUrl(network: .mainnet), bundled)
    }

    func testAUrlWithCredentialsIsRefused() {
        XCTAssertThrowsError(try setPrivacyDiscoveryOverride(network: .mainnet, url: "https://user:secret@privacy.example.org/discovery")) {
            XCTAssertEqual($0 as? PrivacyError, .InvalidEndpoint)
        }
        XCTAssertEqual(privacyDiscoveryUrl(network: .mainnet), bundled)
    }

    func testAnUnroutedNetworkStaysUnrouted() {
        XCTAssertThrowsError(try setPrivacyDiscoveryOverride(network: .sepolia, url: "https://privacy.example.org"))
        XCTAssertNil(privacyDiscoveryUrl(network: .sepolia))
    }

    func testTheLaunchArgumentWinsOverTheEnvironment() {
        let requested = PrivacyEndpointOverride.requested(
            arguments: ["app", PrivacyEndpointOverride.argument, "https://a.example"],
            environment: [PrivacyEndpointOverride.environmentKey: "https://b.example"]
        )
        XCTAssertEqual(requested, "https://a.example")
        XCTAssertNil(PrivacyEndpointOverride.requested(arguments: [], environment: [:]))
    }
}
