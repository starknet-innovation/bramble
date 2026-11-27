@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// An offline Mainnet node and Starkscan for one case of `extension-staking.jsonl`. The fixture was
/// recorded against a stand-in staking contract (`0x5a1`) and account; this node answers the app's
/// requests with the recorded replies, swapping those two for the policy's real staking contract
/// and the test wallet's account, so the core under test verifies exactly what the extension did.
/// Every JSON-RPC call is matched on method, contract, selector and calldata; anything the case
/// did not record fails as a transport error, so nothing is ever answered by guesswork.
final class StakingFixtureNode: PortfolioTransport, @unchecked Sendable {
    /// `STAKING_POLICY`'s Mainnet staking contract and the fixture's stand-ins for it and the account.
    private static let contract = "0x00ca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7"
    private static let fixtureContract = "0x5a1"
    private static let fixtureAccount = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde"
    private static let mainnetChainId = "0x534e5f4d41494e"
    private static let statusOK: UInt16 = 200
    /// A Starkscan page is matched on the last two path segments (network and resource).
    private static let pathTail = 2
    private static let hexPrefix = "0x"
    private static let unavailable: UInt16 = 503

    let staker: String
    let tokenId: String
    /// The review sentence the extension prepared, for an action case.
    let review: String?
    private let rpc: [[String: Any]]
    private let starkscan: [[String: Any]]
    private let account: String
    private let lock = NSLock()
    private var count = 0

    var requests: Int { lock.withLock { count } }

    init(case name: String, block: String, account: String) throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-staking", withExtension: "jsonl"))
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        let found = lines.lazy
            .compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            .first { $0["block"] as? String == block && $0["name"] as? String == name }
        let entry = try XCTUnwrap(found, "fixture \(block) \(name)")
        staker = entry["staker"] as? String ?? ""
        tokenId = entry["tokenId"] as? String ?? ""
        review = (entry["prepared"] as? [String: Any])?["review"] as? String
        rpc = entry["rpc"] as? [[String: Any]] ?? []
        starkscan = entry["starkscan"] as? [[String: Any]] ?? []
        self.account = account
    }

    func perform(_ request: HttpRequest) -> HttpOutcome {
        lock.withLock { count += 1 }
        guard request.method == .post else { return explorer(request) }
        guard let body = request.body,
              let call = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let method = call["method"] as? String else { return Self.failed }
        let result: Any
        if method == "starknet_chainId" {
            result = ["result": Self.mainnetChainId]
        } else {
            let wanted = key(method, toFixture(call["params"] ?? NSNull()))
            let match = rpc.first { key($0["method"] as? String ?? "", $0["params"] ?? NSNull()) == wanted }
            guard let reply = match?["reply"] else { return Self.failed }
            result = fromFixture(reply)
        }
        var answer: [String: Any] = ["jsonrpc": "2.0", "id": call["id"] ?? 0]
        answer.merge(result as? [String: Any] ?? [:]) { _, new in new }
        let data = try? JSONSerialization.data(withJSONObject: answer)
        return HttpOutcome(status: Self.statusOK, retryAfter: nil, body: data, timedOut: false)
    }

    /// Starkscan: the case's recorded pages in order, whatever the base URL.
    private func explorer(_ request: HttpRequest) -> HttpOutcome {
        let page = starkscan.first { exchange in
            let recorded = (exchange["request"] as? [String: Any])?["url"] as? String ?? ""
            return recorded.split(separator: "/").suffix(Self.pathTail)
                == request.url.split(separator: "/").suffix(Self.pathTail)
        }
        guard let reply = page?["reply"] as? [String: Any], let body = reply["body"] as? String else {
            return Self.failed
        }
        let status = UInt16(reply["status"] as? String ?? "") ?? Self.statusOK
        return HttpOutcome(status: status, retryAfter: nil, body: Data(body.utf8), timedOut: false)
    }

    private static let failed = HttpOutcome(status: unavailable, retryAfter: nil, body: nil, timedOut: false)

    private func key(_ method: String, _ params: Any) -> String {
        // No parameters reads the same whether sent as `[]` or recorded as `null`.
        let present = (params as? [Any])?.isEmpty == true ? NSNull() : params
        let canonical = map(present) { Self.felt($0) ?? $0 }
        let data = (try? JSONSerialization.data(withJSONObject: ["m": method, "p": canonical], options: .sortedKeys))
        return data.map { String(decoding: $0, as: UTF8.self) } ?? method
    }

    private func toFixture(_ value: Any) -> Any {
        map(value) { text in
            switch Self.felt(text) {
            case Self.felt(Self.contract):
                Self.fixtureContract

            case Self.felt(account):
                Self.fixtureAccount

            default:
                text
            }
        }
    }

    private func fromFixture(_ value: Any) -> Any {
        map(value) { text in
            switch Self.felt(text) {
            case Self.felt(Self.fixtureContract):
                Self.contract

            case Self.felt(Self.fixtureAccount):
                account

            default:
                text
            }
        }
    }

    private func map(_ value: Any, _ string: (String) -> String) -> Any {
        switch value {
        case let text as String:
            string(text)

        case let list as [Any]:
            list.map { map($0, string) }

        case let object as [String: Any]:
            object.mapValues { map($0, string) }

        default:
            value
        }
    }

    /// `0x…` hex as lowercase without leading zeros; nil for anything else.
    private static func felt(_ text: String) -> String? {
        guard text.hasPrefix(hexPrefix) else { return nil }
        let hex = text.dropFirst(hexPrefix.count)
        guard !hex.isEmpty, hex.allSatisfy(\.isHexDigit) else { return nil }
        let digits = hex.lowercased().drop { $0 == "0" }
        return hexPrefix + (digits.isEmpty ? "0" : digits)
    }
}
