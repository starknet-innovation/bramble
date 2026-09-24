import BrambleCore
import Foundation

/// Moves a batch of core-built JSON-RPC bodies and hands back the raw response bodies. The core
/// judges every response (`recovery_scan.rs`); a transport only moves bytes.
protocol RpcTransport: Sendable {
    func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse]
}

/// The live transport: the first bundled endpoint that proves the chain, then every body POSTed
/// with at most four in flight. A failure mid-batch moves on to the next endpoint.
struct LiveRpcTransport: RpcTransport {
    private static let concurrency = 4
    let client = RpcClient()

    func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse] {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard let chain = try? await client.post(rpcChainIdRequest(id: 0), to: url),
                  (try? rpcVerifyChainId(body: chain, id: 0, network: network.network)) == true,
                  let responses = try? await post(requests, to: url) else { continue }
            return responses
        }
        throw RpcClient.Failure.unreachable
    }

    private func post(_ requests: [RpcRequest], to url: URL) async throws -> [RpcResponse] {
        try await withThrowingTaskGroup(of: RpcResponse.self) { group in
            var pending = requests.makeIterator()
            var responses: [RpcResponse] = []
            for _ in 0..<Self.concurrency {
                guard let request = pending.next() else { break }
                group.addTask { RpcResponse(id: request.id, body: try await client.post(request.body, to: url)) }
            }
            while let response = try await group.next() {
                responses.append(response)
                if let request = pending.next() {
                    group.addTask { RpcResponse(id: request.id, body: try await client.post(request.body, to: url)) }
                }
            }
            return responses
        }
    }
}

enum RpcTransports {
    /// The transport screens use. Debug builds launched with `-BrambleUITestStubRpc` answer
    /// locally so UI tests never touch a network.
    static var current: RpcTransport {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-BrambleUITestStubRpc") { return StubRpcTransport() }
        #endif
        return LiveRpcTransport()
    }
}

#if DEBUG
/// A UI-test node: every probed address is undeployed ("Contract not found") and unfunded.
struct StubRpcTransport: RpcTransport {
    func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse] {
        try requests.map { request in
            let body = try JSONSerialization.jsonObject(with: Data(request.body.utf8)) as? [String: Any]
            let reply: [String: Any] = switch body?["method"] as? String {
            case "starknet_getClassHashAt":
                ["jsonrpc": "2.0", "id": request.id, "error": ["code": 20, "message": "Contract not found"]]
            default:
                ["jsonrpc": "2.0", "id": request.id, "result": ["0x0", "0x0"]]
            }
            let data = try JSONSerialization.data(withJSONObject: reply)
            return RpcResponse(id: request.id, body: String(decoding: data, as: UTF8.self))
        }
    }
}
#endif
