@testable import Bramble
import BrambleCore
import XCTest

/// The send plan through the generated Swift bindings on a simulator: replays the extension's
/// recorded wire traffic (`extension-transactions-*.json`) and checks the shared presentation
/// rules, so a binding or linking fault shows up as a wrong body or hash here.
final class TransferBridgeTests: XCTestCase {
    private func network(_ scenario: [String: Any]) -> NetworkId {
        scenario["networkId"] as? String == "SN_MAIN" ? .mainnet : .sepolia
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
        let step = try RecordedWire.replay(
            plan,
            network: network,
            review: RecordedWire.review(scenario),
            submit: try fixtureValue(scenario, "submit")
        )
        guard case let .broadcast(hash) = step else {
            XCTFail("unexpected step \(step)")
            return ""
        }
        return hash
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
        XCTAssertEqual(activityObservationPeriodFor(record: record(.pending)), UInt64(fastMinutes) * 60_000)

        // The slow tier: accepted and awaiting L1, read every quarter hour for seven days.
        let l1WindowMs: Int = try fixtureValue(status, "l1FinalityWindowMs")
        let l1Window = UInt64(l1WindowMs)
        let slowMinutes: Int = try fixtureValue(status, "slowObservationPeriodMinutes")
        XCTAssertTrue(activityNeedsObservation(record: record(.accepted), nowMs: 1_000 + l1Window - 1))
        XCTAssertFalse(activityNeedsObservation(record: record(.accepted), nowMs: 1_000 + l1Window))
        XCTAssertEqual(activityObservationPeriodFor(record: record(.accepted)), UInt64(slowMinutes) * 60_000)
        var final = record(.accepted)
        final.finalizedOnL1 = true
        XCTAssertFalse(activityNeedsObservation(record: final, nowMs: 1_000))
        XCTAssertFalse(activityNeedsObservation(record: record(.reverted), nowMs: 1_000))
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
