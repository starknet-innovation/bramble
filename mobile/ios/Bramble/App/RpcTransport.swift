import BrambleCore
import Foundation

/// Moves one JSON-RPC body to one endpoint and returns the reply text. The Rust core builds every
/// body and judges every reply (`rpc.rs`, `send/`); a transport only moves bytes. A write is
/// posted once, is never retried by a transport, and never follows a redirect.
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

/// The production transport: an ephemeral URLSession (no cache, no cookies), HTTPS only by ATS.
struct URLSessionRpcTransport: RpcTransport {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.urlCache = nil
        config.httpCookieStorage = nil
        return URLSession(configuration: config)
    }()

    func post(_ body: String, to url: URL, write: Bool) async throws -> String {
        try await post(body, to: url, write: write, maxBytes: UInt64(maxRpcResponseBytes()))
    }

    func post(_ body: String, to url: URL, write: Bool, maxBytes: UInt64) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        // A redirected write would send a signed transaction to an endpoint that never proved
        // its chain, so a write refuses every redirect; the core reports the missing reply as
        // indeterminate rather than retrying.
        let (bytes, response) = write
            ? try await session.bytes(for: request, delegate: RefuseRedirects.shared)
            : try await session.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw RpcTransportFailure.unreachable }
        return try await Self.bounded(bytes, expected: response.expectedContentLength, limit: Int(clamping: maxBytes))
    }

    /// Reads a reply up to the core's limit for this request and refuses anything longer, so an
    /// untrusted endpoint cannot make the app buffer an unbounded body before the core would
    /// refuse it.
    static func bounded(_ bytes: URLSession.AsyncBytes, expected: Int64, limit: Int) async throws -> String {
        defer { bytes.task.cancel() }
        guard expected <= Int64(limit) else { throw RpcTransportFailure.tooLarge }
        var data = Data()
        data.reserveCapacity(expected > 0 ? Int(expected) : 4096)
        for try await byte in bytes {
            guard data.count < limit else { throw RpcTransportFailure.tooLarge }
            data.append(byte)
        }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Task delegate that declines every HTTP redirect.
final class RefuseRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    static let shared = RefuseRedirects()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
        nil
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
