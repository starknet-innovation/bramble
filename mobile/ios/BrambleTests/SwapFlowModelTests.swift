@testable import Bramble
import BrambleCore
import XCTest

/// The Swap journey (`swap-ui.ts`) over canned AVNU replies and the canned node, with the values
/// of wallet-core's `tests/swap.rs` and `extension-swap.jsonl` (0.01 ETH for 12.5 STRK on Sepolia):
/// the quote, the build judged against the pinned router, the plan to its fee and one write; a
/// hostile build refused before anything is planned; a failed quote shown in the extension's words.
/// No reply ever reaches a real endpoint.
@MainActor
final class SwapFlowModelTests: XCTestCase {
    private var unlocked: WalletCore?
    private let node = MockNode()
    private let avnu = AvnuStub()

    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        let wallet = try unlockedCore()
        unlocked = wallet
        let account = try ozRecord(wallet, .sepolia)
        node.pendingHash = { (try? wallet.activity(accountId: account.id))?.first?.hash }
        avnu.beneficiary = account.address
    }

    override func tearDown() {
        unlocked = nil
    }

    private func model(
        opening: String? = nil,
        balances: [String: String] = [:],
        http: (any PortfolioTransport)? = nil
    ) throws -> SwapFlowModel {
        try SwapFlowModel(
            core: core,
            network: sepolia(),
            account: ozRecord(core, .sepolia),
            preferences: TokenPreferences(persisted: nil),
            balances: balances,
            prices: nil,
            http: http ?? avnu,
            rpc: node,
            openingToken: opening
        )
    }

    private static func tracked(_ symbol: String) -> TrackedToken? {
        TokenPreferences(persisted: nil).tracked(network: .sepolia).first { $0.token.symbol == symbol }
    }

    func testAQuotedSwapIsReviewedInTheCoresWordsAndPostedOnce() async throws {
        let model = try model()
        XCTAssertEqual(model.sell?.symbol, "ETH", "Home opens on ETH → STRK, as the extension")
        XCTAssertEqual(model.buy?.symbol, "STRK")
        model.amount = "0.01"
        await model.requestQuote()
        XCTAssertEqual(model.quote?.buyAmount, "12.5")
        XCTAssertNil(model.note)
        XCTAssertTrue(model.canReview)
        XCTAssertEqual(model.reviewLabel, SwapCopy.review)
        XCTAssertTrue(try XCTUnwrap(avnu.urls.first).hasPrefix("https://sepolia.api.avnu.fi/swap/v3/quotes?"))

        await model.reviewSwap()
        XCTAssertEqual(model.stage, .review)
        XCTAssertEqual(avnu.urls.last, "https://sepolia.api.avnu.fi/swap/v3/build")
        let judged = try XCTUnwrap(model.swapReview)
        XCTAssertEqual(judged.minBuyAmount, "12.4375")
        XCTAssertEqual(judged.summaries.count, 2, "the approval, then the route")
        XCTAssertTrue(judged.summaries[1].hasPrefix("Swap 0.01 ETH for at least 12.4375 STRK, paid to "))
        XCTAssertEqual(model.review?.canConfirm, true)
        XCTAssertFalse(node.posts.contains(where: \.write), "reviewing sends nothing")

        await model.confirm()
        XCTAssertEqual(node.posts.filter(\.write).map(\.method), ["starknet_addInvokeTransaction"])
        XCTAssertEqual(model.stage, .submitted)
        XCTAssertTrue(model.confirmed, "the node answers accepted")
        let row = try XCTUnwrap(core.activity(accountId: ozRecord(core, .sepolia).id).first)
        XCTAssertEqual(model.hash, row.hash)
        XCTAssertEqual(row.summary, "Swap 0.01 ETH for ~12.5 STRK via avnu")
    }

    func testAFeeRetryShowsTheCoresReasonForARefusal() async throws {
        let model = try model()
        model.amount = "0.01"
        await model.requestQuote()
        await model.reviewSwap()
        XCTAssertEqual(model.stage, .review)
        node.wrongChain = Set(try sepolia().rpcUrls.compactMap(URL.init(string:)))
        await model.retryFee()
        XCTAssertEqual(model.stage, .edit)
        let note = try XCTUnwrap(model.note)
        let generic = SendFailureText.message(SwapFlowModel.nodeError)
        XCTAssertNotEqual(note, generic, "the core's reason, not a generic one")
    }

    func testABuildOffThePinnedRouterIsRefusedBeforeAnythingIsPlanned() async throws {
        avnu.spender = "0x6666666666666666666666666666666666666666666666666666666666666"
        let model = try model()
        model.amount = "0.01"
        await model.requestQuote()
        await model.reviewSwap()
        XCTAssertEqual(model.stage, .edit)
        XCTAssertEqual(
            model.note,
            FriendlyError.message("swap build approved an unexpected spender"),
            "the core's sentence, through the extension's copy"
        )
        XCTAssertNil(model.quote, "a refusal ends the quote")
        XCTAssertFalse(model.canReview)
        XCTAssertTrue(node.posts.isEmpty, "nothing reached the node")
    }

    func testAnUnansweredQuoteFailsClosedInTheCoresWords() async throws {
        avnu.offline = true
        let model = try model()
        model.amount = "0.01"
        await model.requestQuote()
        XCTAssertNil(model.quote)
        XCTAssertEqual(model.note, "Couldn't fetch a quote. Check your connection and try again.")
        XCTAssertFalse(model.canReview)
    }

    func testAnEditDropsTheQuote() async throws {
        let model = try model()
        model.amount = "0.01"
        await model.requestQuote()
        XCTAssertNotNil(model.quote)
        model.amount = "0.02"
        XCTAssertNil(model.quote, "a new amount needs a new quote")
        XCTAssertFalse(model.canReview)
    }

    func testAQuoteThatLandsAfterAnEditIsDropped() async throws {
        let held = HeldTransport(avnu)
        let model = try model(http: held)
        model.amount = "0.01"
        let quoting = Task { await model.requestQuote() }
        await held.waitForHeld()
        model.amount = "0.02"
        held.release()
        await quoting.value
        XCTAssertNil(model.quote, "the reply was for the old amount")
        XCTAssertFalse(model.canReview)
    }

    func testBackDuringTheBuildDropsItsReply() async throws {
        let held = HeldTransport(avnu, holding: false)
        let model = try model(http: held)
        model.amount = "0.01"
        await model.requestQuote()
        held.holding = true
        let building = Task { await model.reviewSwap() }
        await held.waitForHeld()
        XCTAssertFalse(model.back())
        held.release()
        await building.value
        XCTAssertEqual(model.stage, .edit)
        XCTAssertNil(model.review)
        XCTAssertNil(model.swapReview)
        XCTAssertTrue(node.posts.isEmpty, "no plan ran for the dropped build")
        await model.confirm()
        XCTAssertTrue(node.posts.isEmpty, "nothing is left to confirm")
    }

    func testALateQuoteDuringTheBuildDoesNothing() async throws {
        let held = HeldTransport(avnu, holding: false)
        let model = try model(http: held)
        model.amount = "0.01"
        await model.requestQuote()
        held.holding = true
        let building = Task { await model.reviewSwap() }
        await held.waitForHeld()
        XCTAssertEqual(model.stage, .preparing)
        await model.requestQuote()
        XCTAssertNotNil(model.quote, "the build's quote is kept")
        held.release()
        await building.value
        XCTAssertEqual(model.stage, .review)
    }

    func testConfirmDuringAFeeRetryPostsNothing() async throws {
        let model = try model()
        model.amount = "0.01"
        await model.requestQuote()
        await model.reviewSwap()
        XCTAssertEqual(model.stage, .review)
        let retrying = Task { await model.retryFee() }
        await Task.yield()
        await model.confirm()
        await retrying.value
        XCTAssertFalse(node.posts.contains(where: \.write), "the retry's re-estimate owns the review")
        XCTAssertEqual(model.stage, .review)
    }

    func testTheTokenScreenSellsItsTokenAndTheSidesSwap() throws {
        let strk = try XCTUnwrap(Self.tracked("STRK"))
        let model = try model(opening: strk.token.id)
        XCTAssertEqual(model.sell?.symbol, "STRK")
        XCTAssertNotEqual(model.buy?.symbol, "STRK")
        let bought = try XCTUnwrap(model.buy)
        model.choose(bought, for: .sell)
        XCTAssertEqual(model.sell?.id, bought.id)
        XCTAssertEqual(model.buy?.symbol, "STRK", "picking the other side's token swaps the pair")
        model.flip()
        XCTAssertEqual(model.sell?.symbol, "STRK")
    }

    func testMoreThanTheBalanceCannotBeReviewed() throws {
        let eth = try XCTUnwrap(Self.tracked("ETH"))
        let model = try model(balances: [eth.token.id: "5000000000000000"])
        model.amount = "0.01"
        XCTAssertTrue(model.insufficient)
        XCTAssertEqual(model.reviewLabel, "Insufficient ETH")
        model.fillMax()
        XCTAssertEqual(model.amount, "0.005")
        XCTAssertFalse(model.insufficient)
    }

    func testTheWorseOfTheFeedAndTheAggregatorDecidesTheLoss() {
        let quote = { (feed: Double?) in
            SwapQuoteView(
                sellAmount: "0.01",
                buyAmount: "12.5",
                sellAmountInUsd: 20,
                buyAmountInUsd: 19,
                gasFeesInUsd: 0.02,
                valueDeltaPercent: feed
            )
        }
        XCTAssertEqual(SwapFlowModel.valueDelta(quote(nil)), -5)
        XCTAssertEqual(SwapFlowModel.valueDelta(quote(-20)), -20, "the feed shows a loss the aggregator hides")
        XCTAssertEqual(SwapFlowModel.valueDelta(quote(3)), -5, "and the aggregator one the feed hides")
        XCTAssertEqual(SwapRate.line(quote(nil), sell: "ETH", buy: "STRK"), "1 ETH = 1250 STRK")
        XCTAssertTrue(SwapFlowModel.decimalGreater("10", "9"))
        XCTAssertFalse(SwapFlowModel.decimalGreater("009", "10"))
    }
}

