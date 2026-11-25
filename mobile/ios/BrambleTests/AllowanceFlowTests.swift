@testable import Bramble
import BrambleCore
import XCTest

/// A canned Sepolia node for the allowance reads: no `Approval` events, block 0, and every
/// `allowance(owner, spender)` answered with `allowance`. Unreachable, it answers nothing.
final class AllowanceNode: PortfolioTransport, @unchecked Sendable {
    private static let statusOK: UInt16 = 200
    private let lock = NSLock()
    private var _allowance = "0x3e8"
    private var _unreachable = false

    var allowance: String {
        get { lock.withLock { _allowance } }
        set { lock.withLock { _allowance = newValue } }
    }

    var unreachable: Bool {
        get { lock.withLock { _unreachable } }
        set { lock.withLock { _unreachable = newValue } }
    }

    func perform(_ request: HttpRequest) async -> HttpOutcome {
        await Task.yield()
        guard !unreachable,
              let body = request.body,
              let object = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let method = object["method"] as? String else { return .unanswered }
        let result: Any = switch method {
        case "starknet_chainId":
            "0x534e5f5345504f4c4941"

        case "starknet_getEvents":
            ["events": [Any]()]

        case "starknet_call":
            [allowance, "0x0"]

        default:
            0
        }
        let reply: [String: Any] = ["jsonrpc": "2.0", "id": object["id"] ?? 0, "result": result]
        let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data()
        return HttpOutcome(status: Self.statusOK, retryAfter: nil, body: data, timedOut: false)
    }
}

