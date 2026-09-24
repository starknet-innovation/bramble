@testable import Bramble
import BrambleCore
import XCTest

/// A real mainnet send. Skipped unless `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_SEND_ACK` is exactly
/// the acknowledgement below and `CI` is unset; it needs a funded, deployed wallet through
/// `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC`, sends 0.000001 STRK to the same account, and
/// broadcasts a real transaction. Never run by agents; never commit the phrase.
@MainActor
final class MainnetSendTests: XCTestCase {
    static let acknowledgement = "I understand this broadcasts a real mainnet transaction"

    func testSelfTransferOnMainnet() async throws {
        let environment = ProcessInfo.processInfo.environment
        // xcodebuild forwards only TEST_RUNNER_-prefixed variables to the test process, so the
        // CI refusal checks both spellings; GitHub Actions also sets GITHUB_ACTIONS.
        let ciMarkers = ["CI", "TEST_RUNNER_CI", "GITHUB_ACTIONS", "TEST_RUNNER_GITHUB_ACTIONS"]
        guard ciMarkers.allSatisfy({ environment[$0] == nil }) else { throw XCTSkip("refused under CI") }
        guard environment["BRAMBLE_MOBILE_MAINNET_SEND_ACK"] == Self.acknowledgement else {
            throw XCTSkip("set TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_SEND_ACK to opt in")
        }
        let phrase = try XCTUnwrap(environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"])
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        // The imported vault must not outlive the test on any path, including a throw.
        defer { try? FileManager.default.removeItem(at: dir) }
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        try core.importWallet(password: "mainnet send test", phrase: phrase, passphrase: nil)
        let network = supportedNetworks().first { $0.network == .mainnet }!
        let account = try XCTUnwrap(try core.restoreRecoveredAccounts(network: .mainnet, selections: [
            RecoverySelection(family: .openZeppelin, accountIndex: 0, classHash: nil),
        ]).first)
        let model = SendFlowModel(core: core, network: network, account: account, otherAccounts: [], balances: [:], transport: URLSessionRpcTransport())
        model.recipientInput = account.address
        model.continueWithRecipient()
        model.amount = "0.000001"
        await model.reviewSend()
        XCTAssertEqual(model.stage, .review, model.reviewBlock ?? "")
        await model.confirm()
        XCTAssertTrue([.submitted, .pending].contains(model.stage), model.failureMessage ?? "")
    }
}
