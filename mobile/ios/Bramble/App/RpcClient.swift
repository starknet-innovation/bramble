import BrambleCore
import Foundation

/// Moves JSON-RPC bytes for the Rust core, which builds every request and judges every response
/// (`rpc.rs`). An endpoint is used only after it proves it serves the expected chain; failures
/// fall through to the next bundled endpoint, as the extension's read path does.
struct RpcClient {
    enum Failure: Error { case unreachable }

    /// Moves the bytes: URLSession, or the DEBUG fixture node under `-BrambleRpcFixture`.
    let transport: RpcTransport = RpcTransports.launch

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

    private func post(_ body: String, to url: URL) async throws -> String {
        try await transport.post(body, to: url, write: false)
    }
}
