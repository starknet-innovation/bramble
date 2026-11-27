import BrambleCore
import Foundation
import XCTest

/// Replays the extension's recorded wire traffic (`extension-transactions-*.json`) against a send
/// plan through the generated bindings. Every request the plan sends must be the next recorded
/// one, with equal params; the reply is the one the extension was given.
enum RecordedWire {
    /// The chain id a network's node reports.
    static func chain(_ network: NetworkId) -> String {
        network == .mainnet ? "0x534e5f4d41494e" : "0x534e5f5345504f4c4941"
    }

    /// A recorded phase's exchanges, without the chain reads starknet.js makes inside estimates.
    static func review(_ scenario: [String: Any]) throws -> [[String: Any]] {
        let invoke: [[String: Any]] = try fixtureValue(scenario, "reviewInvoke")
        let deployment: [[String: Any]] = try fixtureValue(scenario, "reviewDeployment")
        return (invoke + deployment).filter { $0["method"] as? String != "starknet_chainId" }
    }

    private static func json(_ text: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
    }

    /// The reply to one request the plan sent: the chain id when the recording skipped it,
    /// otherwise the next recorded exchange, whose method and params must match what was sent.
    private static func reply(
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

    /// Runs `plan` from the start: the review is answered from `review`, the plan is confirmed
    /// when its review allows it, and the submission is answered from `submit`. Returns the
    /// first step that ends the replay: a broadcast, a failure, or a review that cannot confirm.
    static func replay(
        _ plan: TransferPlan,
        network: NetworkId,
        review: [[String: Any]],
        submit: [[String: Any]]
    ) throws -> SendStep {
        var expected = review[...]
        var step = try plan.advance(reply: .start)
        while true {
            switch step {
            case let .rpc(id, body, _, _):
                var envelope = try reply(to: body, expected: &expected, chain: chain(network))
                envelope["jsonrpc"] = "2.0"
                envelope["id"] = id
                let data = try JSONSerialization.data(withJSONObject: envelope)
                let text = try XCTUnwrap(String(bytes: data, encoding: .utf8))
                step = try plan.advance(reply: .rpc(id: id, body: text, nowMs: 1))

            case .wait:
                step = try plan.advance(reply: .waitElapsed)

            case .review:
                XCTAssertTrue(expected.isEmpty, "the review stopped before the extension's did")
                guard plan.currentReview()?.canConfirm == true else { return step }
                expected = submit[...]
                step = try plan.advance(reply: .confirm)

            default:
                XCTAssertTrue(expected.isEmpty, "the plan stopped before the extension did")
                return step
            }
        }
    }
}
