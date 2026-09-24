@testable import Bramble
import BrambleCore
import XCTest

/// The UI-side journey over a canned node: stage order and titles, Max and Half, edits dropping
/// the plan, lock voiding it, fee failure blocking Confirm, failure copy, and the host's endpoint
/// and write guarantees (one proven endpoint per plan, a write sent once and never retried).
@MainActor
final class SendFlowModelTests: XCTestCase {
    private var core: WalletCore!
    private var node: MockNode!

    override func setUp() async throws {
        core = try unlockedCore()
        node = MockNode()
        let core = core!
        let id = try ozRecord(core, .sepolia).id
        node.pendingHash = { (try? core.activity(accountId: id))?.first?.hash }
    }

    private func model(balances: [String: String] = ["STRK": "100000000000000000000"]) throws -> SendFlowModel {
        let accounts = try core.accountRecords(network: .sepolia)
        return SendFlowModel(core: core, network: sepolia(), account: accounts[0], otherAccounts: Array(accounts.dropFirst()), balances: balances, transport: node)
    }

    private func reviewed(_ model: SendFlowModel) async {
        model.recipientInput = account1
        model.continueWithRecipient()
        model.amount = "1.5"
        await model.reviewSend()
    }

    func testStagesFollowTheExtension() async throws {
        let model = try model()
        XCTAssertEqual(model.title, SendCopy.titleRecipient)
        model.recipientInput = "not an address"
        model.continueWithRecipient()
        XCTAssertEqual(model.recipientError, SendCopy.invalidRecipient)
        XCTAssertEqual(model.stage, .recipient)
        await reviewed(model)
        XCTAssertEqual(model.stage, .review)
        XCTAssertEqual(model.title, SendCopy.titleReview)
        XCTAssertEqual(model.review?.fee?.display, "0.008053 STRK")
        XCTAssertNil(model.reviewBlock)
        await model.confirm()
        XCTAssertEqual(model.stage, .submitted)
        XCTAssertEqual(model.toast, SendFlowModel.Toast(message: SendCopy.toastConfirmed, success: true))
        XCTAssertEqual(model.hash, try core.activity(accountId: try ozRecord(core, .sepolia).id).first?.hash)
        XCTAssertNotNil(model.explorerURL)
    }

    func testMaxUsesTheFullBalanceAndHalfFloors() throws {
        let model = try model(balances: ["STRK": "1234500000000000000001"])
        model.fill(half: false)
        XCTAssertEqual(model.amount, "1234.500000000000000001")
        model.fill(half: true)
        XCTAssertEqual(model.amount, "617.25")
        XCTAssertEqual(SendFlowModel.halve("3"), "1")
        let unread = try self.model(balances: [:])
        unread.fill(half: false)
        XCTAssertEqual(unread.amount, "")
        XCTAssertEqual(unread.balanceLine, SendCopy.balanceUnavailable)
    }

    func testAmountGatesUseTheExtensionCopy() async throws {
        let model = try model()
        model.recipientInput = account1
        model.continueWithRecipient()
        for (amount, message) in [("0", SendCopy.amountGate), ("1.0000000000000000001", SendCopy.amountTooManyDecimals), ("1e3", SendCopy.amountInvalid)] {
            model.amount = amount
            await model.reviewSend()
            XCTAssertEqual(model.amountError, message, amount)
            XCTAssertEqual(model.stage, .details)
        }
        XCTAssertTrue(node.posts.isEmpty, "nothing was estimated")
    }

    func testAnEditDropsTheReview() async throws {
        let model = try model()
        await reviewed(model)
        XCTAssertNotNil(model.review)
        model.edit()
        XCTAssertNil(model.review)
        XCTAssertEqual(model.stage, .details)
        await model.confirm()
        XCTAssertEqual(model.stage, .details, "confirm does nothing without a fresh review")
    }

    func testLockVoidsTheReviewedPlan() async throws {
        let model = try model()
        await reviewed(model)
        core.lock()
        try core.unlock(password: testPassword)
        await model.confirm()
        XCTAssertEqual(model.stage, .failed)
        XCTAssertFalse(node.posts.contains { $0.write })
        XCTAssertTrue(try core.activity(accountId: try ozRecord(core, .sepolia).id).isEmpty)
    }

    func testFeeFailureBlocksConfirm() async throws {
        node.failEstimate = true
        let model = try model()
        await reviewed(model)
        XCTAssertEqual(model.stage, .review)
        XCTAssertEqual(model.review?.canConfirm, false)
        XCTAssertEqual(model.reviewBlock, SendCopy.feeUnavailableBlock)
        await model.confirm()
        XCTAssertEqual(model.stage, .review)
        XCTAssertFalse(node.posts.contains { $0.write })
    }

    func testAWriteIsSentOnceAndNeverRetried() async throws {
        node.failWrites = true
        let model = try model()
        await reviewed(model)
        await model.confirm()
        XCTAssertEqual(model.stage, .failed)
        XCTAssertEqual(node.posts.filter(\.write).count, 1)
        let hash = try XCTUnwrap(try core.activity(accountId: try ozRecord(core, .sepolia).id).first?.hash)
        XCTAssertEqual(model.failureMessage, SendCopy.failurePrefix + SendCopy.failureIndeterminate)
        XCTAssertEqual(model.hash, hash, "the pending record's hash stays visible")
    }

    func testClosingAfterTheWriteLeftNeverReportsNotSent() async throws {
        let model = try model()
        await reviewed(model)
        node.onWrite = { await model.close() } // backgrounded while the write is in flight
        await model.confirm()
        XCTAssertEqual(model.stage, .failed)
        let hash = try XCTUnwrap(try core.activity(accountId: try ozRecord(core, .sepolia).id).first?.hash)
        XCTAssertEqual(model.failureMessage, SendCopy.failurePrefix + SendCopy.failureIndeterminate)
        XCTAssertEqual(model.hash, hash, "the hash of the write that may be on chain stays visible")
    }

    func testEveryStepOfAPlanUsesTheEndpointThatProvedTheChain() async throws {
        let urls = sepolia().rpcUrls.compactMap(URL.init(string:))
        XCTAssertGreaterThanOrEqual(urls.count, 3)
        node.unreachable = [urls[0]]
        node.wrongChain = [urls[1]]
        let model = try model()
        await reviewed(model)
        await model.confirm()
        XCTAssertEqual(model.stage, .submitted)
        let after = node.posts.drop { $0.url != urls[2] }
        XCTAssertEqual(Set(after.map(\.url)), [urls[2]], "no failover once an endpoint is bound")
        XCTAssertTrue(after.contains { $0.write && $0.url == urls[2] })
    }

    func testFailureCodesMapToTheExtensionCopy() {
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .reviewedFeeExceeded, hash: nil)), SendCopy.failurePrefix + SendCopy.reviewedFeeExceeded)
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .poisonedRecipient, hash: nil)), SendCopy.failurePrefix + SendCopy.poisonedRecipient)
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .wrongChain, hash: nil)), SendCopy.failurePrefix + SendCopy.failureWrongChain)
        XCTAssertEqual(SendFailureText.message(SendFailure(code: .boundsOutOfRange, hash: nil)), SendCopy.failureDefault)
    }
}
