import BrambleCore
@testable import Bramble
import XCTest

/// A URL protocol whose behaviour each test scripts, so the bounded transport can be shown to
/// refuse what `fetchBoundedJson` refuses without a real server.
final class ScriptedProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((ScriptedProtocol) -> Void)?
    nonisolated(unsafe) static var seen: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.seen.append(request)
        Self.handler?(self)
    }
    override func stopLoading() {}

    func respond(status: Int, headers: [String: String] = [:], body: Data? = nil, finish: Bool = true) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if let body { client?.urlProtocol(self, didLoad: body) }
        if finish { client?.urlProtocolDidFinishLoading(self) }
    }
}

final class BoundedHttpTests: XCTestCase {
    private func request(_ path: String, limit: UInt64 = 64, deadlineMs: UInt64 = 2_000) -> HttpRequest {
        HttpRequest(method: .get, url: "https://stub.test\(path)", headers: [], body: nil, maxBodyBytes: limit, deadlineMs: deadlineMs)
    }

    override func setUp() {
        ScriptedProtocol.seen = []
        ScriptedProtocol.handler = nil
    }

    func testAnswersWithinBounds() async {
        ScriptedProtocol.handler = { $0.respond(status: 200, body: Data("{\"ok\":1}".utf8)) }
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(request("/ok"))
        XCTAssertEqual(outcome.status, 200)
        XCTAssertEqual(outcome.body, Data("{\"ok\":1}".utf8))
        let sent = ScriptedProtocol.seen.first
        XCTAssertNil(sent?.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(sent?.value(forHTTPHeaderField: "Referer"))
    }

    func testDeclaredOversizedBodyIsRefusedBeforeReading() async {
        ScriptedProtocol.handler = { $0.respond(status: 200, headers: ["Content-Length": "100000"], body: Data("{}".utf8)) }
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(request("/declared"))
        XCTAssertNil(outcome.body, "a declared length over budget is never read")
    }

    func testStreamedOversizedBodyIsCutOff() async {
        ScriptedProtocol.handler = { $0.respond(status: 200, body: Data(repeating: 0x20, count: 1_000)) }
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(request("/stream", limit: 64))
        XCTAssertNil(outcome.body, "a truncated body is never passed on")
        XCTAssertEqual(outcome.status, 200)
    }

    func testDeadlineCoversTheWholeExchange() async {
        ScriptedProtocol.handler = { $0.respond(status: 200, body: Data("{".utf8), finish: false) }
        let started = Date()
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(request("/stall", deadlineMs: 300))
        XCTAssertTrue(outcome.timedOut)
        XCTAssertNil(outcome.body)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testRedirectsAreRefused() async {
        ScriptedProtocol.handler = { proto in
            guard proto.request.url?.path == "/start" else { return proto.respond(status: 200, body: Data("{}".utf8)) }
            let next = URLRequest(url: URL(string: "https://elsewhere.test/landing")!)
            let redirect = HTTPURLResponse(url: proto.request.url!, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": "https://elsewhere.test/landing"])!
            proto.client?.urlProtocol(proto, wasRedirectedTo: next, redirectResponse: redirect)
            proto.respond(status: 302, body: Data())
        }
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(request("/start"))
        XCTAssertFalse(ScriptedProtocol.seen.contains { $0.url?.host == "elsewhere.test" }, "the hop is never followed")
        XCTAssertNotEqual(outcome.status, 200)
    }

    func testOnlyHttpsIsAttempted() async {
        let insecure = HttpRequest(method: .get, url: "http://stub.test/", headers: [], body: nil, maxBodyBytes: 10, deadlineMs: 1_000)
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self]).perform(insecure)
        XCTAssertNil(outcome.body)
        XCTAssertTrue(ScriptedProtocol.seen.isEmpty)
    }
}
