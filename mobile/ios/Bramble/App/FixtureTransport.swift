#if DEBUG
import Foundation

/// Debug-only offline transport for UI tests (design-mobile.md section 6). Installed by
/// `BrambleApp` only when launched with `-uiTestOfflineFixtures <state>`, and absent from Release
/// builds. It answers from `RpcFixtures.generated.swift` (rendered from the extension's network
/// catalog), echoing each request's id, so the core judges these answers exactly as live ones.
struct FixtureTransport: RpcTransport {
    enum Failure: Error { case offline, unknownRequest }

    let state: RpcFixtures.State

    /// The state named by the launch arguments, if the offline seam was requested.
    static func requested(in arguments: [String] = ProcessInfo.processInfo.arguments) -> FixtureTransport? {
        guard let flag = arguments.firstIndex(of: "-uiTestOfflineFixtures"),
              arguments.indices.contains(flag + 1),
              let state = RpcFixtures.State(rawValue: arguments[flag + 1]) else { return nil }
        return FixtureTransport(state: state)
    }

    func post(_ body: String, to url: URL) async throws -> String {
        if state == .balanceError { throw Failure.offline }
        guard let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let id = request["id"] as? Int,
              let method = request["method"] as? String else { throw Failure.unknownRequest }
        let result: Any
        switch method {
        case "starknet_chainId":
            guard let chainId = RpcFixtures.chainIds[url.absoluteString] else { throw Failure.unknownRequest }
            result = chainId
        case "starknet_call":
            let call = (request["params"] as? [String: Any])?["request"] as? [String: Any]
            guard let token = call?["contract_address"] as? String,
                  let limbs = RpcFixtures.readyBalances[token] else { throw Failure.unknownRequest }
            result = state == .empty ? ["0x0", "0x0"] : limbs
        default:
            throw Failure.unknownRequest
        }
        let response: [String: Any] = ["jsonrpc": "2.0", "id": id, "result": result]
        return String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
    }
}
#endif
