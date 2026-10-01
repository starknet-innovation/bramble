@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// The published E2E phrase; every value derived from it is public.
let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
let testPassword = "parity password"
let account1 = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3"

/// The published wallet as after "Find your accounts": OZ 0 and 1 restored on Sepolia, OZ 0
/// projected onto Mainnet, and OZ 0 on Sepolia active.
func unlockedCore() throws -> WalletCore {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
    try core.importWallet(password: testPassword, phrase: publicPhrase, passphrase: nil)
    let restored = try core.restoreRecoveredAccounts(network: .sepolia, selections: [0, 1].map { index in
        RecoverySelection(family: .openZeppelin, accountIndex: index, classHash: nil)
    })
    try core.selectAccount(accountId: restored[0].id)
    _ = try core.ensureNetworkAccount(network: .mainnet)
    try core.selectAccount(accountId: restored[0].id)
    return core
}

/// The OpenZeppelin record at `index` on `network`.
func ozRecord(_ core: WalletCore, _ network: NetworkId, _ index: UInt32 = 0) throws -> AccountRecord {
    try XCTUnwrap(
        try core.accountRecords(network: network).first { $0.family == .openZeppelin && $0.accountIndex == index }
    )
}

/// The transaction fixture, reassembled from its five files; wire exchanges are stored as one
/// JSON string each and decoded here.
func transactionFixture() throws -> [String: Any] {
    var whole: [String: Any] = [:]
    for part in ["wire", "rules", "presentation", "status", "copy"] {
        let url = try XCTUnwrap(
            Bundle(for: TransferBridgeTests.self)
                .url(forResource: "extension-transactions-\(part)", withExtension: "json")
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        whole.merge(object) { _, new in new }
    }
    whole["scenarios"] = (whole["scenarios"] as? [[String: Any]] ?? []).map { scenario in
        var decoded = scenario
        for phase in ["reviewInvoke", "reviewDeployment", "submit"] {
            decoded[phase] = (scenario[phase] as? [String] ?? []).compactMap { line in
                try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
            }
        }
        return decoded
    }
    return whole
}

func sepolia() throws -> NetworkInfo { try XCTUnwrap(supportedNetworks().first { $0.network == .sepolia }) }

/// Reads `key` from a decoded fixture object as `T`. A missing or mistyped value fails the calling
/// test (the error propagates) instead of trapping the whole run.
func fixtureValue<T>(_ object: [String: Any], _ key: String) throws -> T {
    try XCTUnwrap(object[key] as? T, "fixture value \(key)")
}

/// A canned node for the model tests. Records every post (endpoint, method, write) and answers
/// writes with the hash the core just recorded as pending, so an accepted broadcast can be
/// simulated without the host ever seeing a hash before the core has persisted it.
final class MockNode: RpcTransport, @unchecked Sendable {
    struct Post { let url: URL; let method: String; let write: Bool }

    /// JSON-RPC error codes the canned node answers with (Starknet's contract-not-found and
    /// transaction-execution errors).
    private static let contractNotFoundCode = 20
    private static let executionErrorCode = 41

    private let lock = NSLock()
    private var _posts: [Post] = []
    var deployed = true
    var failEstimate = false
    var failWrites = false
    var unreachable: Set<URL> = []
    var wrongChain: Set<URL> = []
    var pendingHash: () -> String? = { nil }
    /// Runs before a write is answered, e.g. to background the app while the write is in flight.
    var onWrite: (@Sendable () async -> Void)?

    var posts: [Post] { lock.withLock { _posts } }

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? UInt64 ?? 0
        let method = request["method"] as? String ?? ""
        lock.withLock { _posts.append(Post(url: url, method: method, write: write)) }
        if unreachable.contains(url) { throw RpcTransportFailure.unreachable }
        if write, failWrites { throw RpcTransportFailure.unreachable }
        if write, let onWrite { await onWrite() }
        let notFound: [String: Any] = ["error": ["code": Self.contractNotFoundCode, "message": "Contract not found"]]
        let answer: [String: Any]
        switch method {
        case "starknet_chainId":
            answer = ["result": wrongChain.contains(url) ? "0x534e5f4d41494e" : "0x534e5f5345504f4c4941"]

        case "starknet_getClassHashAt":
            answer = deployed ? ["result": Self.classHash] : notFound

        case "starknet_getNonce":
            answer = deployed ? ["result": "0x5"] : notFound

        case "starknet_estimateFee" where failEstimate:
            answer = ["error": ["code": Self.executionErrorCode, "message": "Transaction execution error"]]

        case "starknet_estimateFee":
            let txs = (request["params"] as? [String: Any])?["request"] as? [[String: Any]] ?? []
            answer = ["result": txs.map { _ in Self.estimate }]

        case "starknet_addInvokeTransaction", "starknet_addDeployAccountTransaction":
            answer = ["result": ["transaction_hash": pendingHash() ?? "0x1"]]

        case "starknet_getTransactionStatus":
            answer = ["result": ["finality_status": "ACCEPTED_ON_L2", "execution_status": "SUCCEEDED"]]

        default:
            answer = ["result": ["type": "DEPLOY_ACCOUNT"]]
        }
        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
        reply.merge(answer) { _, new in new }
        return try XCTUnwrap(String(bytes: JSONSerialization.data(withJSONObject: reply), encoding: .utf8))
    }

    static let classHash = "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"

    static let estimate: [String: String] = [
        "l1_data_gas_consumed": "0x180", "l1_data_gas_price": "0x5a0", "l1_gas_consumed": "0x0",
        "l1_gas_price": "0x2d5c6b1e1ef", "l2_gas_consumed": "0x1234a0", "l2_gas_price": "0xb2d05e00",
        "overall_fee": "0x1", "unit": "FRI"
    ]
}
