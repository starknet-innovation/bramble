import Foundation

/// Moves one JSON-RPC body to an endpoint and returns the response body. The Rust core builds
/// every request and judges every response (`rpc.rs`); a transport only moves bytes. Production
/// traffic goes through `RpcClient`'s own ephemeral session; this protocol exists for the
/// Debug-only offline fixtures (`FixtureTransport`).
protocol RpcTransport: Sendable {
    func post(_ body: String, to url: URL) async throws -> String
}
