#if DEBUG
import Foundation

/// Debug-only offline transport for UI tests (design-mobile.md section 6). Selected by
/// `RpcTransports.launch` only when launched with `-uiTestOfflineFixtures <state>`, and absent
/// from Release builds. It answers from `RpcFixtures.generated.swift` (rendered from the
/// extension's network catalog and its recorded send path), echoing each request's id, so the
/// core judges these answers exactly as live ones. A write is refused with a JSON-RPC error and
/// counted, so a test can prove that nothing was ever broadcast. Only the published wallet's
/// primary account (`RpcFixtures.primaryAccounts`) exists on this node: every other address is
/// undeployed and empty, so account discovery finds exactly that one account.
struct FixtureTransport: RpcTransport {
    enum Failure: Error { case offline, unknownRequest }

    /// JSON-RPC "method not found", the error every write and unmodelled read receives.
    private static let methodNotFoundCode = -32_601

    let state: RpcFixtures.State

    /// The state named by the launch arguments, if the offline seam was requested.
    static func requested(in arguments: [String] = ProcessInfo.processInfo.arguments) -> Self? {
        guard let flag = arguments.firstIndex(of: "-uiTestOfflineFixtures"),
              arguments.indices.contains(flag + 1),
              let named = RpcFixtures.State(rawValue: arguments[flag + 1]) else { return nil }
        return Self(state: named)
    }

    /// Writes this process's fixture node has received (always refused).
    static let writes = WriteCounter()

    final class WriteCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0

        var value: Int { lock.withLock { count } }

        func increment() { lock.withLock { count += 1 } }
    }

    private var deployed: Bool { state != .undeployed && state != .unfunded }

    func post(_ body: String, to url: URL, write: Bool) throws -> String {
        if write { Self.writes.increment() }
        if state == .balanceError { throw Failure.offline }
        guard let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let id = request["id"] as? Int,
              let method = request["method"] as? String else { throw Failure.unknownRequest }
        let params = request["params"] as? [String: Any] ?? [:]
        let answer: [String: Any]
        switch method {
        case "starknet_chainId":
            guard let chainId = RpcFixtures.chainIds[url.absoluteString] else { throw Failure.unknownRequest }
            answer = ["result": chainId]

        case "starknet_call":
            let call = params["request"] as? [String: Any]
            guard let token = call?["contract_address"] as? String,
                  let limbs = RpcFixtures.readyBalances[token] else { throw Failure.unknownRequest }
            let holder = (call?["calldata"] as? [String])?.first ?? ""
            let empty = state == .empty || state == .unfunded || !RpcFixtures.primaryAccounts.contains(holder)
            answer = ["result": empty ? ["0x0", "0x0"] : limbs]

        case "starknet_getClassHashAt":
            let address = params["contract_address"] as? String ?? ""
            let exists = deployed && RpcFixtures.primaryAccounts.contains(address)
            answer = try Self.object(exists ? RpcFixtures.deployedClassHash : RpcFixtures.undeployedClassHash)

        case "starknet_getNonce":
            answer = try Self.object(deployed ? RpcFixtures.deployedNonce : RpcFixtures.undeployedNonce)

        case "starknet_estimateFee" where state == .feeFailure:
            answer = try Self.object(RpcFixtures.estimateFailure)

        case "starknet_estimateFee":
            let transactions = params["request"] as? [[String: Any]] ?? []
            answer = [
                "result": try transactions.map { transaction in
                    let deploys = transaction["type"] as? String == "DEPLOY_ACCOUNT"
                    return try Self.object(deploys ? RpcFixtures.deployEstimate : RpcFixtures.invokeEstimate)
                }
            ]

        default:
            // Every write (and any read the fixtures do not model) is refused: nothing broadcasts.
            answer = ["error": ["code": Self.methodNotFoundCode, "message": "The UI-test fixture never broadcasts"]]
        }
        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
        reply.merge(answer) { _, new in new }
        let data = try JSONSerialization.data(withJSONObject: reply)
        // JSONSerialization always writes UTF-8, so this never throws in practice.
        guard let text = String(bytes: data, encoding: .utf8) else { throw Failure.unknownRequest }
        return text
    }

    private static func object(_ json: String) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
            throw Failure.unknownRequest
        }
        return value
    }
}
#endif
