import BrambleCore
import Foundation

/// Moves JSON-RPC bytes for the Rust core, which builds every request and judges every response
/// (`rpc.rs`). An endpoint is used only after it proves it serves the expected chain; failures
/// fall through to the next bundled endpoint, as the extension's read path does.
struct RpcClient {
    enum Failure: Error { case unreachable }

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.urlCache = nil
        config.httpCookieStorage = nil
        return URLSession(configuration: config)
    }()

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

    func post(_ body: String, to url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure.unreachable }
        return String(decoding: data, as: UTF8.self)
    }
}
