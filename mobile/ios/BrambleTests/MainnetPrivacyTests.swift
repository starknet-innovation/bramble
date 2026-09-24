import BrambleCore
import XCTest

/// A real, read-only private-balance read on Starknet Mainnet. Skipped unless
/// `TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_LIVE_ACK` is exactly the acknowledgement below and no CI
/// marker is set; it needs `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC`. It sends that wallet's
/// scoped viewing key to the configured Mainnet discovery service, exactly as the extension does,
/// and prints no key or phrase. Never run by agents; never commit the phrase.
@MainActor
final class MainnetPrivacyTests: XCTestCase {
    static let acknowledgement = "I understand this sends my viewing key to the privacy service"

    func testReadsPrivateBalancesOnMainnet() async throws {
        let environment = ProcessInfo.processInfo.environment
        let ciMarkers = ["CI", "TEST_RUNNER_CI", "GITHUB_ACTIONS", "TEST_RUNNER_GITHUB_ACTIONS"]
        guard ciMarkers.allSatisfy({ environment[$0] == nil }) else { throw XCTSkip("refused under CI") }
        guard environment["BRAMBLE_MOBILE_PRIVACY_LIVE_ACK"] == Self.acknowledgement else {
            throw XCTSkip("set TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_LIVE_ACK to opt in")
        }
        let phrase = try XCTUnwrap(environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"])
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let core = try WalletCore(dataDir: dir.path)
        try core.importWallet(password: "mainnet privacy test", phrase: phrase, passphrase: nil)
        let model = PrivacyModel()
        let rpc = URLSessionRpcTransport()
        await model.refresh(core: core, network: mainnet(), accountIndex: 0, rpc: rpc, transports: (URLSessionPrivacyTransport(), rpc))
        guard case .settled = model.reading else { return XCTFail("read failed: \(model.reading)") }
    }
}
