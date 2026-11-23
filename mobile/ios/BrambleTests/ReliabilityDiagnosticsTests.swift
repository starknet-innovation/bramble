@testable import Bramble
import BrambleCore
import XCTest

/// Reliability diagnostics: off by default, cleared when turned off, and fixed labels only.
final class ReliabilityDiagnosticsTests: XCTestCase {
    private let suite = "diagnostics-\(UUID().uuidString)"
    private lazy var defaults = UserDefaults(suiteName: suite) ?? .standard
    private let gateway = URL(string: "https://wallet.nodes.starknet.org/rpc") ?? URL(fileURLWithPath: "/")
    private let foundation = URL(string: "https://sepolia.nodes.starknet.org/rpc") ?? URL(fileURLWithPath: "/")
    private let secretHost = URL(
        string: "https://rpc.alice-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d.example/key"
    ) ?? URL(fileURLWithPath: "/")

    override func setUp() {
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    private func outcome(_ status: UInt16, body: Data? = Data(), timedOut: Bool = false) -> HttpOutcome {
        HttpOutcome(status: status, retryAfter: nil, body: body, timedOut: timedOut)
    }

    private func report(_ subject: ReliabilityDiagnostics) -> String {
        subject.report(accountCount: 2, network: .mainnet, version: "0.1.0")
    }

    func testOffByDefaultRecordsNothingAndChoiceIsRemembered() {
        let subject = ReliabilityDiagnostics(defaults: defaults)
        XCTAssertFalse(subject.enabled)
        subject.recordRpc(gateway, outcome(200), elapsed: .milliseconds(10))
        XCTAssertFalse(report(subject).contains("\"endpoint\""))
        subject.enabled = true
        XCTAssertTrue(ReliabilityDiagnostics(defaults: defaults).enabled)
    }

    func testCountsByClassAndOutcomeAndClearsWhenTurnedOff() {
        let subject = ReliabilityDiagnostics(defaults: defaults)
        subject.enabled = true
        subject.recordRpc(gateway, outcome(200), elapsed: .milliseconds(10))
        subject.recordRpc(gateway, outcome(200), elapsed: .milliseconds(30))
        subject.recordRpc(foundation, outcome(429), elapsed: .milliseconds(5))
        subject.recordRpc(secretHost, outcome(0, body: nil, timedOut: true), elapsed: .seconds(15))
        subject.recordExplorer(outcome(200), applied: false, elapsed: .milliseconds(7))
        let text = report(subject).replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "")
        let gatewayRow = "{\"count\":2,\"endpoint\":\"wallet-gateway\",\"latencyMs\":20,\"outcome\":\"ok\"}"
        XCTAssertTrue(text.contains(gatewayRow), text)
        XCTAssertTrue(text.contains("\"endpoint\":\"foundation\",\"latencyMs\":5,\"outcome\":\"rate-limited\""), text)
        XCTAssertTrue(text.contains("\"endpoint\":\"custom\",\"latencyMs\":15000,\"outcome\":\"timeout\""), text)
        XCTAssertTrue(text.contains("\"outcome\":\"invalid-response\",\"service\":\"starkscan\""), text)
        subject.enabled = false
        XCTAssertFalse(report(subject).contains("\"endpoint\""))
        XCTAssertFalse(report(subject).contains("starkscan"))
    }

    func testReportHoldsOnlyFixedFields() {
        let subject = ReliabilityDiagnostics(defaults: defaults)
        subject.enabled = true
        subject.recordRpc(secretHost, outcome(500), elapsed: .milliseconds(1))
        let text = report(subject)
        for forbidden in ["alice", "0x", "example", "key", "https", "address", "amount", "phrase", "note"] {
            XCTAssertFalse(text.localizedCaseInsensitiveContains(forbidden), "\(forbidden) in \(text)")
        }
        let keys = Set(text.matches(of: #/"([A-Za-z]+)" :/#).map { String($0.output.1) })
        XCTAssertEqual(keys, [
            "build", "platform", "version", "diagnostics", "accountCount", "collectionEnabled",
            "explorer", "networkId", "rpc", "count", "endpoint", "latencyMs", "outcome"
        ])
    }
}
