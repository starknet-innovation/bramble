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

    private func model(_ node: some PortfolioTransport, network: NetworkInfo? = nil) throws -> StakingModel {
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

    /// A stake's check read (wallet-core #131) goes to the bundled endpoints only, never the
    /// person's RPC override, which `NetworkInfo.rpcUrls` lists first.
    func testTheCheckReadSkipsTheRpcOverride() throws {
        var mainnet = try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet })
        let bundled = mainnet.rpcUrls
        mainnet.rpcUrls = ["https://override.invalid"] + bundled
        XCTAssertEqual(StakingCheck.bundled(mainnet)?.rpcUrls, bundled)
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

    func testShowMoreDropsValidatorsAnEarlierPageListed() async throws {
        let pages = try DirectoryPages([
            (Self.page(first: 0, count: 3, cursor: "cursor-2"), false),
            (Self.page(first: 2, count: 3, cursor: "cursor-3"), false)
        ])
        let staking = try model(pages)
        await staking.loadDirectory(cursor: nil)
        await staking.loadDirectory(cursor: "cursor-2")
        let listed = try Self.listed(staking)
        XCTAssertEqual(listed.entries.count, 5)
        XCTAssertEqual(Set(listed.entries.map(\.staker)).count, 5)
        XCTAssertEqual(listed.nextCursor, "cursor-3")
    }

    func testAnIncompleteLaterPageLeavesNothingSelectable() async throws {
        let pages = try DirectoryPages([
            (Self.page(first: 0, count: 3, cursor: "cursor-2"), false),
            (Self.page(first: 3, count: 3, cursor: nil, status: "unavailable"), false)
        ])
        let staking = try model(pages)
        await staking.loadDirectory(cursor: nil)
        await staking.loadDirectory(cursor: "cursor-2")
        let listed = try Self.listed(staking)
        XCTAssertTrue(listed.incomplete)
        XCTAssertTrue(listed.entries.isEmpty)
        XCTAssertNil(listed.nextCursor)
    }

    func testTheListStopsAtTheExtensionsCap() async throws {
        let size = 50
        let pages = try DirectoryPages((0 ..< 11).map { index in
            try (Self.page(first: index * size, count: size, cursor: "cursor-\(index + 2)"), false)
        })
        let staking = try model(pages)
        await staking.loadDirectory(cursor: nil)
        while let cursor = try Self.listed(staking).nextCursor, await pages.served < 11 {
            await staking.loadDirectory(cursor: cursor)
        }
        let listed = try Self.listed(staking)
        XCTAssertEqual(listed.entries.count, StakingCopy.maxListedValidators)
        XCTAssertNil(listed.nextCursor)
        let served = await pages.served
        XCTAssertEqual(served, 10)
    }

    func testOnlyTheNewestDirectoryReadLands() async throws {
        let pages = try DirectoryPages([
            (Self.page(first: 0, count: 1, cursor: nil), true),
            (Self.page(first: 1, count: 2, cursor: nil), false)
        ])
        let staking = try model(pages)
        let slow = Task { await staking.loadDirectory(cursor: nil) }
        await Self.served(pages, 1)
        await staking.loadDirectory(cursor: nil)
        await pages.release()
        await slow.value
        XCTAssertEqual(try Self.listed(staking).entries.count, 2)
    }

    func testShowMoreWhileAPageLoadsIsIgnored() async throws {
        let pages = try DirectoryPages([
            (Self.page(first: 0, count: 2, cursor: "cursor-2"), false),
            (Self.page(first: 2, count: 2, cursor: nil), true),
            (Self.page(first: 4, count: 2, cursor: nil), false)
        ])
        let staking = try model(pages)
        await staking.loadDirectory(cursor: nil)
        let more = Task { await staking.loadDirectory(cursor: "cursor-2") }
        await Self.served(pages, 2)
        XCTAssertTrue(staking.loadingMore)
        await staking.loadDirectory(cursor: "cursor-2")
        await pages.release()
        await more.value
        XCTAssertEqual(try Self.listed(staking).entries.count, 4)
        XCTAssertFalse(staking.loadingMore)
        let served = await pages.served
        XCTAssertEqual(served, 2)
    }

    func testPastingTheZeroAddressOpensNothing() async throws {
        let pages = DirectoryPages([])
        let staking = try model(pages)
        staking.pasteInput = "0x000"
        await staking.openPasted()
        XCTAssertEqual(staking.pasteError, StakingCopy.directoryInvalidAddress)
        XCTAssertNil(staking.validator)
        let served = await pages.served
        XCTAssertEqual(served, 0)
    }

    private static func listed(_ staking: StakingModel) throws -> StakingModel.Directory {
        guard case let .loaded(listed) = staking.directory else {
            return try XCTUnwrap(StakingModel.Directory?.none, "directory \(staking.directory)")
        }
        return listed
    }

    /// Waits (a bounded number of yields) until `pages` has handed out `count` pages.
    private static func served(_ pages: DirectoryPages, _ count: Int) async {
        var tries = 0
        while await pages.served < count, tries < 10_000 {
            tries += 1
            await Task.yield()
        }
        let served = await pages.served
        XCTAssertEqual(served, count)
    }

    /// `ready.full`'s Starkscan page holding `count` copies of its first validator, numbered from
    /// `first` (staker and pool), with `status` as the snapshot's coverage status.
    private static func page(first: Int, count: Int, cursor: String?, status: String? = nil) throws -> String {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-staking", withExtension: "jsonl"))
        let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
        let found = lines.lazy
            .compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            .first { $0["block"] as? String == "directory" && $0["name"] as? String == "ready.full" }
        let exchange = try XCTUnwrap((found?["starkscan"] as? [[String: Any]])?.first)
        let body = try XCTUnwrap((exchange["reply"] as? [String: Any])?["body"] as? String)
        var page = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        let item = try XCTUnwrap((page["items"] as? [[String: Any]])?.first)
        let pool = try XCTUnwrap((item["pools"] as? [[String: Any]])?.first)
        page["items"] = (first ..< first + count).map { index in
            var validator = item
            var own = pool
            own["address"] = String(format: "0x5b%05x", index)
            validator["address"] = String(format: "0x5a%05x", index)
            validator["pools"] = [own]
            return validator
        }
        page["nextCursor"] = cursor ?? NSNull()
        if let status, var coverage = page["coverage"] as? [String: Any] {
            coverage["status"] = status
            page["coverage"] = coverage
        }
        return try String(decoding: JSONSerialization.data(withJSONObject: page), as: UTF8.self)
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

/// Starkscan for the directory tests: hands out `pages` in request order, whatever was asked, and
/// a held page waits for `release()`. Past the last page it answers as an unavailable service.
private actor DirectoryPages: PortfolioTransport {
    private static let statusOK: UInt16 = 200
    private static let unavailable: UInt16 = 503

    private let pages: [(body: String, held: Bool)]
    private var waiting: CheckedContinuation<Void, Never>?
    private(set) var served = 0

    init(_ pages: [(body: String, held: Bool)]) {
        self.pages = pages
    }

    func perform(_: HttpRequest) async -> HttpOutcome {
        guard served < pages.count else {
            return HttpOutcome(status: Self.unavailable, retryAfter: nil, body: nil, timedOut: false)
        }
        let page = pages[served]
        served += 1
        if page.held {
            await withCheckedContinuation { waiting = $0 }
        }
        return HttpOutcome(status: Self.statusOK, retryAfter: nil, body: Data(page.body.utf8), timedOut: false)
    }

    func release() {
        waiting?.resume()
        waiting = nil
    }
}
