@testable import Bramble
import BrambleCore
import XCTest

/// Starknet names on Send's recipient step (docs/PLAN.md P5 in wallet-core): the core decides
/// what is a name, builds the call and judges the reply; the app proves each endpoint's chain
/// first, fails over, fails closed, and drops an answer the field or the network has moved on from.
@MainActor
final class StarkNameLookupTests: XCTestCase {
    private var unlocked: WalletCore?
    private let node = MockNode()
    private static let resolved = "0x123abc"

    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        unlocked = try unlockedCore()
        node.callResult = [Self.resolved]
    }

    override func tearDown() {
        unlocked = nil
    }

    private func model() throws -> SendFlowModel {
        let accounts = try core.accountRecords(network: .sepolia)
        return try SendFlowModel(
            core: core,
            network: sepolia(),
            account: accounts[0],
            accounts: accounts,
            balances: [:],
            transport: node
        )
    }

    private func enter(_ text: String, into model: SendFlowModel, on network: NetworkId = .sepolia) async {
        model.recipientInput = text
        await model.continueWithTyped(known: []) { network }
    }

    func testANameResolvesUnderItsCanonicalSpelling() async throws {
        let model = try model()
        await enter(" Fricoben.STARK ", into: model)
        XCTAssertEqual(model.stage, .details)
        XCTAssertEqual(model.recipient, validateRecipient(input: Self.resolved))
        XCTAssertEqual(model.recipientLabel, "fricoben.stark")
        XCTAssertEqual(model.resolvedName, SendFlowModel.ResolvedName(isNew: true))
        XCTAssertNil(model.recipientNote)
        XCTAssertEqual(node.posts.map(\.method), ["starknet_chainId", "starknet_call"], "the chain is proven first")
        XCTAssertFalse(node.posts.contains(where: \.write))
    }

    func testAnEndpointOnAnotherChainIsNeverAskedTheName() async throws {
        let urls = try sepolia().rpcUrls.compactMap(URL.init(string:))
        node.unreachable = [urls[0]]
        node.wrongChain = [urls[1]]
        let model = try model()
        await enter("fricoben.stark", into: model)
        XCTAssertEqual(model.stage, .details)
        XCTAssertEqual(node.posts.filter { $0.method == "starknet_call" }.map(\.url), [urls[2]])
    }

    func testAStaleResultIsDropped() async throws {
        let model = try model()
        node.onCall = { await MainActor.run { model.recipientInput = "fricoben2.stark" } }
        await enter("fricoben.stark", into: model)
        XCTAssertEqual(model.stage, .recipient, "the field no longer spells the name")
        XCTAssertNil(model.recipient)

        node.onCall = nil
        let moved = try self.model()
        await enter("fricoben.stark", into: moved, on: .mainnet)
        XCTAssertEqual(moved.stage, .recipient, "the wallet left the network the name was read on")
        XCTAssertNil(moved.recipient)
    }

    func testFailuresStopWithTheExtensionsLines() async throws {
        node.callResult = ["0x0"]
        var model = try model()
        await enter("nobody.stark", into: model)
        XCTAssertEqual(model.recipientNote, "No address found for nobody.stark.")
        XCTAssertEqual(model.stage, .recipient)

        node.callResult = [Self.resolved]
        node.unreachable = Set(try sepolia().rpcUrls.compactMap(URL.init(string:)))
        model = try self.model()
        await enter("fricoben.stark", into: model)
        XCTAssertEqual(model.recipientNote, "Could not reach the network to resolve fricoben.stark.")

        node.unreachable = []
        node.wrongChain = Set(try sepolia().rpcUrls.compactMap(URL.init(string:)))
        model = try self.model()
        await enter("fricoben.stark", into: model)
        XCTAssertEqual(model.recipientNote, "Could not resolve fricoben.stark.", "fails closed")
        XCTAssertNil(model.recipient)
        model.recipientInput = "f"
        XCTAssertNil(model.recipientNote, "a keystroke retires the note")
    }

    func testAListedRowWinsOverAName() async throws {
        let model = try model()
        let row = SendRecipients.Row(id: "c", name: "fricoben.stark", address: account1, short: "", current: false)
        model.recipientInput = "Fricoben.stark"
        await model.continueWithTyped(known: [row]) { .sepolia }
        XCTAssertEqual(model.recipient, validateRecipient(input: account1))
        XCTAssertNil(model.resolvedName)
        XCTAssertTrue(node.posts.isEmpty, "nothing is resolved over a row the screen shows")
    }

    func testTheReviewShowsTheFullResolvedAddress() {
        let facts = SendReviewCopy.facts(
            sender: ("Main", account1),
            recipient: ("fricoben.stark", account1),
            amount: "1",
            symbol: "STRK",
            resolvedFromName: true
        )
        XCTAssertEqual(facts[1].detail, account1)
        XCTAssertEqual(facts[1].source, SendReviewCopy.resolvedSource)
        XCTAssertNil(facts[1].reveal)
    }
}
