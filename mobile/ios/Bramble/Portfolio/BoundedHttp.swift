import BrambleCore
import Foundation

/// The app's one bounded HTTP path. Moves the bytes of one exchange the Rust core described
/// (`HttpRequest`) and reports exactly what came back (`HttpOutcome`): portfolio reads, prices,
/// Starkscan, and — through `URLSessionRpcTransport` — every JSON-RPC post. The core judges every
/// response; this type only enforces the transport bounds the extension's `fetchBoundedJson`
/// enforces:
///
/// - **Size.** A declared `Content-Length` over `maxBodyBytes` (or one that is not all digits) is
///   refused before a byte is read, and the streamed body is cut off the moment it passes the
///   budget. A truncated body is never passed on: the outcome has no body at all.
/// - **Time.** One deadline covers connecting, headers and the whole body.
/// - **Hardening.** Ephemeral session, no cookies, no cache, no `Referer`, and redirects refused,
///   so the response always comes from the host the core chose. ATS keeps every hop on HTTPS.
/// - **Analytics.** `GatewayAnalytics` adds its headers to a gateway request while it is on; a
///   caller's own `X-MC-*` header is dropped.
protocol PortfolioTransport: Sendable {
    func perform(_ request: HttpRequest) async -> HttpOutcome
}

final class BoundedHttp: NSObject, PortfolioTransport, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = BoundedHttp()

    private let protocolClasses: [AnyClass]
    private let analytics: GatewayAnalytics

    /// A non-empty `protocolClasses` replaces the session's URL protocols (tests only); the app
    /// passes none, and an empty list keeps the system protocols.
    init(protocolClasses: [AnyClass] = [], analytics: GatewayAnalytics = .shared) {
        self.protocolClasses = protocolClasses
        self.analytics = analytics
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        #if DEBUG
        PortfolioNetworkStub.install(on: config)
        #endif
        if !protocolClasses.isEmpty { config.protocolClasses = protocolClasses }
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Refuses every redirect: the core never follows a hop it did not choose.
    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest _: URLRequest,
        completionHandler: @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    func perform(_ request: HttpRequest) async -> HttpOutcome {
        guard let url = URL(string: request.url), url.scheme == "https" else { return .unanswered }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method == .post ? "POST" : "GET"
        for header in request.headers where !GatewayAnalytics.isAnalyticsHeader(header.name) {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.name)
        }
        if let body = request.body {
            urlRequest.httpBody = Data(body.utf8)
        }
        return await exchange(urlRequest, limit: request.maxBodyBytes, deadline: request.deadlineMs)
    }

    /// A JSON POST of a caller-owned buffer (the privacy service's body, which the caller wipes
    /// afterwards), under the same bounds as `perform`.
    func post(_ body: Data, to url: URL, maxBodyBytes: UInt64, deadlineMs: UInt64) async -> HttpOutcome {
        guard url.scheme == "https" else { return .unanswered }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = body
        return await exchange(urlRequest, limit: maxBodyBytes, deadline: deadlineMs)
    }

    private func exchange(_ request: URLRequest, limit: UInt64, deadline: UInt64) async -> HttpOutcome {
        var urlRequest = request
        if let url = urlRequest.url {
            for (name, value) in analytics.headers(for: url) {
                urlRequest.setValue(value, forHTTPHeaderField: name)
            }
        }
        return await withTaskGroup(of: HttpOutcome?.self) { group in
            group.addTask { await self.read(urlRequest, limit: limit) }
            group.addTask {
                try? await Task.sleep(for: .milliseconds(Int(deadline)))
                return nil
            }
            let first = await group.next().flatMap(\.self)
            group.cancelAll()
            return first ?? HttpOutcome(status: 0, retryAfter: nil, body: nil, timedOut: true)
        }
    }

    private func read(_ request: URLRequest, limit: UInt64) async -> HttpOutcome {
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { return .unanswered }
            let status = UInt16(clamping: http.statusCode)
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After")
            let refused = HttpOutcome(status: status, retryAfter: retryAfter, body: nil, timedOut: false)
            if let declared = http.value(forHTTPHeaderField: "Content-Length"),
               !declared.allSatisfy(\.isASCIIDigit) || (UInt64(declared) ?? .max) > limit {
                bytes.task.cancel()
                return refused
            }
            var body = Data()
            for try await byte in bytes {
                body.append(byte)
                if UInt64(body.count) > limit {
                    bytes.task.cancel()
                    return refused
                }
            }
            return HttpOutcome(status: status, retryAfter: retryAfter, body: body, timedOut: false)
        } catch {
            return .unanswered
        }
    }
}

extension HttpOutcome {
    /// Nothing usable arrived: a transport failure or a refused redirect.
    static var unanswered: HttpOutcome { HttpOutcome(status: 0, retryAfter: nil, body: nil, timedOut: false) }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
