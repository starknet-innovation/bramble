@testable import Bramble
import BrambleCore
import XCTest

/// The privacy FFI surface against the extension: the discovery bodies the core hands Swift are
/// byte-identical to the SDK's, and the gate answers render the extension's strings.
@MainActor
final class PrivacyBridgeTests: XCTestCase {
    func testDiscoveryBodiesMatchTheSdkByteForByte() async throws {
        let wire = try privacyFixture("wire", rows: ["capture", "cases"])
        let cases = try XCTUnwrap(wire["cases"] as? [[String: Any]])
        let capture = try XCTUnwrap(wire["capture"] as? [[String: Any]]).filter { $0["kind"] as? String != "rpc" }
        let script = try XCTUnwrap(cases.first { $0["id"] as? String == "three-pages" }?["script"] as? [String: Any])
        let service = ScriptedPrivacyService(script: script)
        let core = try unlockedCore()
        let model = PrivacyModel()
        try await model.refresh(
            core: core,
            network: mainnet(),
            accountId: mainnetAccountId(core),
            rpc: service,
            transports: (service, service)
        )
        XCTAssertEqual(service.bodies.count, capture.count)
        for ((url, body), expected) in zip(service.bodies, capture) {
            XCTAssertEqual(url.absoluteString, expected["url"] as? String)
            XCTAssertEqual(String(bytes: body, encoding: .utf8), expected["body"] as? String)
        }
        guard case .settled(.registered) = model.reading else {
            XCTFail("\(model.reading)")
            return
        }
        XCTAssertEqual(model.state?.balances.first?.balance, "3000000000000000")
    }

    func testGateAnswersRenderTheExtensionStrings() throws {
        let rules = try privacyFixture("rules", rows: ["static"])
        let eth = PrivateBalance(
            tokenAddress: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
            symbol: "ETH",
            decimals: 18,
            balance: "1234567890000000000",
            formatted: "1.23456789"
        )
        let state = PrivacyState(
            network: .mainnet,
            accountId: "mainnet-account",
            registration: .registered,
            balances: [eth],
            poolFeeFri: "0x1",
            poolAddress: "0x1"
        )
        for row in try XCTUnwrap(rules["static"] as? [[String: Any]]) {
            let (network, reading) = Self.reading(row["reading"] as? String ?? "")
            let deployment: DeploymentState = switch row["deployment"] as? String {
            case "deployed":
                .deployed

            case "undeployed":
                .undeployed

            default:
                .unknown
            }
            // "zero" is unfunded, "funded" is funded, anything else is not yet known (nil).
            let funded = ["zero": false, "funded": true][row["strk"] as? String ?? ""]
            let tile = try XCTUnwrap(row["tile"] as? [String: Any])
            let answer = shieldTile(network: network, deployment: deployment, strkFunded: funded, reading: reading)
            XCTAssertEqual(answer.copy.label, tile["label"] as? String, "\(row)")
            XCTAssertEqual(answer.copy.accessibility, tile["aria"] as? String, "\(row)")
            let line = privateLine(
                network: network,
                deployment: deployment,
                strkFunded: funded,
                reading: reading,
                tokenAddress: state.balances[0].tokenAddress,
                state: state
            )
            XCTAssertEqual(line.text, (row["privateLine"] as? [String: Any])?["text"] as? String, "\(row)")
            let notice = receivePoolNotice(deployment: deployment, strkFunded: funded, reading: reading)
            XCTAssertEqual(notice == .hidden, row["notice"] as? String == "hidden", "\(row)")
        }
    }

    func testTheOnlyNonExtensionStringsAreTheMobileOnlyPair() throws {
        let copy = try XCTUnwrap(privacyFixture("copy", rows: [])["copy"] as? [String: Any])
        let strings = try XCTUnwrap(copy["strings"] as? [String: String])
        let mobileOnly = try XCTUnwrap(copy["mobileOnly"] as? [String: String])
        XCTAssertEqual(Set(mobileOnly.keys), ["unsupportedTitle", "unsupportedBody"])
        XCTAssertEqual(PrivacyCopy.unsupportedTitle, mobileOnly["unsupportedTitle"])
        XCTAssertEqual(PrivacyCopy.noticeTitle, strings["noticeTitle"])
        XCTAssertEqual(PrivacyCopy.preparingBody, strings["preparingBody"])
        XCTAssertEqual(PrivacyBlocker.network.copy.title, strings["blockedNetworkTitle"])
        XCTAssertFalse(strings.values.contains(PrivacyCopy.unsupportedTitle))
        XCTAssertEqual(
            privacyCapabilities(),
            PrivacyCapabilities(canRegister: false, canShield: false, canSendPrivately: false, canUnshield: false)
        )
    }

    private static func reading(_ name: String) -> (NetworkId, PrivacyReading) {
        switch name {
        case "idle":
            (.mainnet, .idle)

        case "loading":
            (.mainnet, .loading)

        case "failed":
            (.mainnet, .failed)

        case "unconfigured":
            (.sepolia, .unconfigured)

        case "unregistered":
            (.mainnet, .settled(registration: .unregistered))

        default:
            (.mainnet, .settled(registration: .registered))
        }
    }
}
