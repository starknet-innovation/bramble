@testable import Bramble
import BrambleCore
import XCTest

/// Send's confirm face against the extension's rendered review (`extension-transactions-copy.json`,
/// `copy.screens.review` and `copy.reviewFee`): the From / To / Amount facts, the Cost box in each
/// fee state (one combined figure with the deployment's share for a first send), and the risks
/// panel, which says nothing when there is nothing to warn about.
final class SendReviewCopyTests: XCTestCase {
    /// The recorded estimate the extension's review quotes: 0.008053 STRK to send, 0.005 STRK to
    /// deploy the account.
    private let sendFee = FeeAmount(maxSpend: "8053000000000000", unit: .fri, display: "0.008053 STRK")
    private let deployFee = FeeAmount(maxSpend: "5000000000000000", unit: .fri, display: "0.005 STRK")

    private func copy() throws -> [String: Any] {
        try fixtureValue(transactionFixture(), "copy")
    }

    private func review(
        fee: FeeAmount?,
        deploymentFee: FeeAmount? = nil,
        requiresDeployment: Bool = false,
        affordability: FeeAffordability = .sufficient,
        flags: [ReviewFlag] = []
    ) -> TransferReview {
        TransferReview(
            summary: "Send 1.5 STRK to 0x3fa7…41a3",
            recipient: account1,
            recipientShort: shortAddress(account1),
            amountDisplay: "1.5",
            tokenSymbol: "STRK",
            fee: fee,
            feeEstimateFailed: fee == nil,
            deploymentFee: deploymentFee,
            deploymentFeeEstimateFailed: requiresDeployment && deploymentFee == nil,
            requiresDeployment: requiresDeployment,
            alreadyDeployed: false,
            affordability: affordability,
            flags: flags,
            canConfirm: fee != nil
        )
    }

    func testFactsReadFromToAndAmount() throws {
        let review: [String: Any] = try fixtureValue(copy()["screens"] as? [String: Any] ?? [:], "review")
        let summary: [String] = try fixtureValue(review, "summary")
        let labels: [String] = try fixtureValue(review, "summaryLabels")
        // The rendered list: label, value, detail for each fact, then for From and To the
        // disclosure's summary and the full address it opens to; the addresses are the titles.
        XCTAssertEqual(summary.count, 13)
        XCTAssertEqual(labels.count, 4)
        let amount = summary[11].split(separator: " ").map(String.init)
        let facts = SendReviewCopy.facts(
            sender: (summary[1], labels[1]),
            recipient: (nil, labels[2]),
            amount: amount.first ?? "",
            symbol: amount.last ?? ""
        )
        XCTAssertEqual(
            facts.flatMap { fact in
                [fact.label, fact.value, fact.detail] + (fact.reveal.map { [$0.label, $0.address] } ?? [])
            },
            summary
        )
        XCTAssertEqual(facts.map(\.copy), [nil, labels[2], nil], "only the recipient is copied")
        XCTAssertEqual(labels.first, SendCopy.copyRecipient)
        // A recipient picked from a row reads under that row's name, over its truncated address.
        let named = SendReviewCopy.facts(
            sender: (summary[1], labels[1]),
            recipient: ("Savings", labels[2]),
            amount: "1.5",
            symbol: "STRK"
        )
        XCTAssertEqual(named[1].value, "Savings")
        XCTAssertEqual(named[1].detail, summary[7])
    }

    func testCostBoxFollowsEachFeeState() throws {
        let fees: [String: [String]] = try fixtureValue(copy(), "reviewFee")
        XCTAssertEqual(SendReviewCopy.cost(review(fee: sendFee)).texts, fees["deployedKnown"])
        XCTAssertEqual(SendReviewCopy.cost(review(fee: nil)).texts, fees["deployedFailed"])
        // A first send pays for the deployment too: one total, and the deployment's share of it.
        let undeployed = review(fee: sendFee, deploymentFee: deployFee, requiresDeployment: true)
        XCTAssertEqual(SendReviewCopy.cost(undeployed).texts, fees["undeployedKnown"])
        let failed = review(fee: sendFee, requiresDeployment: true)
        XCTAssertEqual(SendReviewCopy.cost(failed).texts, fees["undeployedFailed"])
        let screens: [String: Any] = try fixtureValue(copy(), "screens")
        let shortfall: [String] = try fixtureValue(try fixtureValue(screens, "review") as [String: Any], "shortfall")
        XCTAssertEqual(SendReviewCopy.cost(review(fee: sendFee, affordability: .insufficient)).texts, shortfall)
    }

    func testRisksPanelOnlyWhenThereIsSomethingToSay() throws {
        let screens: [String: Any] = try fixtureValue(copy(), "screens")
        let rendered: [String: Any] = try fixtureValue(screens, "review")
        let quiet: [String] = try fixtureValue(rendered, "risks")
        let undeployed: [String] = try fixtureValue(rendered, "risksUndeployed")
        XCTAssertEqual(SendReviewCopy.risks(review(fee: sendFee)), quiet)
        XCTAssertTrue(quiet.isEmpty, "no panel, and no 'no warnings' line either")
        let first = review(fee: sendFee, deploymentFee: deployFee, requiresDeployment: true)
        XCTAssertEqual([SendCopy.riskAndRecovery] + SendReviewCopy.risks(first), undeployed)
        XCTAssertEqual(
            SendReviewCopy.risks(review(fee: sendFee, flags: [.selfTransfer, .addressPoisoning])),
            [SendCopy.selfTransfer, SendCopy.poisonedRecipient]
        )
    }

    func testTheCombinedFeeIsAnExactSumInLikeUnits() {
        XCTAssertEqual(SendReviewCopy.total(sendFee, deployFee), "0.013053 STRK")
        let wei = FeeAmount(maxSpend: "7", unit: .wei, display: "7 WEI")
        XCTAssertNil(SendReviewCopy.total(sendFee, wei), "unlike units fail closed")
        XCTAssertEqual(SendReviewCopy.total(wei, wei), "14 WEI")
        XCTAssertEqual(SendReviewCopy.addDecimal("999999999999999999999", "1"), "1000000000000000000000")
        XCTAssertEqual(SendReviewCopy.addDecimal("0", "0"), "0")
        XCTAssertNil(SendReviewCopy.addDecimal("12a", "1"))
        XCTAssertNil(SendReviewCopy.addDecimal("", "1"))
    }
}
