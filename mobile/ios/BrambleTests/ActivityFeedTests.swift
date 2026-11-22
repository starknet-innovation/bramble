@testable import Bramble
import BrambleCore
import XCTest

/// The Activity screen's wiring of the core's P2 and P10 exports: the expanded row's fee and value
/// when sent, in the extension's order; a send priced at submission from the wallet's price cache.
@MainActor
final class ActivityFeedTests: XCTestCase {
    private static let strk = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"

    private func sent(
        amount: String = "1.5",
        fee: TransactionFee? = nil,
        price: SubmittedPrice? = nil
    ) -> ActivityEntry {
        ActivityEntry(
            accountId: "SN_MAIN:0x1",
            amount: amount,
            counterparty: "0x5a1b",
            direction: .out,
            failureNotice: nil,
            feePaid: fee,
            finalizedOnL1: nil,
            hash: "0xabc1",
            kind: .transfer,
            network: .mainnet,
            notFoundCount: nil,
            origin: .wallet,
            status: .accepted,
            submittedAt: 1_790_000_000_000,
            submittedPrice: price,
            summary: "Sent \(amount) STRK",
            token: "STRK",
            tokenAddress: Self.strk
        )
    }

    /// The expansion lists the value at submission, then the network fee, then the network; a row
    /// that recorded neither shows the network alone, never an estimate.
    func testExpandedRowShowsTheValueWhenSentAndTheFee() {
        let entry = sent(
            fee: TransactionFee(amount: "8053000000000000", unit: .fri),
            price: SubmittedPrice(currency: .usd, pricedAt: 1_790_000_000_000, unitPrice: 0.5)
        )
        let facts = ActivityRowView.recordFacts(of: entry, network: "Starknet Mainnet")
            .map { "\($0.label): \($0.value)" }
        XCTAssertEqual(facts, [
            "Value at submission: $0.75",
            "Network fee: 0.008053 STRK",
            "Network: Starknet Mainnet"
        ])
        let bare = ActivityRowView.recordFacts(of: sent(), network: "Starknet Mainnet").map(\.label)
        XCTAssertEqual(bare, ["Network"])
    }

    /// The wallet's price cache holding a fresh STRK price (the "ready" CoinGecko answer, $0.50).
    private func freshPrices(for address: String) async throws -> PriceBook {
        let book = PriceBook(persisted: nil)
        let now = (Date().timeIntervalSince1970 * 1_000).rounded(.down)
        let plan = book.plan(network: .mainnet, addresses: [address], currency: .usd, nowMs: now, cachedOnly: false)
        guard case let .fetch(requests) = plan else { throw XCTSkip("a new price book always fetches") }
        let transport = StubTransport(scenario: "ready")
        var outcomes: [PriceOutcome] = []
        for request in requests {
            let outcome = await transport.perform(request.request)
            outcomes.append(PriceOutcome(address: request.address, outcome: outcome))
        }
        _ = book.apply(
            network: .mainnet,
            addresses: [address],
            currency: .usd,
            outcomes: outcomes,
            attemptedAtMs: now
        )
        return book
    }

    /// Sends 1.5 STRK on Mainnet through the journey from a new wallet, and returns its record.
    private func send(pricing: (prices: PriceBook, currency: DisplayCurrency)?) async throws -> ActivityEntry? {
        let core = try unlockedCore()
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet })
        let account = try ozRecord(core, .mainnet)
        let node = MockNode()
        node.chainId = "0x534e5f4d41494e"
        node.pendingHash = { (try? core.activity(accountId: account.id))?.first?.hash }
        let model = SendFlowModel(
            core: core,
            network: network,
            account: account,
            accounts: [account],
            balances: ["STRK": "100000000000000000000"],
            transport: node,
            pricing: pricing
        )
        model.recipientInput = account1
        model.continueWithRecipient()
        model.amount = "1.5"
        await model.reviewSend()
        await model.confirm()
        XCTAssertEqual(model.stage, .submitted)
        return try core.activity(accountId: account.id).first
    }

    /// A public send made through the journey records the fresh cached unit price, so its row can
    /// say what it was worth when sent (`withSubmittedPrice`); without the wallet's prices it
    /// records none.
    func testASendIsPricedAtSubmission() async throws {
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet })
        let token = try XCTUnwrap(network.tokens.first { $0.symbol == "STRK" })
        let priced = try await send(pricing: (try await freshPrices(for: token.address), .usd))
        XCTAssertEqual(priced?.submittedPrice?.unitPrice, 0.5)
        XCTAssertEqual(priced?.submittedPrice?.currency, .usd)
        XCTAssertEqual(priced.flatMap { activityValueText(entry: $0) }, "$0.75")
        let unpriced = try await send(pricing: nil)
        XCTAssertNotNil(unpriced)
        XCTAssertNil(unpriced?.submittedPrice)
    }
}
