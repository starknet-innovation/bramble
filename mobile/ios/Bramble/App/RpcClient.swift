import BrambleCore
import Foundation

/// Moves JSON-RPC bytes for the Rust core, which builds every request and judges every response
/// (`rpc.rs`, `recovery_scan.rs`). An endpoint is used only after it proves it serves the expected chain; failures
/// fall through to the next bundled endpoint, as the extension's read path does.
struct RpcClient {
    enum Failure: Error { case unreachable }

    /// Moves the bytes: URLSession, or the DEBUG offline fixtures under `-uiTestOfflineFixtures`.
    let transport: RpcTransport

    init(transport: RpcTransport = RpcTransports.launch) {
        self.transport = transport
    }

    /// Base-unit balances keyed by token symbol.
    func balances(of account: String, on network: NetworkInfo) async throws -> [String: String] {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard let balances = try? await balances(of: account, on: network, at: url) else { continue }
            return balances
        }
        throw Failure.unreachable
    }

    private func balances(of account: String, on network: NetworkInfo, at url: URL) async throws -> [String: String] {
        let chainBody = try await post(rpcChainIdRequest(id: 1), to: url)
        guard try rpcVerifyChainId(body: chainBody, id: 1, network: network.network) else {
            throw Failure.unreachable
        }
        var result: [String: String] = [:]
        for (offset, token) in network.tokens.enumerated() {
            let id = UInt64(offset + 2)
            let body = try await post(try rpcBalanceRequest(id: id, token: token.address, account: account), to: url)
            result[token.symbol] = try rpcParseBalance(body: body, id: id)
        }
        return result
    }

    /// The core's judgement of whether `account` is deployed, from the first endpoint that
    /// proves the chain; `.unknown` when none answers (the home notice then shows nothing).
    func deploymentState(of account: String, on network: NetworkInfo) async -> DeploymentState {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard let chain = try? await post(rpcChainIdRequest(id: 1), to: url),
                  (try? rpcVerifyChainId(body: chain, id: 1, network: network.network)) == true,
                  let request = deploymentStatusRequest(id: 2, address: account),
                  let body = try? await post(request, to: url) else { continue }
            return judgeDeploymentStatus(body: body, id: 2)
        }
        return .unknown
    }

    /// Moves a batch of core-built read bodies (the discovery scan, `recovery_scan.rs`) to the
    /// first endpoint that proves the chain, at most four in flight; a failure mid-batch moves on
    /// to the next endpoint. The core judges every reply, including a missing or duplicate id.
    func send(_ requests: [RpcRequest], on network: NetworkInfo) async throws -> [RpcResponse] {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard let chain = try? await post(rpcChainIdRequest(id: 0), to: url),
                  (try? rpcVerifyChainId(body: chain, id: 0, network: network.network)) == true,
                  let responses = try? await post(requests, to: url) else { continue }
            return responses
        }
        throw Failure.unreachable
    }

    private static let concurrency = 4

    private func post(_ requests: [RpcRequest], to url: URL) async throws -> [RpcResponse] {
        try await withThrowingTaskGroup(of: RpcResponse.self) { group in
            var pending = requests.makeIterator()
            var responses: [RpcResponse] = []
            for _ in 0..<Self.concurrency {
                guard let request = pending.next() else { break }
                group.addTask { RpcResponse(id: request.id, body: try await post(request.body, to: url)) }
            }
            while let response = try await group.next() {
                responses.append(response)
                if let request = pending.next() {
                    group.addTask { RpcResponse(id: request.id, body: try await post(request.body, to: url)) }
                }
            }
            return responses
        }
    }

    private func post(_ body: String, to url: URL) async throws -> String {
        try await transport.post(body, to: url, write: false)
    }
}
