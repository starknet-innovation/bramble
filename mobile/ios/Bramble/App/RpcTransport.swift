import BrambleCore
import Foundation

/// Moves one JSON-RPC body to one endpoint and returns the reply text. The Rust core builds every
/// body and judges every reply (`rpc.rs`, `send/`, `multisig_rpc.rs`); a transport only moves
/// bytes. A write is posted once, is never retried by a transport, and never follows a redirect.
protocol RpcTransport: Sendable {
    func post(_ body: String, to url: URL, write: Bool) async throws -> String
    /// Posts a read whose reply the core bounds at `maxBytes` (`RpcRequest.maxResponseBytes`), for
    /// the core's sans-IO reads that allow more or less than the default (a class definition).
    func post(_ body: String, to url: URL, write: Bool, maxBytes: UInt64) async throws -> String
}

extension RpcTransport {
    /// In-memory transports (fixtures, stubs, test doubles) hold their replies already, so the
    /// bound only matters for a transport that reads from the network.
    func post(_ body: String, to url: URL, write: Bool, maxBytes: UInt64) async throws -> String {
        try await post(body, to: url, write: write)
    }
}

enum RpcTransportFailure: Error { case unreachable, tooLarge }

/// The production transport, over the app's one bounded HTTP path (`BoundedHttp`: ephemeral
/// session, no cookies or cache, every redirect refused, the whole exchange under one deadline,
/// and the body cut off past its budget). Only a complete HTTP 200 reply is returned; anything else
/// is a transport failure the core judges (a write is posted once and never retried here).
struct URLSessionRpcTransport: RpcTransport {
    var http: any PortfolioTransport = BoundedHttp.shared

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        try await post(body, to: url, write: write, maxBytes: UInt64(maxRpcResponseBytes()))
    }

    func post(_ body: String, to url: URL, write: Bool, maxBytes: UInt64) async throws -> String {
        let outcome = await http.perform(HttpRequest(
            method: .post,
            url: url.absoluteString,
            headers: [HttpHeader(name: "Content-Type", value: "application/json")],
            body: body,
            maxBodyBytes: maxBytes,
            deadlineMs: rpcLimits().deadlineMs
        ))
        guard outcome.status == 200 else { throw RpcTransportFailure.unreachable }
        guard let data = outcome.body else { throw RpcTransportFailure.tooLarge }
        return String(decoding: data, as: UTF8.self)
    }
}

enum RpcTransports {
    /// The one transport of this launch, shared by balances, deployment state and every send
    /// plan: the offline fixture node when a DEBUG build is started with
    /// `-uiTestOfflineFixtures <state>` (UI tests; never touches a network), else URLSession.
    static let launch: RpcTransport = {
        #if DEBUG
        if let fixtures = FixtureTransport.requested() { return fixtures }
        #endif
        return URLSessionRpcTransport()
    }()
}
