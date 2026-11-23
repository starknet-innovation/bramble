@testable import Bramble
import BrambleCore
import XCTest

/// Product analytics: off by default, remembered, immediate, gateway-only, reset with the wallet,
/// and never a request of its own.
final class GatewayAnalyticsTests: XCTestCase {
    private let gateway = URL(string: "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10") ?? URL(fileURLWithPath: "/")
    private let suite = "analytics-\(UUID().uuidString)"
    private lazy var defaults = UserDefaults(suiteName: suite) ?? .standard

    override func setUp() {
        ScriptedProtocol.seen = []
        ScriptedProtocol.handler = nil
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        ScriptedProtocol.handler = nil
        ScriptedProtocol.seen = []
    }

    private func analytics(version: String = "0.1.0") -> GatewayAnalytics {
        GatewayAnalytics(defaults: defaults, version: version)
    }

    func testOffByDefaultSendsNothing() {
        let subject = analytics()
        XCTAssertFalse(subject.enabled)
        XCTAssertTrue(subject.headers(for: gateway).isEmpty)
    }

    func testOnAddsAllFourHeadersToTheGatewayOnly() throws {
        let subject = analytics()
        subject.enabled = true
        let headers = subject.headers(for: gateway)
        XCTAssertEqual(
            Set(headers.keys),
            ["X-MC-Installation-ID", "X-MC-App-Version", "X-MC-Platform", "X-MC-Release-Channel"]
        )
        let id = try XCTUnwrap(headers["X-MC-Installation-ID"])
        XCTAssertNotNil(id.wholeMatch(of: #/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/#))
        XCTAssertEqual(headers["X-MC-Platform"], "ios")
        XCTAssertEqual(headers["X-MC-App-Version"], "0.1.0")
        for other in [
            "https://mainnet.nodes.starknet.org/rpc/v0_10",
            "http://wallet.nodes.starknet.org/rpc",
            "https://wallet.nodes.starknet.org:8443/rpc",
            "https://wallet.nodes.starknet.org.evil.test/rpc",
            "https://api.starkscan.co/api/v0/transactions"
        ] {
            let url = try XCTUnwrap(URL(string: other))
            XCTAssertTrue(subject.headers(for: url).isEmpty, other)
        }
    }

    func testChoiceIsRememberedAndTurningOffIsImmediate() {
        analytics().enabled = true
        let reopened = analytics()
        XCTAssertTrue(reopened.enabled)
        XCTAssertFalse(reopened.headers(for: gateway).isEmpty)
        reopened.enabled = false
        XCTAssertTrue(reopened.headers(for: gateway).isEmpty)
    }

    func testIdIsStableUntilReset() {
        let subject = analytics()
        subject.enabled = true
        let first = subject.headers(for: gateway)["X-MC-Installation-ID"]
        XCTAssertEqual(first, subject.headers(for: gateway)["X-MC-Installation-ID"])
        subject.reset()
        XCTAssertNotEqual(first, subject.headers(for: gateway)["X-MC-Installation-ID"])
    }

    func testMalformedStoredIdOrVersionFailsOpen() {
        defaults.set("not-a-uuid", forKey: GatewayAnalytics.installationIdKey)
        let subject = analytics()
        subject.enabled = true
        XCTAssertNotEqual(subject.headers(for: gateway)["X-MC-Installation-ID"], "not-a-uuid")
        let badVersion = analytics(version: "1.0 beta\"")
        XCTAssertTrue(badVersion.headers(for: gateway).isEmpty)
    }

    /// Through the real transport: one request out per exchange (analytics never adds one), the
    /// headers only while on, and a caller's own `X-MC-*` header dropped.
    func testTransportAddsHeadersOnlyWhileOnAndMakesNoRequestOfItsOwn() async {
        ScriptedProtocol.handler = { $0.respond(status: 200, body: Data("{}".utf8)) }
        let subject = analytics()
        let http = BoundedHttp(protocolClasses: [ScriptedProtocol.self], analytics: subject)
        let request = HttpRequest(
            method: .post,
            url: gateway.absoluteString,
            headers: [HttpHeader(name: "X-MC-Platform", value: "spoofed")],
            body: "{}",
            maxBodyBytes: 64,
            deadlineMs: 2_000
        )
        _ = await http.perform(request)
        subject.enabled = true
        _ = await http.perform(request)
        subject.enabled = false
        _ = await http.perform(request)
        XCTAssertEqual(ScriptedProtocol.seen.count, 3)
        let platforms = ScriptedProtocol.seen.map { $0.value(forHTTPHeaderField: "X-MC-Platform") }
        XCTAssertEqual(platforms, [nil, "ios", nil])
    }
}
