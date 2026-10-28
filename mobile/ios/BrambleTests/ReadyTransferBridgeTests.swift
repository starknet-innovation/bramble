@testable import Bramble
import BrambleCore
import XCTest

/// Ready (Argent) sends through the generated Swift bindings: replays the extension's recorded
/// Ready send path (`extension-transactions-argent*.json`, `scripts/mobile-transactions-argent.ts`)
/// for the published phrase's Ready account under each Argent class, and the extension's refusals.
final class ReadyTransferBridgeTests: XCTestCase {
    private func load(_ part: String, _ key: String) throws -> [[String: Any]] {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "extension-transactions-\(part)", withExtension: "json")
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let entries: [[String: Any]] = try fixtureValue(object, key)
        return entries.map { entry in
            var decoded = entry
            for phase in ["reviewInvoke", "reviewDeployment", "submit"] {
                decoded[phase] = (entry[phase] as? [String] ?? []).compactMap { line in
                    try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
                }
            }
            return decoded
        }
    }

    private func network(_ scenario: [String: Any]) -> NetworkId {
        scenario["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
    }

    /// A wallet holding only the published phrase's Ready account at index 0 under `recordClass`.
    private func readyWallet(_ scenario: [String: Any]) throws -> (WalletCore, AccountRecord) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        try core.importWallet(password: testPassword, phrase: publicPhrase, passphrase: nil)
        let label: String = try fixtureValue(scenario, "recordClass")
        let classHash = try XCTUnwrap(accountClasses().first { $0.label == label }).classHash
        let selection = RecoverySelection(family: .argent, accountIndex: 0, classHash: classHash)
        let record = try XCTUnwrap(
            try core.restoreRecoveredAccounts(network: network(scenario), selections: [selection]).first
        )
        return (core, record)
    }

    private func plan(_ scenario: [String: Any], _ core: WalletCore, _ record: AccountRecord) throws -> TransferPlan {
        if scenario["flow"] as? String == "deployment" {
            return try core.prepareDeployment(accountId: record.id)
        }
        let token = try XCTUnwrap(
            supportedNetworks().first { $0.network == record.network }?.tokens.first { $0.symbol == "STRK" }
        )
        return try core.prepareTransfer(request: TransferRequest(
            network: record.network,
            accountId: record.id,
            tokenAddress: token.address,
            recipient: account1,
            amount: "1.5",
            feeBalance: nil
        ))
    }

    func testRecordedReadySendsReplayToTheExtensionHash() throws {
        let scenarios = try load("argent", "scenarios") + load("argent-upgraded", "scenarios")
        XCTAssertEqual(scenarios.count, 7)
        for scenario in scenarios {
            let name: String = try fixtureValue(scenario, "name")
            let (core, record) = try readyWallet(scenario)
            let account: [String: Any] = try fixtureValue(scenario, "account")
            XCTAssertEqual(record.address, account["address"] as? String, name)
            let step = try RecordedWire.replay(
                plan(scenario, core, record),
                network: record.network,
                review: RecordedWire.review(scenario),
                submit: try fixtureValue(scenario, "submit")
            )
            guard case let .broadcast(hash) = step else {
                XCTFail("\(name): no broadcast, \(step)")
                continue
            }
            XCTAssertEqual(hash, scenario["transactionHash"] as? String, name)
        }
    }

    func testReadyAccountsTheExtensionRefusesAreRefusedBeforeSigning() throws {
        let refusals = try load("argent-refusals", "refusals")
        XCTAssertEqual(refusals.count, 9)
        for refusal in refusals {
            let name: String = try fixtureValue(refusal, "name")
            let (core, record) = try readyWallet(refusal)
            let plan = try plan(refusal, core, record)
            let step = try RecordedWire.replay(
                plan,
                network: record.network,
                review: RecordedWire.review(refusal),
                submit: try fixtureValue(refusal, "submit")
            )
            if let expected = refusal["submitMessage"] as? String {
                guard case let .failed(failure) = step else {
                    XCTFail("\(name): not refused, \(step)")
                    continue
                }
                XCTAssertEqual(SendFailureText.message(failure), SendCopy.failurePrefix + expected, name)
            } else {
                guard case .review = step else {
                    XCTFail("\(name): \(step)")
                    continue
                }
                XCTAssertEqual(plan.currentReview()?.feeEstimateFailed, true, name)
            }
            // A pending record precedes every signed write; none means nothing was signed or sent.
            XCTAssertTrue(try core.activity(accountId: record.id).isEmpty, name)
        }
    }

    func testReadyRefusalsUseTheExtensionCopy() {
        let unsupported = SendFailure(code: .accountClassUnsupported, hash: nil, detail: "argent 0.3.1")
        XCTAssertEqual(
            SendFailureText.message(unsupported),
            SendCopy.failurePrefix + "Deployed Argent account class "
                + "expects an authorization format this wallet does not produce"
        )
        let codes: [SendFailureCode] = [
            .accountClassUnrecognised, .accountNotDeployable, .accountOwnerMismatch,
            .accountOwnerTypeUnsupported, .accountGuardianUnsupported
        ]
        for code in codes {
            XCTAssertNotNil(SendFailureText.reason(code), "\(code)")
        }
    }
}
