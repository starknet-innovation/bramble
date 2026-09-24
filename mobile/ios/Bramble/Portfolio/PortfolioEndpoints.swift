import BrambleCore
import Foundation

/// The extension's `withRpcFallback` for the portfolio reads: endpoints in `rpcUrls` order, each
/// proven with `starknet_chainId` before it receives a call (a mismatch counts as that endpoint
/// failing), the next endpoint only after a transport-class failure. The core's judges decide what
/// is transport-class; this type only walks the list and moves bytes.
struct PortfolioEndpoints: Sendable {
    let transport: any PortfolioTransport
    /// `RPC_BODY_LIMIT_BYTES` and `RPC_REQUEST_TIMEOUT_MS`, from the core.
    private let limits = rpcLimits()

    /// Runs `attempt` on each verified endpoint until one returns a value; `nil` from `attempt`
    /// means "transport failure here, try the next". `nil` overall: every endpoint failed.
    func firstAnswer<T: Sendable>(on network: NetworkInfo, _ attempt: @Sendable (URL) async -> T?) async -> T? {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard await verify(url, network: network.network) else { continue }
            if let answer = await attempt(url) {
                return answer
            }
        }
        return nil
    }

    /// POSTs one call and reports what came back; the core classifies it.
    func send(_ call: RpcCall, to url: URL) async -> RpcReply {
        let outcome = await transport.perform(HttpRequest(
            method: .post,
            url: url.absoluteString,
            headers: [HttpHeader(name: "Content-Type", value: "application/json")],
            body: call.body,
            maxBodyBytes: limits.maxBodyBytes,
            deadlineMs: limits.deadlineMs
        ))
        return RpcReply(id: call.id, status: outcome.status, body: outcome.body.map { String(decoding: $0, as: UTF8.self) })
    }

    /// Sends calls at most four at a time (the extension's read concurrency), replies in call order.
    func send(_ calls: [RpcCall], to url: URL) async -> [RpcReply] {
        var replies: [RpcReply] = []
        for start in stride(from: 0, to: calls.count, by: 4) {
            let batch = Array(calls[start..<min(start + 4, calls.count)])
            let answered = await withTaskGroup(of: RpcReply.self) { group in
                for call in batch {
                    group.addTask { await send(call, to: url) }
                }
                var collected: [RpcReply] = []
                for await reply in group {
                    collected.append(reply)
                }
                return collected
            }
            replies += batch.compactMap { call in answered.first { $0.id == call.id } }
        }
        return replies
    }

    private func verify(_ url: URL, network: NetworkId) async -> Bool {
        let reply = await send(RpcCall(id: 0, body: rpcChainIdRequest(id: 0)), to: url)
        guard let body = reply.body else { return false }
        return (try? rpcVerifyChainId(body: body, id: 0, network: network)) == true
    }
}
