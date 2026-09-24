@testable import Bramble
import BrambleCore
import XCTest

/// The send plan through the generated Swift bindings on a simulator: replays the extension's
/// recorded wire traffic (`extension-transactions-*.json`) and checks the shared presentation
/// rules, so a binding or linking fault shows up as a wrong body or hash here.
final class TransferBridgeTests: XCTestCase {
    private func json(_ text: String) -> NSDictionary {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? NSDictionary ?? [:]
    }

    /// Replays one recorded scenario request by request; returns the broadcast hash.
    private func replay(_ scenario: [String: Any], core: WalletCore) throws -> String {
        let network: NetworkId = scenario["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
        let plan = try core.prepareTransfer(request: TransferRequest(
            network: network, accountIndex: 0, tokenAddress: scenario["token"] as! String,
            recipient: scenario["recipient"] as! String, amount: scenario["amount"] as! String, feeBalance: nil))
        let chain = network == .mainnet ? "0x534e5f4d41494e" : "0x534e5f5345504f4c4941"
        let review = ((scenario["reviewInvoke"] as! [[String: Any]]) + (scenario["reviewDeployment"] as! [[String: Any]]))
            .filter { $0["method"] as? String != "starknet_chainId" }
        let submit = scenario["submit"] as! [[String: Any]]
        var expected = review[...]
        var step = try plan.advance(reply: .start)
        var confirmed = false
        while true {
            switch step {
            case let .rpc(id, body, _, _):
                let sent = json(body)
                let method = sent["method"] as! String
                let reply: Any
                if method == "starknet_chainId" && (expected.first?["method"] as? String) != method {
                    reply = ["result": chain]
                } else {
                    let exchange = try XCTUnwrap(expected.popFirst(), "mobile sent an extra \(method)")
                    XCTAssertEqual(method, exchange["method"] as? String)
                    if method != "starknet_chainId" {
                        XCTAssertEqual(sent["params"] as? NSDictionary, exchange["params"] as? NSDictionary, method)
                    }
                    reply = exchange["reply"]!
                }
                var envelope = (reply as! [String: Any])
                envelope["jsonrpc"] = "2.0"
                envelope["id"] = id
                let text = String(decoding: try JSONSerialization.data(withJSONObject: envelope), as: UTF8.self)
                step = try plan.advance(reply: .rpc(id: id, body: text, nowMs: 1))
            case .wait:
                step = try plan.advance(reply: .waitElapsed)
            case .review:
                XCTAssertTrue(expected.isEmpty)
                XCTAssertFalse(confirmed)
                XCTAssertEqual(plan.currentReview()?.canConfirm, true)
                expected = submit[...]
                confirmed = true
                step = try plan.advance(reply: .confirm)
            case let .broadcast(hash):
                XCTAssertTrue(expected.isEmpty)
                return hash
            default:
                XCTFail("unexpected step \(step)")
                return ""
            }
        }
    }

    func testRecordedSendsReplayToTheExtensionHash() throws {
        let fixture = try transactionFixture()
        for scenario in fixture["scenarios"] as! [[String: Any]] where scenario["flow"] as? String == "transfer" {
            let core = try unlockedCore()
            XCTAssertEqual(try replay(scenario, core: core), scenario["transactionHash"] as? String, scenario["name"] as! String)
            // Nothing but public data left the plan: bodies carry [r, s]; no key, no bare signature.
            let pending = try core.activity(network: scenario["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia, accountIndex: 0)
            XCTAssertEqual(pending.first?.hash, scenario["transactionHash"] as? String)
        }
    }

    func testPresentationRulesMatchTheExtension() throws {
        let presentation = try transactionFixture()["presentation"] as! [String: Any]
        for case let entry as [String: Any] in presentation["recipients"] as! [Any] {
            XCTAssertEqual(validateRecipient(input: entry["input"] as! String), entry["valid"] as? String)
        }
        for case let entry as [String: Any] in presentation["shortAddresses"] as! [Any] {
            XCTAssertEqual(shortAddress(address: entry["input"] as! String), entry["short"] as? String)
        }
        for case let entry as [String: Any] in presentation["explorerTransactionUrls"] as! [Any] {
            let network: NetworkId = entry["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
            XCTAssertEqual(explorerTransactionUrl(network: network, hash: entry["hash"] as! String), entry["url"] as? String)
        }
        let amounts = (try transactionFixture()["calls"] as! [String: Any])["amounts"] as! [[String: Any]]
        for entry in amounts {
            let parsed = try? parseTokenAmount(amount: entry["amount"] as! String, decimals: UInt8(entry["decimals"] as! Int))
            if let raw = entry["raw"] as? String, raw.count <= 77 {
                XCTAssertEqual(parsed, raw)
            } else if entry["error"] is String {
                XCTAssertNil(parsed)
            }
        }
        XCTAssertEqual(confirmationCheckpointsMs(), ((try transactionFixture()["timing"] as! [String: Any])["confirmationDelaysMs"] as! [Int]).map(UInt32.init))
    }

    func testCopyTableIsTheExtensionCopy() throws {
        let copy = try transactionFixture()["copy"] as! [String: Any]
        let mode = copy["mode"] as! [String: String]
        XCTAssertEqual(SendCopy.confirmLabel, mode["confirmLabel"])
        XCTAssertEqual(SendCopy.reviewNote, mode["reviewNote"])
        let failures = copy["failures"] as! [String: String]
        XCTAssertEqual(SendFailureText.reason(.preparationUnavailable), failures["preparationUnavailable"])
        XCTAssertEqual(SendFailureText.reason(.submissionIndeterminate), failures["indeterminate"])
        XCTAssertEqual(SendFailureText.reason(.deploymentThenInvokeUnconfirmed), failures["deploymentThenInvokeUnconfirmed"])
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .deploymentUnconfirmed, hash: "0xabc")),
            SendCopy.failurePrefix + failures["deploymentUnconfirmed"]!.replacingOccurrences(of: "{hash}", with: "0xabc"))
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .nodeError, hash: nil)), SendCopy.failureDefault)
        XCTAssertEqual(SendCopy.keepAppOpen, (copy["mobileWording"] as! [String: String])["keepOpen"])
    }

    func testPendingRecordsAreObservedOnTheExtensionsWindow() throws {
        let status = try transactionFixture()["status"] as! [String: Any]
        let window = UInt64(status["unresolvedWindowMs"] as! Int)
        XCTAssertEqual(activityObservationPeriodMs(), UInt64(status["fastObservationPeriodMinutes"] as! Int) * 60_000)
        func record(_ status: TxStatus) -> ActivityRecord {
            ActivityRecord(hash: "0xab", kind: .transfer, status: status, summary: "s", amount: nil, counterparty: nil, token: nil, submittedAtMs: 1_000, explorerUrl: nil)
        }
        XCTAssertTrue(activityNeedsObservation(record: record(.pending), nowMs: 1_000 + window - 1))
        XCTAssertFalse(activityNeedsObservation(record: record(.pending), nowMs: 1_000 + window))
        XCTAssertFalse(activityNeedsObservation(record: record(.accepted), nowMs: 1_000))
    }

    func testZeroRecipientIsRefusedByTheCore() throws {
        let core = try unlockedCore()
        let token = sepolia().tokens.first { $0.symbol == "STRK" }!.address
        for zero in ["0x0", "0x" + String(repeating: "0", count: 64)] {
            XCTAssertThrowsError(try core.prepareTransfer(request: TransferRequest(network: .sepolia, accountIndex: 0, tokenAddress: token, recipient: zero, amount: "1", feeBalance: nil))) { error in
                guard case .InvalidRecipient = error as? SendError else { return XCTFail("\(error)") }
            }
        }
    }
}
