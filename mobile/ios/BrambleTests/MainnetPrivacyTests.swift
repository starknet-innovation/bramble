@testable import Bramble
import BrambleCore
import XCTest

/// A real, read-only private-balance read on Starknet Mainnet. Skipped unless
/// `TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_LIVE_ACK` is exactly the acknowledgement below and no CI
/// marker is set; it needs `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC`, and checks
/// `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_ADDRESS` when given. It sends that wallet's scoped viewing
/// key to the Mainnet discovery service (or `TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL`),
/// exactly as the extension does. Nothing is signed or broadcast. It prints public results only
/// (deployment, registration, per-token totals, pool fee, each page's `block_ref`, latencies),
/// never a key or the phrase. Never commit the phrase; delete the `.xcresult` after a run.
@MainActor
final class MainnetPrivacyTests: XCTestCase {
    private static let acknowledgement = "I understand this sends my viewing key to the privacy service"

    func testReadsPrivateBalancesOnMainnet() async throws {
        let environment = ProcessInfo.processInfo.environment
        let ciMarkers = ["CI", "TEST_RUNNER_CI", "GITHUB_ACTIONS", "TEST_RUNNER_GITHUB_ACTIONS"]
        guard ciMarkers.allSatisfy({ environment[$0] == nil }) else { throw XCTSkip("refused under CI") }
        guard environment["BRAMBLE_MOBILE_PRIVACY_LIVE_ACK"] == Self.acknowledgement else {
            throw XCTSkip("set TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_LIVE_ACK to opt in")
        }
        let phrase = try XCTUnwrap(environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"])
        // A refused override fails the test rather than reading from the default service.
        defer { try? setPrivacyDiscoveryOverride(network: .mainnet, url: nil) }
        let service = try XCTUnwrap(try PrivacyEndpointOverride.apply(environment: environment))
        print("discovery service: \(service)")

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        try core.importWallet(password: "mainnet privacy test", phrase: phrase, passphrase: nil)
        let account = try XCTUnwrap(try core.ensureNetworkAccount(network: .mainnet))
        if let expected = environment["BRAMBLE_MOBILE_MAINNET_ADDRESS"] {
            XCTAssertEqual(Self.canonical(account.address), Self.canonical(expected))
        }

        let rpc = URLSessionRpcTransport()
        if let body = deploymentStatusRequest(id: 1, address: account.address),
           let url = try mainnet().rpcUrls.first.flatMap(URL.init(string:)),
           let reply = try? await rpc.post(body, to: url, write: false) {
            print("account deployment: \(judgeDeploymentStatus(body: reply, id: 1))")
        }

        let recorder = RecordingPrivacyTransport()
        let model = PrivacyModel()
        let started = Date()
        try await model.refresh(
            core: core,
            network: mainnet(),
            accountId: account.id,
            rpc: rpc,
            transports: (recorder, rpc)
        )
        print("read total: \(Int(Date().timeIntervalSince(started) * 1_000)) ms")
        for line in recorder.lines { print(line) }
        guard case let .settled(registration) = model.reading, let state = model.state else {
            XCTFail("read failed: \(model.reading)")
            return
        }
        print("registration: \(registration)")
        for balance in state.balances {
            print("private \(balance.symbol): \(balance.formatted) (\(balance.balance) base units)")
        }
        print("pool fee: \(state.poolFeeFri) fri")
        let blocks = recorder.blockRefs
        print("discovery pages: \(blocks.count), block_ref per page: \(blocks)")
        XCTAssertLessThanOrEqual(Set(blocks).count, 1, "every page answered from the same block")
    }

    private static func canonical(_ value: String) -> String {
        String(value.lowercased().dropFirst(value.hasPrefix("0x") ? 2 : 0).drop { $0 == "0" })
    }
}

/// The production privacy transport, timing each POST and noting each discovery reply's
/// `block_ref`. It never reads the request body, which carries the viewing key.
private final class RecordingPrivacyTransport: PrivacyTransport, @unchecked Sendable {
    private static let millisecondsPerSecond = 1_000.0
    private static let httpOK = 200

    private let inner = URLSessionPrivacyTransport()
    private let lock = NSLock()
    private var recorded: [String] = []
    private var blocks: [String] = []

    var lines: [String] { lock.withLock { recorded } }
    var blockRefs: [String] { lock.withLock { blocks } }

    func post(_ body: Data, to url: URL) async throws -> (status: Int, body: Data) {
        let started = Date()
        let reply = try await inner.post(body, to: url)
        let path = url.lastPathComponent
        let elapsed = Int(Date().timeIntervalSince(started) * Self.millisecondsPerSecond)
        let object = try? JSONSerialization.jsonObject(with: reply.body) as? [String: Any]
        lock.withLock {
            recorded.append("\(path): HTTP \(reply.status), \(elapsed) ms")
            if path == "incoming_state", reply.status == Self.httpOK {
                blocks.append(object?["block_ref"].map { "\($0)" } ?? "missing")
            }
        }
        return reply
    }
}
