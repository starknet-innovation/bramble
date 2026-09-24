#if DEBUG
import Foundation

/// A canned privacy service and pool node for UI tests, selected with
/// `-BramblePrivacyFixture <scenario>` on a DEBUG build. It answers the discovery POSTs and the
/// chain-id and `get_fee_amount` reads, never contacts a network, and never sees a write (the
/// privacy read plan has none; a write would be refused and counted).
///
/// Scenarios: `registered` (0.5 ETH private), `unregistered`, `service-failed` (HTTP 500), and
/// `offline` (every request fails; used whenever only `-BrambleRpcFixture` is given).
struct FixturePrivacyTransport: PrivacyTransport, RpcTransport {
    let scenario: String

    static var launchScenario: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-BramblePrivacyFixture"), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    /// Writes this process's fixture has received (always refused, always zero in practice).
    static let writes = FixtureRpcTransport.WriteCounter()

    private static let sender = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3"
    private static let eth = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"

    func post(_ body: Data, to url: URL) async throws -> (status: Int, body: Data) {
        if scenario == "offline" { throw URLError(.notConnectedToInternet) }
        if scenario == "service-failed" { return (500, Data("internal".utf8)) }
        let reply: [String: Any]
        if url.path.hasSuffix("/v1/sync/preflight_check") {
            reply = ["block_ref": "0x1", "sender_registered": scenario == "registered", "channel_exists": false, "subchannel_exists": false]
        } else {
            let note: [String: Any] = [
                "sender_addr": Self.sender, "token": Self.eth, "index": 0, "note_id": "0x1",
                "amount": "500000000000000000", "salt": "1", "block_number": 7,
            ]
            reply = [
                "block_ref": "0x1",
                "channels": [["channel_key": "0x77", "sender_addr": Self.sender]],
                "subchannels": [], "notes": [note],
                "cursor": ["channel_discovery_complete": true],
            ]
        }
        return (200, try JSONSerialization.data(withJSONObject: reply))
    }

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        if scenario == "offline" { throw URLError(.notConnectedToInternet) }
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? UInt64 ?? 0
        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
        switch request["method"] as? String {
        case "starknet_chainId": reply["result"] = "0x534e5f4d41494e"
        case "starknet_call": reply["result"] = ["0x53444835ec580000"]
        default:
            if write { Self.writes.increment() }
            reply["error"] = ["code": -32601, "message": "The privacy fixture never broadcasts"]
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: reply), as: UTF8.self)
    }
}
#endif
