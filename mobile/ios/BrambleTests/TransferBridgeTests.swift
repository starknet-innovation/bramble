@testable import Bramble
import BrambleCore
import XCTest

/// The send plan through the generated Swift bindings on a simulator: replays the extension's
/// recorded wire traffic (`extension-transactions-*.json`) and checks the shared presentation
/// rules, so a binding or linking fault shows up as a wrong body or hash here.
final class TransferBridgeTests: XCTestCase {
    private func json(_ text: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
    }

    private func network(_ scenario: [String: Any]) -> NetworkId {
        scenario["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
    }

    /// The reply to one request the plan sent: the chain id when the recording skipped it,
    /// otherwise the next recorded exchange, whose method and params must match what was sent.
    private func reply(
        to body: String,
        expected: inout ArraySlice<[String: Any]>,
        chain: String
    ) throws -> [String: Any] {
        let sent = json(body)
        let method: String = try fixtureValue(sent, "method")
        if method == "starknet_chainId", (expected.first?["method"] as? String) != method {
            return ["result": chain]
        }
        let exchange = try XCTUnwrap(expected.popFirst(), "mobile sent an extra \(method)")
        XCTAssertEqual(method, exchange["method"] as? String)
        if method != "starknet_chainId" {
            XCTAssertEqual(
                sent["params"] as? [String: AnyHashable],
                exchange["params"] as? [String: AnyHashable],
                method
            )
        }
        return try fixtureValue(exchange, "reply")
    }

    /// Replays one recorded scenario request by request; returns the broadcast hash.
    private func replay(_ scenario: [String: Any], core: WalletCore) throws -> String {
        let network = network(scenario)
        let plan = try core.prepareTransfer(request: TransferRequest(
            network: network,
            accountId: try ozRecord(core, network).id,
            tokenAddress: try fixtureValue(scenario, "token"),
            recipient: try fixtureValue(scenario, "recipient"),
            amount: try fixtureValue(scenario, "amount"),
            feeBalance: nil
        ))
        let chain = network == .mainnet ? "0x534e5f4d41494e" : "0x534e5f5345504f4c4941"
        let reviewInvoke: [[String: Any]] = try fixtureValue(scenario, "reviewInvoke")
        let reviewDeployment: [[String: Any]] = try fixtureValue(scenario, "reviewDeployment")
        let review = (reviewInvoke + reviewDeployment).filter { $0["method"] as? String != "starknet_chainId" }
        let submit: [[String: Any]] = try fixtureValue(scenario, "submit")
        var expected = review[...]
        var step = try plan.advance(reply: .start)
        var confirmed = false
        while true {
            switch step {
            case let .rpc(id, body, _, _):
                var envelope = try reply(to: body, expected: &expected, chain: chain)
                envelope["jsonrpc"] = "2.0"
                envelope["id"] = id
                let data = try JSONSerialization.data(withJSONObject: envelope)
                let text = try XCTUnwrap(String(bytes: data, encoding: .utf8))
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
        let scenarios: [[String: Any]] = try fixtureValue(fixture, "scenarios")
        for scenario in scenarios where scenario["flow"] as? String == "transfer" {
            let core = try unlockedCore()
            let name: String = try fixtureValue(scenario, "name")
            XCTAssertEqual(try replay(scenario, core: core), scenario["transactionHash"] as? String, name)
            // Nothing but public data left the plan: bodies carry [r, s]; no key, no bare signature.
            let pending = try core.activity(accountId: try ozRecord(core, network(scenario)).id)
            XCTAssertEqual(pending.first?.hash, scenario["transactionHash"] as? String)
        }
    }

    func testPresentationRulesMatchTheExtension() throws {
        let presentation: [String: Any] = try fixtureValue(transactionFixture(), "presentation")
        let recipients: [Any] = try fixtureValue(presentation, "recipients")
        for case let entry as [String: Any] in recipients {
            XCTAssertEqual(validateRecipient(input: try fixtureValue(entry, "input")), entry["valid"] as? String)
        }
        let shortAddresses: [Any] = try fixtureValue(presentation, "shortAddresses")
        for case let entry as [String: Any] in shortAddresses {
            XCTAssertEqual(shortAddress(try fixtureValue(entry, "input")), entry["short"] as? String)
        }
        let explorerUrls: [Any] = try fixtureValue(presentation, "explorerTransactionUrls")
        for case let entry as [String: Any] in explorerUrls {
            let network: NetworkId = entry["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
            let hash: String = try fixtureValue(entry, "hash")
            XCTAssertEqual(explorerTransactionUrl(network: network, hash: hash), entry["url"] as? String)
        }
        let calls: [String: Any] = try fixtureValue(transactionFixture(), "calls")
        let amounts: [[String: Any]] = try fixtureValue(calls, "amounts")
        for entry in amounts {
            let amount: String = try fixtureValue(entry, "amount")
            let decimals: Int = try fixtureValue(entry, "decimals")
            let parsed = try? parseTokenAmount(amount: amount, decimals: UInt8(decimals))
            if let raw = entry["raw"] as? String, raw.count <= 77 {
                XCTAssertEqual(parsed, raw)
            } else if entry["error"] is String {
                XCTAssertNil(parsed)
            }
        }
        let timing: [String: Any] = try fixtureValue(transactionFixture(), "timing")
        let delays: [Int] = try fixtureValue(timing, "confirmationDelaysMs")
        XCTAssertEqual(confirmationCheckpointsMs(), delays.map(UInt32.init))
    }

    func testCopyTableIsTheExtensionCopy() throws {
        let copy: [String: Any] = try fixtureValue(transactionFixture(), "copy")
        let mode: [String: String] = try fixtureValue(copy, "mode")
        XCTAssertEqual(SendCopy.confirmLabel, mode["confirmLabel"])
        XCTAssertEqual(SendCopy.reviewNote, mode["reviewNote"])
        let failures: [String: String] = try fixtureValue(copy, "failures")
        XCTAssertEqual(SendFailureText.reason(.preparationUnavailable), failures["preparationUnavailable"])
        XCTAssertEqual(SendFailureText.reason(.submissionIndeterminate), failures["indeterminate"])
        XCTAssertEqual(
            SendFailureText.reason(.deploymentThenInvokeUnconfirmed),
            failures["deploymentThenInvokeUnconfirmed"]
        )
        let deploymentUnconfirmed = try XCTUnwrap(failures["deploymentUnconfirmed"])
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .deploymentUnconfirmed, hash: "0xabc")),
            SendCopy.failurePrefix + deploymentUnconfirmed.replacingOccurrences(of: "{hash}", with: "0xabc")
        )
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .nodeError, hash: nil)), SendCopy.failureDefault)
        let mobileWording: [String: String] = try fixtureValue(copy, "mobileWording")
        XCTAssertEqual(SendCopy.keepAppOpen, mobileWording["keepOpen"])
    }

    func testPendingRecordsAreObservedOnTheExtensionsWindow() throws {
        let status: [String: Any] = try fixtureValue(transactionFixture(), "status")
        let windowMs: Int = try fixtureValue(status, "unresolvedWindowMs")
        let window = UInt64(windowMs)
        let fastMinutes: Int = try fixtureValue(status, "fastObservationPeriodMinutes")
        XCTAssertEqual(activityObservationPeriodMs(), UInt64(fastMinutes) * 60_000)
        func record(_ status: TxStatus) -> ActivityEntry {
            ActivityEntry(
                accountId: "SN_SEPOLIA:0x1",
                amount: nil,
                counterparty: nil,
                failureNotice: nil,
                finalizedOnL1: nil,
                hash: "0xab",
                kind: .transfer,
                network: .sepolia,
                notFoundCount: nil,
                status: status,
                submittedAt: 1_000,
                summary: "s",
                token: nil
            )
        }
        XCTAssertTrue(activityNeedsObservation(record: record(.pending), nowMs: 1_000 + window - 1))
        XCTAssertFalse(activityNeedsObservation(record: record(.pending), nowMs: 1_000 + window))
        XCTAssertFalse(activityNeedsObservation(record: record(.accepted), nowMs: 1_000))
    }

    func testZeroRecipientIsRefusedByTheCore() throws {
        let core = try unlockedCore()
        let token = try XCTUnwrap(sepolia().tokens.first { $0.symbol == "STRK" }).address
        for zero in ["0x0", "0x" + String(repeating: "0", count: 64)] {
            let request = TransferRequest(
                network: .sepolia,
                accountId: try ozRecord(core, .sepolia).id,
                tokenAddress: token,
                recipient: zero,
                amount: "1",
                feeBalance: nil
            )
            XCTAssertThrowsError(try core.prepareTransfer(request: request)) { error in
                guard case .InvalidRecipient = error as? SendError else { return XCTFail("\(error)") }
            }
        }
    }
}
