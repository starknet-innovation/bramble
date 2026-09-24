#if DEBUG
import Foundation

/// A canned Starknet node for UI tests, selected with `-BrambleRpcFixture <scenario>` on a DEBUG
/// build. It answers every read the app makes and never contacts a network. A write is refused
/// with a JSON-RPC error and counted, so a test can assert that nothing was ever broadcast.
///
/// Scenarios: `transfer-deployed`, `transfer-undeployed`, `transfer-fee-failure`,
/// `transfer-unfunded` (undeployed with a zero STRK balance).
struct FixtureRpcTransport: RpcTransport {
    let scenario: String

    static var launchScenario: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-BrambleRpcFixture"), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    /// Writes this process's fixture node has received (always refused).
    static let writes = WriteCounter()

    final class WriteCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        var value: Int { lock.withLock { count } }
        func increment() { lock.withLock { count += 1 } }
    }

    private var deployed: Bool { scenario == "transfer-deployed" || scenario == "transfer-fee-failure" }

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? UInt64 ?? 0
        let method = request["method"] as? String ?? ""
        let params = request["params"] as? [String: Any] ?? [:]
        let answer: [String: Any]
        switch method {
        case "starknet_chainId":
            answer = ["result": url.absoluteString.contains("sepolia") ? "0x534e5f5345504f4c4941" : "0x534e5f4d41494e"]
        case "starknet_call":
            let balance = scenario == "transfer-unfunded" ? "0x0" : "0x56bc75e2d63100000" // 100 tokens
            answer = ["result": [balance, "0x0"]]
        case "starknet_getClassHashAt":
            answer = deployed
                ? ["result": "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"]
                : ["error": ["code": 20, "message": "Contract not found"]]
        case "starknet_getNonce":
            answer = deployed ? ["result": "0x5"] : ["error": ["code": 20, "message": "Contract not found"]]
        case "starknet_estimateFee" where scenario == "transfer-fee-failure":
            answer = ["error": ["code": 41, "message": "Transaction execution error"]]
        case "starknet_estimateFee":
            let request = params["request"] as? [[String: Any]] ?? []
            answer = ["result": request.map { ($0["type"] as? String) == "DEPLOY_ACCOUNT" ? Self.deployEstimate : Self.invokeEstimate }]
        case "starknet_getTransactionStatus":
            answer = ["result": ["finality_status": "ACCEPTED_ON_L2", "execution_status": "SUCCEEDED"]]
        default:
            if write { Self.writes.increment() }
            answer = ["error": ["code": -32601, "message": "The UI-test fixture never broadcasts"]]
        }
        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
        reply.merge(answer) { _, new in new }
        return String(decoding: try JSONSerialization.data(withJSONObject: reply), as: UTF8.self)
    }

    private static let invokeEstimate: [String: String] = [
        "l1_data_gas_consumed": "0x180", "l1_data_gas_price": "0x5a0", "l1_gas_consumed": "0x0",
        "l1_gas_price": "0x2d5c6b1e1ef", "l2_gas_consumed": "0x1234a0", "l2_gas_price": "0xb2d05e00",
        "overall_fee": "0x1", "unit": "FRI",
    ]
    private static let deployEstimate: [String: String] = [
        "l1_data_gas_consumed": "0x1e0", "l1_data_gas_price": "0x5a0", "l1_gas_consumed": "0x0",
        "l1_gas_price": "0x2d5c6b1e1ef", "l2_gas_consumed": "0xf4240", "l2_gas_price": "0xb2d05e00",
        "overall_fee": "0xabc", "unit": "FRI",
    ]
}
#endif
