@testable import Bramble
import BrambleCore
import XCTest

/// Connect through wallet-core's `DappSession`, as the browser drives it (P16): a site's
/// `wallet_requestAccounts` is held as a card; approving it answers the page with the active
/// account's address and connects the site, denying it answers 113; any method outside the
/// connect slice is refused without a card.
@MainActor
final class DappRequestSinkTests: XCTestCase {
    private let origin = "https://app.example.com"
    private let id = "0f8fad5b-d9cb-469f-a165-70867728950e"

    private struct NoNetwork: PortfolioTransport {
        func perform(_: HttpRequest) -> HttpOutcome {
            HttpOutcome(status: 0, retryAfter: nil, body: nil, timedOut: false)
        }
    }

    private func wallet() throws -> (WalletCore, AccountRecord) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let core = try WalletCore(dataDir: directory, clock: DeviceClock())
        _ = try core.createWallet(password: "a strong password", wordCount: 12)
        let account = try core.activeAccount() ?? core.addRegularAccount(network: .mainnet)
        return (core, account)
    }

    private func request(_ method: String, id: String? = nil) -> DappRequest {
        DappRequest(origin: origin, id: id ?? self.id, method: method, params: nil)
    }

    private func object(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    private func held(_ answer: DappRequestSink.Answer) throws -> UInt64 {
        guard case let .held(requestId) = answer else { throw XCTSkip("expected a held request, got \(answer)") }
        return requestId
    }

    func testApprovingAConnectAnswersTheActiveAccount() throws {
        let (core, account) = try wallet()
        let sink = DappRequestSink(core: core, http: NoNetwork())
        let requestId = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        let card = try XCTUnwrap(sink.cards.first)
        XCTAssertEqual(card.origin, origin)
        XCTAssertFalse(card.blocked)

        let settled = sink.approve(card, accountId: account.id)
        XCTAssertEqual(settled.map(\.requestId), [requestId])
        let reply = try object(try XCTUnwrap(settled.first).json)
        XCTAssertEqual(reply["id"] as? String, id)
        XCTAssertEqual(reply["result"] as? [String], [account.address])
        XCTAssertTrue(sink.cards.isEmpty)

        // Connected now: the next ask is answered at once, without a card.
        guard case let .now(json) = sink.answer(request("wallet_requestAccounts"), shown: .mainnet) else {
            XCTFail("a connected site is answered without a card")
            return
        }
        XCTAssertEqual(try object(json)["result"] as? [String], [account.address])
    }

    func testDenyingAConnectAnswersUserRefused() throws {
        let (core, _) = try wallet()
        let sink = DappRequestSink(core: core, http: NoNetwork())
        _ = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        let card = try XCTUnwrap(sink.cards.first)
        let reply = try object(try XCTUnwrap(sink.deny(card).first).json)
        XCTAssertEqual((reply["error"] as? [String: Any])?["code"] as? Int, 113)
        XCTAssertNil(reply["result"])
        XCTAssertTrue(sink.cards.isEmpty)
        // Not connected: the site still sees no account.
        guard case let .now(json) = sink.answer(request("mc_accounts"), shown: .mainnet) else {
            XCTFail("a passive read is answered at once")
            return
        }
        XCTAssertEqual((try object(json)["result"] as? [String: Any])?["accounts"] as? [String], [])
    }

    func testALeftPageWithdrawsItsCard() throws {
        let (core, account) = try wallet()
        let sink = DappRequestSink(core: core, http: NoNetwork())
        _ = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        let card = try XCTUnwrap(sink.cards.first)

        sink.pageGone()
        XCTAssertTrue(sink.cards.isEmpty)
        // The core holds no card either, and the stale one can no longer be approved.
        XCTAssertTrue(sink.approve(card, accountId: account.id).isEmpty)
        guard case let .now(json) = sink.answer(request("mc_accounts"), shown: .mainnet) else {
            XCTFail("a passive read is answered at once")
            return
        }
        XCTAssertEqual((try object(json)["result"] as? [String: Any])?["accounts"] as? [String], [])
    }

    func testACancelledSiteWaitsOutTheCooldown() throws {
        let (core, _) = try wallet()
        var clock = 1_000_000.0
        let sink = DappRequestSink(core: core, http: NoNetwork()) { clock }
        _ = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        _ = sink.deny(try XCTUnwrap(sink.cards.first))

        // Asking again at once is refused without a card.
        guard case let .now(json) = sink.answer(request("wallet_requestAccounts"), shown: .mainnet) else {
            XCTFail("a connect inside the cooldown is refused at once")
            return
        }
        XCTAssertEqual((try object(json)["error"] as? [String: Any])?["code"] as? Int, 113)
        XCTAssertTrue(sink.cards.isEmpty)

        // Once it has passed, the site may ask again.
        clock += DappRequestSink.surfaceCooldownMs
        _ = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        XCTAssertEqual(sink.cards.count, 1)
    }

    func testSigningIsRefusedWithoutACard() throws {
        let (core, _) = try wallet()
        let sink = DappRequestSink(core: core, http: NoNetwork())
        for method in ["wallet_addInvokeTransaction", "wallet_signTypedData"] {
            guard case let .now(json) = sink.answer(request(method), shown: .mainnet) else {
                XCTFail("\(method) must not be held")
                return
            }
            XCTAssertNotNil(try object(json)["error"], method)
        }
        XCTAssertTrue(sink.cards.isEmpty)
    }

    /// The core queues a connected site's typed data as a sign card, which this app has no screen
    /// for yet: it is declined at once, never shown as a connect card.
    func testTypedDataIsDeclinedUntilItHasAScreen() throws {
        let (core, account) = try wallet()
        let sink = DappRequestSink(core: core, http: NoNetwork())
        _ = try held(sink.answer(request("wallet_requestAccounts"), shown: .mainnet))
        _ = sink.approve(try XCTUnwrap(sink.cards.first), accountId: account.id)

        let params = #"""
        {"typed_data":{"domain":{"chainId":"SN_MAIN","name":"Bramble Test","revision":"1","version":"1"},
        "message":{"content":"hello"},"primaryType":"Mail","types":{"Mail":[{"name":"content","type":"felt"}],
        "StarknetDomain":[{"name":"name","type":"shortstring"},{"name":"version","type":"shortstring"},
        {"name":"chainId","type":"shortstring"},{"name":"revision","type":"shortstring"}]}}}
        """#
        let sign = DappRequest(origin: origin, id: id, method: "wallet_signTypedData", params: params)
        guard case let .now(json) = sink.answer(sign, shown: .mainnet) else {
            XCTFail("typed data must not be held")
            return
        }
        XCTAssertEqual((try object(json)["error"] as? [String: Any])?["code"] as? Int, 113)
        XCTAssertTrue(sink.cards.isEmpty)
    }

    func testWarningsUseTheExtensionsWords() {
        XCTAssertEqual(DappRequestSink.copy(.blocklisted), DappCopy.siteInsightBlocklisted)
        XCTAssertEqual(
            DappRequestSink.copy(.lookalike(target: "starknet.io")),
            "Domain closely resembles starknet.io; watch for a spoofed lookalike."
        )
        XCTAssertEqual(
            DappRequestSink.copy(.riskyTld(tld: "zip")),
            "The .zip top-level domain is frequently used for scams; be cautious."
        )
    }
}
