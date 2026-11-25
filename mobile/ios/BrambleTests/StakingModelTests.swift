@testable import Bramble
import BrambleCore
import XCTest

/// Staking (M21) through the app's models over the real core, replaying the extension's own
/// staking wire (`extension-staking.jsonl`) on an offline node: the core's policy gates the
/// network, the directory and a validator's pools read as the extension's, an action reaches the
/// review with the core's sentence and nothing is broadcast, and a refusal is the core's sentence.
@MainActor
final class StakingModelTests: XCTestCase {
    /// The fixture's `now`, pinned so the unlock time and the position's state are the extension's.
    private static let now: UInt64 = 1_800_000_000
    private var unlocked: WalletCore?

    private var core: WalletCore {
        get throws { try XCTUnwrap(unlocked) }
    }

    override func setUp() async throws {
        unlocked = try unlockedCore()
    }

    override func tearDown() {
        unlocked = nil
    }

    private func mainnet() throws -> NetworkInfo {
        try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet })
    }

    private func model(_ node: StakingFixtureNode, network: NetworkInfo? = nil) throws -> StakingModel {
        let wallet = try core
        let net = try network ?? mainnet()
        return try StakingModel(
            core: wallet,
            network: net,
            accountId: ozRecord(wallet, net.network).id,
            tokens: TokenPreferences(persisted: nil),
            transport: node
        ) { Self.now }
    }

    func testSepoliaIsTheCoresRefusalAndReadsNothing() async throws {
        let node = try StakingFixtureNode(case: "notMember", block: "overview", account: "0x0")
        let staking = try model(node, network: sepolia())
        await staking.load()
        XCTAssertEqual(staking.unavailable, "Staking isn't available on this network.")
        XCTAssertNil(StakingModel.refusal(on: .mainnet))
        XCTAssertEqual(node.requests, 0)
    }

    func testTheDirectoryListsStarkscansValidatorsInItsOrder() async throws {
        let node = try StakingFixtureNode(case: "ready.full", block: "directory", account: "0x0")
        let staking = try model(node)
        await staking.loadDirectory(cursor: nil)
        guard case let .loaded(listed) = staking.directory else {
            XCTFail("directory \(staking.directory)")
            return
        }
        XCTAssertEqual(listed.entries.first?.name, "Validator One")
        XCTAssertEqual(listed.nextCursor, "cursor-2")
        let first = try XCTUnwrap(listed.entries.first)
        XCTAssertEqual(StakingText.figuresLine(first), "Commission 5% · 30-day uptime 99.5%")
        XCTAssertEqual(StakingText.figuresLine(listed.entries[1]), "Commission unknown · 30-day uptime unknown")
    }

    func testAPendingUnstakeReadsItsUtcUnlockTime() async throws {
        let account = try ozRecord(core, .mainnet).address
        let node = try StakingFixtureNode(case: "exitPending", block: "overview", account: account)
        let staking = try model(node)
        await staking.open(staker: node.staker, name: nil)
        guard case let .loaded(view) = staking.pools else {
            XCTFail("pools \(staking.pools)")
            return
        }
        XCTAssertEqual(
            StakingText.exitWindowLine(view.exitWindowSeconds),
            "Unstaking takes 7 days, with no rewards while you wait."
        )
        let row = try XCTUnwrap(view.rows.first)
        XCTAssertEqual(row.figures?.state, .exitPending)
        XCTAssertEqual(StakingText.positionLines(row), ["Unstaking 3 STRK · withdraw from 15 Jan 2027, 08:01 UTC"])
        XCTAssertEqual(StakingText.buttons(row.figures), [.cancelUnstake])
    }

    func testStakeReachesTheCoresReviewAndBroadcastsNothing() async throws {
        let action = try await prepared("stake.enter", .stake, amount: "5")
        XCTAssertEqual(action.model.stage, .review)
        XCTAssertEqual(action.model.sentence, action.node.review)
        XCTAssertEqual(action.model.reviewLine?.hasPrefix("\(action.node.review ?? "-") Maximum network fee: "), true)
        XCTAssertEqual(action.model.confirmLabel?.hasPrefix("Confirm · "), true)
        XCTAssertFalse(action.send.posts.contains(where: \.write))
    }

    func testARefusalIsTheCoresSentenceAndSignsNothing() async throws {
        let action = try await prepared("claim.none", .claim, amount: nil)
        XCTAssertEqual(action.model.stage, .refused)
        XCTAssertEqual(action.model.message, "No rewards to claim.")
        XCTAssertNil(action.model.review)
        XCTAssertTrue(action.send.posts.isEmpty)
    }

    func testARefusalReadsThroughTheFriendlyCopy() {
        XCTAssertEqual(
            StakingText.message(StakingError.Refused(reason: "staking preparation failed")),
            "Couldn't prepare this staking action. Try again."
        )
        XCTAssertEqual(StakingText.message(StakingError.Storage), StakingCopy.readFailed)
    }

    func testTheExitWindowRoundsDownToItsLargestUnit() {
        XCTAssertEqual(StakingText.exitWindow(604_800), "7 days")
        XCTAssertEqual(StakingText.exitWindow(3_600), "1 hour")
        XCTAssertEqual(StakingText.exitWindow(150), "2 minutes")
        XCTAssertEqual(StakingText.exitWindow(59), "59 seconds")
    }

    private struct Prepared {
        let model: StakingActionModel
        let node: StakingFixtureNode
        let send: MockNode
    }

    /// Runs the fixture's action `name` through `StakingActionModel` on the mainnet account.
    private func prepared(_ name: String, _ action: StakingAction, amount: String?) async throws -> Prepared {
        let wallet = try core
        let record = try ozRecord(wallet, .mainnet)
        let node = try StakingFixtureNode(case: name, block: "action", account: record.address)
        let send = MockNode()
        send.chainId = "0x534e5f4d41494e"
        let network = try mainnet()
        let tokens = TokenPreferences(persisted: nil)
        let model = StakingActionModel(
            action: action,
            symbol: "STRK",
            network: network,
            endpoints: PortfolioEndpoints(transport: node),
            transport: send,
            feeBalance: nil,
            clock: { Self.now },
            prepare: {
                try wallet.prepareStaking(
                    accountId: record.id,
                    action: action,
                    staker: node.staker,
                    tokenId: node.tokenId,
                    amount: amount,
                    tokens: tokens
                )
            }
        )
        await model.prepare()
        model.close()
        return Prepared(model: model, node: node, send: send)
    }
}
