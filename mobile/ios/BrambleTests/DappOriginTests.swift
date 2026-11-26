@testable import Bramble
import XCTest

/// The in-app browser's admission rules (P16): only the main frame's committed `https` origin is
/// answered, and a request is read only in the shape the page's bridge sends.
final class DappOriginTests: XCTestCase {
    private let page = URL(string: "https://app.example.com/swap?x=1")
    private let id = "0f8fad5b-d9cb-469f-a165-70867728950e"

    func testAddressBarOpensHttpsOnly() {
        XCTAssertEqual(DappOrigin.address("app.example.com")?.absoluteString, "https://app.example.com")
        XCTAssertEqual(DappOrigin.address("  https://app.example.com/a ")?.absoluteString, "https://app.example.com/a")
        for refused in [
            "", "http://app.example.com", "javascript:alert(1)", "file:///etc/hosts",
            "data:text/html,hi", "ftp://app.example.com", "https://user:pw@app.example.com", "app example.com"
        ] {
            XCTAssertNil(DappOrigin.address(refused), refused)
        }
    }

    func testOriginIsSchemeHostAndNonDefaultPort() {
        XCTAssertEqual(DappOrigin.origin(of: page), "https://app.example.com")
        XCTAssertEqual(DappOrigin.origin(of: URL(string: "https://APP.example.com:443/")), "https://app.example.com")
        XCTAssertEqual(DappOrigin.origin(of: URL(string: "https://app.example.com:8443/")), "https://app.example.com:8443")
        XCTAssertEqual(DappOrigin.origin(scheme: "https", host: "app.example.com", port: 0), "https://app.example.com")
        XCTAssertNil(DappOrigin.origin(of: URL(string: "http://app.example.com")))
        XCTAssertNil(DappOrigin.origin(scheme: "https", host: "", port: 0))
    }

    func testAdmitsOnlyTheMainFrameAtTheCommittedOrigin() {
        let origin = "https://app.example.com"
        XCTAssertEqual(DappOrigin.admit(isMainFrame: true, frameOrigin: origin, committed: page), origin)
        // A subframe, even one at the page's own origin, is refused.
        XCTAssertNil(DappOrigin.admit(isMainFrame: false, frameOrigin: origin, committed: page))
        // A frame whose origin is not the committed page's (a navigation raced the message).
        XCTAssertNil(DappOrigin.admit(isMainFrame: true, frameOrigin: "https://evil.example", committed: page))
        // Unattributable: no https origin for the frame, or nothing committed yet.
        XCTAssertNil(DappOrigin.admit(isMainFrame: true, frameOrigin: nil, committed: page))
        XCTAssertNil(DappOrigin.admit(isMainFrame: true, frameOrigin: origin, committed: nil))
        XCTAssertNil(DappOrigin.admit(
            isMainFrame: true,
            frameOrigin: DappOrigin.origin(scheme: "http", host: "app.example.com", port: 0),
            committed: URL(string: "http://app.example.com")
        ))
    }

    func testReadsOnlyAWellFormedRequest() {
        let origin = "https://app.example.com"
        let body = #"{"id":"\#(id)","method":"wallet_requestAccounts","params":null}"#
        XCTAssertEqual(
            DappRequest.read(origin: origin, body: body),
            DappRequest(origin: origin, id: id, method: "wallet_requestAccounts", params: nil)
        )
        let withParams = #"{"id":"\#(id)","method":"wallet_requestAccounts","params":"{\"silent_mode\":true}"}"#
        XCTAssertEqual(DappRequest.read(origin: origin, body: withParams)?.params, #"{"silent_mode":true}"#)
        for refused in [
            "not json", "[]", #"{"method":"wallet_requestAccounts"}"#,
            #"{"id":"1","method":"wallet_requestAccounts"}"#, #"{"id":"\#(id)","method":7}"#,
            #"{"id":"\#(id)","method":""}"#,
            #"{"id":"\#(id)","method":"wallet_requestAccounts","params":{"silent_mode":true}}"#
        ] {
            XCTAssertNil(DappRequest.read(origin: origin, body: refused), refused)
        }
        let padding = String(repeating: " ", count: DappRequest.maxBodyBytes)
        XCTAssertNil(DappRequest.read(origin: origin, body: body + padding))
    }

    @MainActor
    func testTheProviderScriptIsBundled() throws {
        let script = try XCTUnwrap(BrowserView.providerScript)
        XCTAssertTrue(script.contains("starknet_bramble"))
        XCTAssertTrue(script.contains("window.top === window"))
    }
}
