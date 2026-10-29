@testable import Bramble
import BrambleCore
import XCTest

/// Deploy account against the extension's `bindDeploy` over a canned node: the fee is quoted as
/// the screen opens, one Deploy press submits under it, a failed quote is quoted again on the
/// next press without spending anything, an account on chain says so, and the receipt firms up
/// from "Deployment submitted" to "Account deployed" once the chain answers. Settings' "This
/// account" row is what opens it.
@MainActor
final class DeployFlowModelTests: XCTestCase {
    private var unlocked: WalletCore?
    private let node = MockNode()

    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        let wallet = try unlockedCore()
        unlocked = wallet
        let id = try ozRecord(wallet, .sepolia).id
        node.pendingHash = { (try? wallet.activity(accountId: id))?.first?.hash }
        node.deployed = false
    }

    override func tearDown() {
        unlocked = nil
    }

    private func model() throws -> DeployFlowModel {
        try DeployFlowModel(core: core, network: sepolia(), accountId: ozRecord(core, .sepolia).id, transport: node)
    }

    private func screen(_ state: String) throws -> [String] {
        let copy: [String: Any] = try fixtureValue(transactionFixture(), "copy")
        let screens: [String: Any] = try fixtureValue(copy, "screens")
        let deploy: [String: Any] = try fixtureValue(screens, "deployAccount")
        return try fixtureValue(deploy, state)
    }

    func testTheScreenReadsTheExtensionsWords() throws {
        // Title, network, the Account / Address / Network rows, the note that the first send also
        // deploys (issue 662), the button, the receipt, then the failure's actions.
        let undeployed = try screen("undeployed")
        XCTAssertEqual(undeployed.count, 15)
        XCTAssertEqual(
            [undeployed[0], undeployed[2], undeployed[4], undeployed[6], undeployed[8], undeployed[9]],
            [
                SendCopy.deployTitle, SendCopy.deployAccountRow, SendCopy.deployAddressRow,
                SendCopy.deployNetworkRow, SendCopy.deployNote, SendCopy.deployButton
            ]
        )
        XCTAssertEqual(
            Array(undeployed[10...12]),
            [SendCopy.transactionLabel, SendCopy.viewActivity, SendCopy.back]
        )
        XCTAssertEqual(try screen("deployed")[8], SendCopy.alreadyDeployed)
        XCTAssertEqual(SettingsHubView.deployRow.section, SendCopy.settingsThisAccount)
        XCTAssertEqual(SettingsHubView.deployRow.title, SendCopy.settingsDeployRow)
        XCTAssertEqual(SettingsHubView.deployFlow, .deploy, "This account › Deploy account opens the deploy screen")
    }

    func testTheFeeIsQuotedOnOpenAndOnePressDeploys() async throws {
        let model = try model()
        XCTAssertEqual(model.stage, .estimating)
        XCTAssertEqual(model.status, SendCopy.deployEstimating)
        await model.quote()
        XCTAssertEqual(model.stage, .quoted)
        XCTAssertNotNil(model.fee)
        XCTAssertNil(model.status)
        XCTAssertFalse(node.posts.contains(where: \.write), "quoting sends nothing")

        await model.deploy()
        XCTAssertEqual(node.posts.filter(\.write).map(\.method), ["starknet_addDeployAccountTransaction"])
        XCTAssertEqual(model.hash, try core.activity(accountId: try ozRecord(core, .sepolia).id).first?.hash)
        XCTAssertNotNil(model.explorerURL)
        XCTAssertEqual(model.stage, .confirmed, "the node answers accepted")
        XCTAssertEqual(model.receipt.title, SendCopy.deployConfirmedTitle)
        XCTAssertEqual(model.receipt.message, SendCopy.deployConfirmedBody)
    }

    func testAFailedQuoteIsQuotedAgainBeforeAnythingIsSpent() async throws {
        node.failEstimate = true
        let model = try model()
        await model.quote()
        XCTAssertEqual(model.stage, .estimateFailed)
        XCTAssertEqual(model.status, SendCopy.deployEstimateFailed)
        XCTAssertNil(model.fee)

        // The press with no figure in hand only fetches one, so no fee is spent unseen.
        node.failEstimate = false
        await model.deploy()
        XCTAssertEqual(model.stage, .quoted)
        XCTAssertNotNil(model.fee)
        XCTAssertFalse(node.posts.contains(where: \.write))

        await model.deploy()
        XCTAssertEqual(node.posts.filter(\.write).count, 1)
        XCTAssertEqual(model.stage, .confirmed)
    }

    func testADeployedAccountSaysSo() async throws {
        node.deployed = true
        let model = try model()
        await model.quote()
        XCTAssertEqual(model.stage, .alreadyDeployed)
        XCTAssertNil(model.fee)
        await model.deploy()
        XCTAssertEqual(model.stage, .alreadyDeployed, "Deploy does nothing for an account on chain")
        XCTAssertFalse(node.posts.contains(where: \.write))
    }

    func testTheReceiptSaysSubmittedUntilTheChainAnswers() throws {
        let model = try model()
        XCTAssertEqual(model.receipt.title, SendCopy.deploySubmittedTitle)
        XCTAssertNil(model.receipt.message)
    }
}
