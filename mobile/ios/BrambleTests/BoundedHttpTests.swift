@testable import Bramble
import BrambleCore
import XCTest

/// A URL protocol whose behaviour each test scripts, so the bounded transport can be shown to
/// refuse what `fetchBoundedJson` refuses without a real server.
final class ScriptedProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((ScriptedProtocol) -> Void)?
    nonisolated(unsafe) static var seen: [URLRequest] = []

    override static func canInit(with _: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.seen.append(request)
        Self.handler?(self)
    }
    override func stopLoading() {
        // No action: a scripted exchange holds nothing that needs cancelling.
    }

    func respond(status: Int, headers: [String: String] = [:], body: Data? = nil, finish: Bool = true) {
        guard let url = request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: status,
                  httpVersion: "HTTP/1.1",
                  headerFields: headers
              )
        else { preconditionFailure("a scripted request always carries a URL") }
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

    override func tearDown() {
        ScriptedProtocol.handler = nil
        ScriptedProtocol.seen = []
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
        ScriptedProtocol.handler = { proto in
            proto.respond(status: 200, headers: ["Content-Length": "100000"], body: Data("{}".utf8))
        }
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
        let outcome = await BoundedHttp(protocolClasses: [ScriptedProtocol.self])
            .perform(request("/stall", deadlineMs: 300))
        XCTAssertTrue(outcome.timedOut)
        XCTAssertNil(outcome.body)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testRedirectsAreRefused() async {
        ScriptedProtocol.handler = { proto in
            guard proto.request.url?.path == "/start" else { return proto.respond(status: 200, body: Data("{}".utf8)) }
            guard let landing = URL(string: "https://elsewhere.test/landing"),
                  let start = proto.request.url,
                  let redirect = HTTPURLResponse(
                      url: start,
                      statusCode: 302,
                      httpVersion: "HTTP/1.1",
                      headerFields: ["Location": "https://elsewhere.test/landing"]
                  )
            else { preconditionFailure("the redirect fixture is well formed") }
            let next = URLRequest(url: landing)
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