/// Canned AVNU: the quote and build replies of wallet-core's `tests/swap.rs`, paying
/// `beneficiary` and approving `spender` (the pinned Sepolia router unless a test plants another).
final class AvnuStub: PortfolioTransport, @unchecked Sendable {
    static let eth = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    static let strk = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
    static let router = "0x2c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2"
    private static let exchange = "0x1114c7103e12c2b2ecbd3a2472ba9c48ddcbf702b1c242dd570057e26212111"
    private static let sell = "0x2386f26fc10000"
    private static let buy = "0xad78ebc5ac620000"
    private static let minBuy = "0xac9ae05a71ebc000"
    private static let quoteId = "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca"
    private static let httpOK: UInt16 = 200

    private let lock = NSLock()
    private var seen: [String] = []
    var beneficiary = ""
    var spender = AvnuStub.router
    var offline = false

    var urls: [String] { lock.withLock { seen } }

    func perform(_ request: HttpRequest) -> HttpOutcome {
        lock.withLock { seen.append(request.url) }
        if offline { return .unanswered }
        let body = request.url.contains("/quotes?") ? Self.quote : build()
        return HttpOutcome(status: Self.httpOK, retryAfter: nil, body: Data(body.utf8), timedOut: false)
    }

    private static let quote = """
    [{"buyAmount":"\(buy)","buyAmountInUsd":18.8,"buyTokenAddress":"\(strk)","gasFeesInUsd":0.025,\
    "quoteId":"\(quoteId)","sellAmount":"\(sell)","sellAmountInUsd":18.79,"sellTokenAddress":"\(eth)"}]
    """

