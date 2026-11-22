@testable import Bramble
import BrambleCore
import XCTest

/// The Activity screen's wiring of the core's P2 and P10 exports: the expanded row's fee and value
/// when sent, in the extension's order.
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
}
