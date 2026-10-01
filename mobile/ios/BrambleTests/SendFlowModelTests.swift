@testable import Bramble
import BrambleCore
import XCTest

/// The UI-side journey over a canned node: stage order and titles, recipient names, the asset
/// choice, Max and Half, leaving the review dropping the plan, lock voiding it, fee failure
/// blocking Confirm, failure copy, and the host's endpoint and write guarantees (one proven
/// endpoint per plan, a write sent once and never retried).
@MainActor
final class SendFlowModelTests: XCTestCase {
    private var unlocked: WalletCore?
    private let node = MockNode()

    /// The wallet `setUp` unlocked; reading it before `setUp` (or after `tearDown`) fails the test.
    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        let wallet = try unlockedCore()
        unlocked = wallet
        let id = try ozRecord(wallet, .sepolia).id
        node.pendingHash = { (try? wallet.activity(accountId: id))?.first?.hash }
    }

    override func tearDown() {
        unlocked = nil
    }

    private func model(balances: [String: String] = ["STRK": "100000000000000000000"]) throws -> SendFlowModel {
        let accounts = try core.accountRecords(network: .sepolia)
        return try SendFlowModel(
            core: core,
            network: sepolia(),
            account: accounts[0],
            accounts: accounts,
            balances: balances,
            transport: node
        )
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
        let gates = [
            ("0", SendCopy.amountGate),
            ("1.0000000000000000001", SendCopy.amountTooManyDecimals),
            ("1e3", SendCopy.amountInvalid)
        ]
        for (amount, message) in gates {
            model.amount = amount
            await model.reviewSend()
            XCTAssertEqual(model.amountError, message, amount)
            XCTAssertEqual(model.stage, .details)
        }
        XCTAssertTrue(node.posts.isEmpty, "nothing was estimated")
    }

    func testLeavingTheReviewDropsIt() async throws {
        let model = try model()
        await reviewed(model)
        XCTAssertNotNil(model.review)
        // The confirm face has no Edit button: Back returns to the details and drops the plan.
        model.back()
        XCTAssertNil(model.review)
        XCTAssertEqual(model.stage, .details)
        await model.confirm()
        XCTAssertEqual(model.stage, .details, "confirm does nothing without a fresh review")
        model.back()
        XCTAssertEqual(model.stage, .recipient)
    }

    func testARowNamesTheRecipientAndTypedTextNever() throws {
        let model = try model()
        let second = try ozRecord(core, .sepolia, 1)
        model.useRecipient(second.address, label: second.displayName)
        XCTAssertEqual(model.stage, .details)
        XCTAssertEqual(model.recipientLabel, second.displayName)
        model.back()
        model.recipientInput = account1
        model.continueWithRecipient()
        XCTAssertNil(model.recipientLabel, "a typed address with no matching row reads as its address")
        XCTAssertEqual(model.recipient, validateRecipient(input: account1))
    }

    func testATokenScreenOpensSendOnItsTokenAtTheRecipientStep() throws {
        let network = try sepolia()
        let other = try XCTUnwrap(network.tokens.first { $0.symbol != "STRK" })
        let accounts = try core.accountRecords(network: .sepolia)
        // A zero-padded spelling of the token's address is the same token.
        let padded = "0x0" + other.address.dropFirst(2).drop { $0 == "0" }
        let seeded = try SendFlowModel(
            core: core,
            network: network,
            account: accounts[0],
            accounts: accounts,
            balances: [:],
            transport: node,
            openingToken: padded
        )
        XCTAssertEqual(seeded.token.address, other.address)
        XCTAssertEqual(seeded.stage, .recipient, "Send seeds the asset and nothing else")
        XCTAssertNil(SendFlowModel.token("0x1234", in: network), "an unknown token opens on STRK")
    }

    func testChoosingAnAssetKeepsTheDetailsAndClearsTheAmount() throws {
        let model = try model()
        model.recipientInput = account1
        model.continueWithRecipient()
        XCTAssertEqual(model.token.symbol, "STRK", "the journey opens on STRK")
        model.amount = "1"
        let other = try XCTUnwrap(model.network.tokens.first { $0.symbol != "STRK" })
        model.choose(other)
        XCTAssertEqual(model.token.address, other.address)
        XCTAssertEqual(model.amount, "")
        XCTAssertEqual(model.stage, .details)
        XCTAssertEqual(model.title, SendCopy.titleDetails)
    }

    func testLockVoidsTheReviewedPlan() async throws {
        let model = try model()
        await reviewed(model)
        try core.lock()
        try core.unlock(password: testPassword)
        await model.confirm()
        XCTAssertEqual(model.stage, .failed)
        XCTAssertFalse(node.posts.contains(where: \.write))
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
        XCTAssertFalse(node.posts.contains(where: \.write))
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
        // "Edit transaction" returns to the details; the write is never retried from there.
        model.edit()
        XCTAssertEqual(model.stage, .details)
        XCTAssertEqual(node.posts.filter(\.write).count, 1)
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
        let urls = try sepolia().rpcUrls.compactMap(URL.init(string:))
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
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .reviewedFeeExceeded, hash: nil)),
            SendCopy.failurePrefix + SendCopy.reviewedFeeExceeded
        )
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .poisonedRecipient, hash: nil)),
            SendCopy.failurePrefix + SendCopy.poisonedRecipient
        )
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .wrongChain, hash: nil)),
            SendCopy.failurePrefix + SendCopy.failureWrongChain
        )
        XCTAssertEqual(
            SendFailureText.message(SendFailure(code: .boundsOutOfRange, hash: nil)),
            SendCopy.failureDefault
        )
    }
}