    private func build() -> String {
        let route = [
            Self.eth, Self.sell, "0x0", Self.strk, Self.buy, "0x0", Self.minBuy, "0x0",
            beneficiary, "0x0", "0x0", "0x1",
            Self.eth, Self.strk, Self.exchange, "0x2540be400", "0x2", "0x1f4", "0x0"
        ]
        let quoted = { (values: [String]) in values.map { "\"\($0)\"" }.joined(separator: ",") }
        return """
        {"chainId":"0x534e5f5345504f4c4941","calls":[\
        {"contractAddress":"\(Self.eth)","entrypoint":"approve","calldata":[\(quoted([spender, Self.sell, "0x0"]))]},\
        {"contractAddress":"\(Self.router)","entrypoint":"multi_route_swap","calldata":[\(quoted(route))]}]}
        """
    }
}

/// Holds each reply until `release()`, so a test can act while a request is in flight.
final class HeldTransport: PortfolioTransport, @unchecked Sendable {
    private let inner: AvnuStub
    private let lock = NSLock()
    private var held: [CheckedContinuation<Void, Never>] = []
    private var shouldHold: Bool

    init(_ inner: AvnuStub, holding: Bool = true) {
        self.inner = inner
        shouldHold = holding
    }

    var holding: Bool {
        get { lock.withLock { shouldHold } }
        set { lock.withLock { shouldHold = newValue } }
    }

    func perform(_ request: HttpRequest) async -> HttpOutcome {
        if holding {
            await withCheckedContinuation { continuation in lock.withLock { held.append(continuation) } }
        }
        return inner.perform(request)
    }

    /// Returns once a request is waiting.
    func waitForHeld() async {
        while lock.withLock({ held.isEmpty }) { await Task.yield() }
    }

    func release() {
        let waiting: [CheckedContinuation<Void, Never>] = lock.withLock {
            shouldHold = false
            defer { held = [] }
            return held
        }
        waiting.forEach { $0.resume() }
    }
}