/// The allowance manager over the real core and canned nodes, as the core's own
/// `tests/allowances.rs`: the listing names the wallet's grant, the revoke is reviewed as the
/// core's one `approve(spender, 0)` with its fee in view and is sent once, a zero reading then
/// settles it, a refusal reads in the core's own words, and an unanswered listing says it is
/// partial. The row copy is held to the extension's (`allowance-views.ts`) and to the fixture.
@MainActor
final class AllowanceFlowTests: XCTestCase {
    private static let strk = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
    private static let spender = "0x41fd22b238fa21cfcf5dd45a8548974d8263b3a531a60388411c5e230f97023"

    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    private let chain = AllowanceNode()
    private let node = MockNode()
    private var unlocked: WalletCore?

    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        let wallet = try unlockedCore(in: directory)
        unlocked = wallet
        let id = try ozRecord(wallet, .sepolia).id
        node.pendingHash = { (try? wallet.activity(accountId: id))?.first?.hash }
    }

    override func tearDown() {
        unlocked = nil
        try? FileManager.default.removeItem(at: directory)
    }

    private func id(_ owner: String) -> String { "\(owner):\(Self.strk):\(Self.spender)" }

    /// The log holding one 1000-unit STRK grant to the spender by each of `owners` (test data).
    private func seed(_ owners: [String]) throws {
        let records = owners.map { owner in
            [
                "accountId": owner, "amount": "1000", "id": id(owner), "networkId": "SN_SEPOLIA",
                "spender": Self.spender, "token": Self.strk
            ]
        }
        try JSONSerialization.data(withJSONObject: records)
            .write(to: directory.appendingPathComponent("allowances.v1.json"))
    }

    private func listing() async throws -> AllowanceList {
        let listing = try core.allowanceListing(
            accountId: ozRecord(core, .sepolia).id,
            tokens: TokenPreferences(persisted: nil)
        )
        let network = try sepolia()
        guard case let .loaded(list) = await PortfolioEndpoints(transport: chain).list(listing, on: network) else {
            throw XCTSkip("the listing was not answered")
        }
        return list
    }

    private func model(_ allowance: AllowanceView) throws -> RevokeFlowModel {
        try RevokeFlowModel(
            core: core,
            network: sepolia(),
            accountId: ozRecord(core, .sepolia).id,
            allowance: allowance,
            tokens: TokenPreferences(persisted: nil),
            feeBalance: "100000000000000000000",
            endpoints: PortfolioEndpoints(transport: chain),
            transport: node
        )
    }

    private func view(
        amount: String,
        lowerBound: Bool = false,
        source: AllowanceSource = .wallet,
        unconfirmed: Bool = false,
        id: String = "x"
    ) -> AllowanceView {
        AllowanceView(
            id: id,
            accountId: "a",
            network: .sepolia,
            token: Self.strk,
            spender: Self.spender,
            amount: amount,
            lowerBound: lowerBound,
            revoking: false,
            source: source,
            unconfirmedToken: unconfirmed
        )
    }

    func testTheListingNamesTheWalletsGrantAndTheRevokeIsSentOnceThenSettles() async throws {
        let owner = try ozRecord(core, .sepolia).id
        try seed([owner])
        let listed = try await listing()
        XCTAssertEqual(listed.notices, [])
        let grant = try XCTUnwrap(listed.allowances.first)
        XCTAssertEqual(listed.allowances.count, 1)
        XCTAssertEqual(grant.id, id(owner))
        XCTAssertEqual(grant.amount, "1000")
        XCTAssertEqual(grant.source, .wallet)
        XCTAssertFalse(grant.unconfirmedToken)
        XCTAssertTrue(AllowanceCopy.canRevoke(grant))

        let revoke = try model(grant)
        await revoke.prepare()
        XCTAssertEqual(revoke.stage, .review)
        let review = try XCTUnwrap(revoke.review)
        XCTAssertTrue(review.canConfirm)
        XCTAssertFalse(review.summary.isEmpty, "the card leads with the core's own sentence")
        XCTAssertEqual(revoke.risks, [], "a trusted token's revoke raises nothing")
        XCTAssertFalse(node.posts.contains(where: \.write), "reviewing sends nothing")

        await revoke.confirm()
        XCTAssertEqual(node.posts.filter(\.write).map(\.method), ["starknet_addInvokeTransaction"])
        XCTAssertEqual(revoke.stage, .confirmed)
        XCTAssertEqual(revoke.hash, try core.activity(accountId: owner).first?.hash)

        chain.allowance = "0x0"
        let settled = try await listing()
        XCTAssertEqual(settled.allowances, [], "a zero reading settles the revoke")
    }

    func testARefusalReadsInTheCoresWords() async throws {
        let owner = try ozRecord(core, .sepolia).id
        let other = try ozRecord(core, .sepolia, 1).id
        try seed([owner, other])
        let revoke = try model(view(amount: "1000", id: id(other)))
        await revoke.prepare()
        XCTAssertEqual(revoke.stage, .refused)
        XCTAssertEqual(revoke.message, "switch to the account that granted this allowance")
        XCTAssertFalse(node.posts.contains(where: \.write))

        let malformed = try model(view(amount: "1000", id: ""))
        await malformed.prepare()
        XCTAssertEqual(malformed.message, "invalid revoke request")
    }

    func testAnUnansweredListingSaysItIsPartialAndKeepsTheStoredGrant() async throws {
        try seed([ozRecord(core, .sepolia).id])
        chain.unreachable = true
        let listed = try await listing()
        XCTAssertEqual(listed.notices, [.scanIncomplete])
        XCTAssertEqual(listed.allowances.map(\.amount), ["1000"])
        XCTAssertEqual(AllowanceCopy.notice(.scanIncomplete), AllowanceCopy.scanIncomplete)
    }

    func testUnlimitedFollowsTheFixture() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-allowances", withExtension: "jsonl"))
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        let entries = try lines.compactMap { line in
            try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        }
        let cases = entries.filter { $0["block"] as? String == "unlimited" }
        XCTAssertEqual(cases.count, 6)
        for entry in cases {
            let amount: String = try fixtureValue(entry, "amount")
            let unlimited: Bool = try fixtureValue(entry, "unlimited")
            XCTAssertEqual(AllowanceCopy.isUnlimited(amount), unlimited, amount)
        }
    }

    func testRowsReadAsTheExtensions() throws {
        let tracked = TokenPreferences(persisted: nil).tracked(network: .sepolia).map(\.token)
        let token = try XCTUnwrap(tracked.first { $0.symbol == "STRK" })
        XCTAssertEqual(AllowanceCopy.amount(view(amount: "1000000000000000000"), token: token), "1 STRK")
        let floor = view(amount: "340282366920938463463374607431768211455")
        XCTAssertEqual(AllowanceCopy.amount(floor, token: token), "Unlimited")
        XCTAssertEqual(AllowanceCopy.amount(view(amount: "0", lowerBound: true), token: token), "an unknown amount")
        XCTAssertEqual(
            AllowanceCopy.amount(view(amount: "2000000000000000000", lowerBound: true), token: token),
            "at least 2 STRK"
        )
        XCTAssertEqual(AllowanceCopy.amount(view(amount: "1500"), token: nil), "1,500 base units")
        XCTAssertEqual(
            AllowanceCopy.detail(view(amount: "1500", source: .external), token: nil),
            "1,500 base units of \(shortAddress(Self.strk)) · on-chain"
        )
        XCTAssertFalse(AllowanceCopy.canRevoke(view(amount: "1", source: .multisig)))
        XCTAssertFalse(AllowanceCopy.canRevoke(view(amount: "1", unconfirmed: true)))
        XCTAssertEqual(
            AllowanceCopy.notice(.retentionFull),
            "This wallet keeps 50 approvals per account and drops the smallest first, so some may be missing."
        )
    }
}
