import BrambleCore
import Foundation
import XCTest

/// `extension-privacy-<part>.json`, with row strings decoded (they are stored one compact JSON
/// string per line to keep each file within the repository's line limit).
func privacyFixture(_ part: String, rows: [String]) throws -> [String: Any] {
    let url = try XCTUnwrap(Bundle(for: PrivacyBridgeTests.self).url(forResource: "extension-privacy-\(part)", withExtension: "json"))
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    for key in rows {
        object[key] = (object[key] as? [String] ?? []).compactMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
    }
    return object
}

func mainnet() -> NetworkInfo { supportedNetworks().first { $0.network == .mainnet }! }

/// Replays one fixture case: discovery POSTs from its script, the chain id and pool fee over RPC.
/// Records the bodies it was handed, as opaque bytes, for the byte-parity check.
final class ScriptedPrivacyService: PrivacyTransport, RpcTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var preflight: [(Int, Data)]
    private var pages: [(Int, Data)]
    private var fees: [String]
    private var _bodies: [(URL, Data)] = []

    init(script: [String: Any]) {
        func replies(_ key: String) -> [(Int, Data)] {
            (script[key] as? [[String: Any]] ?? []).map { ($0["status"] as? Int ?? 0, Data(($0["body"] as? String ?? "").utf8)) }
        }
        preflight = replies("preflight")
        pages = replies("pages")
        fees = (script["fee"] as? [[String: Any]] ?? []).map { $0["body"] as? String ?? "" }
    }

    var bodies: [(URL, Data)] { lock.withLock { _bodies } }

    func post(_ body: Data, to url: URL) async throws -> (status: Int, body: Data) {
        lock.withLock {
            // A deep copy: the driver wipes the storage it handed over once the exchange ends.
            _bodies.append((url, Data(Array(body))))
            if url.path.hasSuffix("/preflight_check") {
                return preflight.isEmpty ? (599, Data()) : preflight.removeFirst()
            }
            return pages.isEmpty ? (599, Data()) : pages.removeFirst()
        }
    }

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? UInt64 ?? 0
        if request["method"] as? String == "starknet_chainId" {
            return #"{"jsonrpc":"2.0","id":\#(id),"result":"0x534e5f4d41494e"}"#
        }
        let fee = lock.withLock { fees.isEmpty ? "" : fees.removeFirst() }
        return fee.replacingOccurrences(of: "\"id\":0", with: "\"id\":\(id)")
    }
}
