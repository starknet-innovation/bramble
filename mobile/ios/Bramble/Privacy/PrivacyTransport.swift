import BrambleCore
import Foundation

/// Moves one privacy-service POST. The Rust core builds the body, which carries the viewing key
/// (the one place it crosses FFI; docs/privacy.md §1.1): a transport sends it unread and unlogged, never follows a redirect (a 307/308 would resend the
/// body elsewhere), keeps no cache or cookies, and stops reading at `maxPrivacyResponseBytes()`.
/// It returns every status with its body: the core judges non-2xx replies (retry text, 409).
protocol PrivacyTransport: Sendable {
    func post(_ body: Data, to url: URL) async throws -> (status: Int, body: Data)
}

enum PrivacyTransportFailure: Error { case notHttps, tooLarge, noResponse }

/// The production transport: an ephemeral URLSession, HTTPS only (ATS plus an explicit check).
struct URLSessionPrivacyTransport: PrivacyTransport {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }()

    func post(_ body: Data, to url: URL) async throws -> (status: Int, body: Data) {
        guard url.scheme == "https" else { throw PrivacyTransportFailure.notHttps }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (bytes, response) = try await session.bytes(for: request, delegate: RefuseRedirects.shared)
        guard let http = response as? HTTPURLResponse else { throw PrivacyTransportFailure.noResponse }
        return (http.statusCode, try await Self.bounded(bytes, expected: response.expectedContentLength))
    }

    /// Reads a reply up to the core's parse limit and refuses anything longer.
    static func bounded(_ bytes: URLSession.AsyncBytes, expected: Int64) async throws -> Data {
        let limit = Int(maxPrivacyResponseBytes())
        guard expected <= Int64(limit) else { throw PrivacyTransportFailure.tooLarge }
        var data = Data()
        data.reserveCapacity(expected > 0 ? Int(expected) : 16_384)
        for try await byte in bytes {
            guard data.count < limit else { throw PrivacyTransportFailure.tooLarge }
            data.append(byte)
        }
        return data
    }
}

enum PrivacyTransports {
    /// This launch's transports: the canned privacy service (which also answers the pool-fee
    /// read) when a DEBUG build is started with `-BramblePrivacyFixture <scenario>`, else
    /// URLSession plus the wallet's RPC transport.
    static func launch(rpc: RpcTransport) -> (privacy: PrivacyTransport, rpc: RpcTransport) {
        #if DEBUG
        // Any fixture launch stays off the network: a UI test that only fakes the node (Send's)
        // gets an unreachable privacy service rather than the real one.
        if let scenario = FixturePrivacyTransport.launchScenario
            ?? FixtureRpcTransport.launchScenario.map({ _ in "offline" }) {
            let fixture = FixturePrivacyTransport(scenario: scenario)
            return (fixture, fixture)
        }
        #endif
        return (URLSessionPrivacyTransport(), rpc)
    }
}

/// Relays one `PrivacyReadPlan`. The plan decides every step; the driver only picks the RPC
/// endpoint (the first that proves the chain, then that one only), sleeps for `Wait`, and hands
/// replies back with the host clock. It never reads, logs, or keeps a `Post` body, and it wipes the
/// body's bytes once the exchange ends. That wipe is best effort: URLSession and the TLS stack may
/// hold copies Swift cannot reach, which is why the key crossing FFI needs sign-off (docs §1.1).
actor PrivacyDriver {
    let plan: PrivacyReadPlan
    private let urls: [URL]
    private let network: NetworkId
    private let privacy: PrivacyTransport
    private let rpc: RpcTransport
    private var endpoint: URL?

    init(plan: PrivacyReadPlan, network: NetworkInfo, privacy: PrivacyTransport, rpc: RpcTransport) {
        self.plan = plan
        self.urls = network.rpcUrls.compactMap(URL.init(string:))
        self.network = network.network
        self.privacy = privacy
        self.rpc = rpc
    }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

    /// Runs the plan to `Finished` or `Failed`. Cancelling the task closes the plan.
    func run() async throws -> PrivacyStep {
        var reply = PrivacyReply.start(nowMs: now())
        while true {
            if Task.isCancelled {
                plan.close()
                throw CancellationError()
            }
            let step = try plan.advance(reply: reply)
            switch step {
            case let .post(id, url, body, _):
                reply = await post(id: id, url: url, body: body)
            case let .rpc(id, body, purpose):
                reply = await exchange(id: id, body: body, purpose: purpose)
            case let .wait(delayMs):
                try await Task.sleep(for: .milliseconds(Int(delayMs)))
                reply = .waitElapsed(nowMs: now())
            case .finished, .failed:
                return step
            }
        }
    }

    private func post(id: UInt64, url: String, body: Data) async -> PrivacyReply {
        defer { Self.wipe(body) }
        guard let target = URL(string: url),
              let (status, data) = try? await privacy.post(body, to: target) else {
            return .transportFailure(id: id, nowMs: now())
        }
        return .http(id: id, status: UInt16(clamping: status), body: data, nowMs: now())
    }

    /// Zeroes the storage a `Post` body shares with the step it came from. Writing through the
    /// shared buffer is deliberate: a copy-on-write `resetBytes` would zero a fresh copy and leave
    /// the key in the original.
    static func wipe(_ body: Data) {
        body.withUnsafeBytes { raw in
            guard let base = raw.baseAddress, raw.count > 0 else { return }
            memset_s(UnsafeMutableRawPointer(mutating: base), raw.count, 0, raw.count)
        }
    }

    private func exchange(id: UInt64, body: String, purpose: PrivacyPurpose) async -> PrivacyReply {
        if endpoint == nil, purpose == .chainId {
            for url in urls {
                guard let text = try? await rpc.post(body, to: url, write: false),
                      (try? rpcVerifyChainId(body: text, id: id, network: network)) == true else { continue }
                endpoint = url
                return .rpc(id: id, body: text, nowMs: now())
            }
            return .transportFailure(id: id, nowMs: now())
        }
        guard let endpoint, let text = try? await rpc.post(body, to: endpoint, write: false) else {
            return .transportFailure(id: id, nowMs: now())
        }
        return .rpc(id: id, body: text, nowMs: now())
    }
}
