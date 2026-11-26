@testable import Bramble
import BrambleCore
import XCTest

/// The host half of a gasless send (`GaslessDriver`): every request the core describes is posted
/// as described, every reply goes back to the core, and each way the core ends a submission reads
/// as the journey shows it. No paymaster is reached: the transport and the core object are scripted.
final class GaslessDriverTests: XCTestCase {
    private static let request = HttpRequest(
        method: .post,
        url: "https://paymaster.test/rpc",
        headers: [],
        body: "{}",
        maxBodyBytes: 1_024,
        deadlineMs: 1_000
    )
    fileprivate static let reply = HttpOutcome(status: 200, retryAfter: nil, body: Data("{}".utf8), timedOut: false)
    private static let offer = GaslessOffer(
        amount: "1250000",
        decimals: 6,
        label: "USDC",
        tokenAddress: "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
        display: "1.25 USDC"
    )
    private static let post = GaslessPost(request: request, delayMs: 0)

    func testTheOfferRoundPostsEachRequestAndEndsOnTheCoresOffers() async {
        let transport = ScriptedTransport()
        let fee = ScriptedFee(offerSteps: [.post(post: Self.post), .done(offers: [Self.offer])])
        let offers = await GaslessDriver(transport: transport).offers(fee, first: .post(post: Self.post))
        XCTAssertEqual(offers, [Self.offer])
        XCTAssertEqual(transport.count, 2)
        XCTAssertEqual(fee.replies, 2)
    }

    func testARoundTheCoreRefusesOffersNothing() async {
        let driver = GaslessDriver(transport: ScriptedTransport())
        let offers = await driver.offers(ScriptedFee(), first: .post(post: Self.post))
        XCTAssertTrue(offers.isEmpty)
    }

    func testAChosenOfferIsPostedThenSubmittedWithTheRelaysHash() async {
        let transport = ScriptedTransport()
        let fee = ScriptedFee(
            chosen: { .post(post: Self.post) },
            submitSteps: [{ .submitted(transactionHash: "0x7a1ce5", explorerUrl: nil) }]
        )
        let outcome = await GaslessDriver(transport: transport).submit(fee, offer: Self.offer, prices: nil)
        XCTAssertEqual(outcome, .submitted(hash: "0x7a1ce5", explorerUrl: nil))
        XCTAssertEqual(transport.count, 1)
    }

    func testAWaitResumesThroughTheCoreBeforeTheExecuteIsPostedAgain() async {
        let transport = ScriptedTransport()
        let fee = ScriptedFee(chosen: { .wait(delayMs: 1) }, resumed: { throw GaslessFeeError.Locked })
        let outcome = await GaslessDriver(transport: transport).submit(fee, offer: Self.offer, prices: nil)
        XCTAssertEqual(outcome, .locked)
        XCTAssertEqual(fee.resumes, 1)
        XCTAssertEqual(transport.count, 0, "a locked resume posts nothing")
    }

    func testAStrayErrorAfterThePostReadsAsUnknown() async {
        let transport = ScriptedTransport()
        let fee = ScriptedFee(
            chosen: { .post(post: Self.post) },
            submitSteps: [{ throw CocoaError(.coderInvalidValue) }]
        )
        let outcome = await GaslessDriver(transport: transport).submit(fee, offer: Self.offer, prices: nil)
        XCTAssertEqual(outcome, .unknown(SendCopy.failureIndeterminate))
        XCTAssertEqual(transport.count, 1, "the execute went out before the failure")
    }

    func testACancelledChoiceStopsAtThePauseAsUnknown() async {
        let transport = ScriptedTransport()
        let fee = ScriptedFee { .post(post: GaslessPost(request: Self.request, delayMs: 60_000)) }
        let task = Task { await GaslessDriver(transport: transport).submit(fee, offer: Self.offer, prices: nil) }
        task.cancel()
        let outcome = await task.value
        XCTAssertEqual(outcome, .unknown(SendCopy.failureIndeterminate))
        XCTAssertEqual(transport.count, 0, "the core's delay is never cut short")
    }

    func testAChoiceTheRoundDidNotMakeSendsNothing() async {
        let transport = ScriptedTransport()
        let outcome = await GaslessDriver(transport: transport).submit(ScriptedFee(), offer: Self.offer, prices: nil)
        XCTAssertEqual(outcome, .moved)
        XCTAssertEqual(transport.count, 0)
    }

    func testTheChoiceReadsTheCoresAmountAndToken() {
        XCTAssertEqual(SendReviewCopy.payUpTo(Self.offer), "Pay up to 1.25 USDC")
    }

    func testRefusalsAndALostExecuteKeepTheCoresSentence() {
        let refused = "This network fee quote was refused. Nothing was submitted."
        let lost = "Transaction submission status is unknown. Check activity and on-chain state before retrying."
        XCTAssertEqual(GaslessDriver.outcome(.Refused(reason: refused, retryable: false)), .refused(refused))
        XCTAssertEqual(GaslessDriver.outcome(.Lost(reason: lost)), .unknown(lost))
    }
}

/// Answers every request with an empty 200 and counts them.
private final class ScriptedTransport: PortfolioTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var posted = 0

    var count: Int {
        lock.withLock { posted }
    }

    func perform(_: HttpRequest) async -> HttpOutcome {
        lock.withLock { posted += 1 }
        await Task.yield()
        return GaslessDriverTests.reply
    }
}

/// A core object answering from scripts; any step past a script's end is the core's `NotFound`.
private final class ScriptedFee: GaslessFeeProtocol, @unchecked Sendable {
    private var offerSteps: [GaslessOfferStep]
    private let chosen: () throws -> GaslessSubmitStep
    private var submitSteps: [() throws -> GaslessSubmitStep]
    private let resumed: () throws -> GaslessSubmitStep
    private(set) var replies = 0
    private(set) var resumes = 0

    init(
        offerSteps: [GaslessOfferStep] = [],
        chosen: @escaping () throws -> GaslessSubmitStep = { throw GaslessFeeError.NotFound },
        submitSteps: [() throws -> GaslessSubmitStep] = [],
        resumed: @escaping () throws -> GaslessSubmitStep = { throw GaslessFeeError.NotFound }
    ) {
        self.offerSteps = offerSteps
        self.chosen = chosen
        self.submitSteps = submitSteps
        self.resumed = resumed
    }

    func acceptOfferReply(outcome _: HttpOutcome) throws -> GaslessOfferStep {
        replies += 1
        guard !offerSteps.isEmpty else { throw GaslessFeeError.NotFound }
        return offerSteps.removeFirst()
    }

    func choose(offer _: GaslessOffer, prices _: PriceView?, nowMs _: UInt64) throws -> GaslessSubmitStep {
        try chosen()
    }

    func resume() throws -> GaslessSubmitStep {
        resumes += 1
        return try resumed()
    }

    func acceptSubmitReply(outcome _: HttpOutcome, nowMs _: UInt64) throws -> GaslessSubmitStep {
        replies += 1
        guard !submitSteps.isEmpty else { throw GaslessFeeError.NotFound }
        return try submitSteps.removeFirst()()
    }
}
