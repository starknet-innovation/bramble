@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// `extension-privacy-<part>.json`, with row strings decoded (they are stored one compact JSON
/// string per line to keep each file within the repository's line limit).
func privacyFixture(_ part: String, rows: [String]) throws -> [String: Any] {
    let url = try XCTUnwrap(
        Bundle(for: PrivacyBridgeTests.self).url(forResource: "extension-privacy-\(part)", withExtension: "json")
    )
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    for key in rows {
        object[key] = (object[key] as? [String] ?? []).compactMap { line in
            try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        }
    }
    return object
}

func mainnet() throws -> NetworkInfo { try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet }) }

/// The Mainnet record `unlockedCore()` ensured: the account the privacy fixture's reads belong to.
func mainnetAccountId(_ core: WalletCore) throws -> String {
    try XCTUnwrap(try core.ensureNetworkAccount(network: .mainnet)).id
}

/// Replays one fixture case: discovery POSTs from its script, the chain id and pool fee over RPC.
/// Records the bodies it was handed, as opaque bytes, for the byte-parity check.
final class ScriptedPrivacyService: PrivacyTransport, RpcTransport, @unchecked Sendable {
    /// The status a POST gets once its script has run out: outside every real HTTP status class.
    private static let exhaustedStatus = 599

    private let lock = NSLock()
    private var preflight: [(Int, Data)]
    private var pages: [(Int, Data)]
    private var fees: [String]
    private var _bodies: [(URL, Data)] = []

    init(script: [String: Any]) {
        func replies(_ key: String) -> [(Int, Data)] {
            (script[key] as? [[String: Any]] ?? []).map { reply in
                (reply["status"] as? Int ?? 0, Data((reply["body"] as? String ?? "").utf8))
            }
        }
        preflight = replies("preflight")
        pages = replies("pages")
        fees = (script["fee"] as? [[String: Any]] ?? []).map { $0["body"] as? String ?? "" }
    }

    var bodies: [(URL, Data)] { lock.withLock { _bodies } }

    func post(_ body: Data, to url: URL) -> (status: Int, body: Data) {
        lock.withLock {
            // A deep copy: the driver wipes the storage it handed over once the exchange ends.
            _bodies.append((url, Data(Array(body))))
            if url.path.hasSuffix("/preflight_check") {
                return preflight.isEmpty ? (Self.exhaustedStatus, Data()) : preflight.removeFirst()
            }
            return pages.isEmpty ? (Self.exhaustedStatus, Data()) : pages.removeFirst()
        }
    }

    func post(_ body: String, to _: URL, write _: Bool) throws -> String {
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? UInt64 ?? 0
        if request["method"] as? String == "starknet_chainId" {
            return #"{"jsonrpc":"2.0","id":\#(id),"result":"0x534e5f4d41494e"}"#
        }
        let fee = lock.withLock { fees.isEmpty ? "" : fees.removeFirst() }
        return fee.replacingOccurrences(of: "\"id\":0", with: "\"id\":\(id)")
    }
}
