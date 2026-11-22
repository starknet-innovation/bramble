@testable import Bramble
import BrambleCore
import XCTest

/// The Activity screen's wiring of the core's P2 and P10 exports: the expanded row's fee and value
/// when sent, in the extension's order; a send priced at submission from the wallet's price cache;
/// and the feed's filter, sort and counterparty summary through the store.
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

    // MARK: - Filter, summary and export

    private static let eth = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    private static let alice = "0x5a1b"
    private static let bob = "0x6c2d"

    private var directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    /// No wallet here: the explorer lane stays off, so the store reads only the rows a test writes.
    private let denyExplorer: (NetworkId, TokenPreferences) -> Bool = { _, _ in false }

    /// A store on the fixture network, entered on the published Mainnet account, holding `rows`.
    private func store(holding rows: (String) -> [ActivityEntry]) async throws -> PortfolioStore {
        let files = PortfolioFiles(directory: directory)
        let core = try WalletCore(dataDir: directory.appendingPathComponent("core").path, clock: DeviceClock())
        let store = PortfolioStore(
            activity: try core.activityBook(),
            explorerAllowed: denyExplorer,
            files: files,
            transport: StubTransport(scenario: "ready")
        ) { 1_790_251_200_000 }
        let address = PortfolioStubResponder.account
        let account = AccountRecord(
            id: try activityAccountId(network: .mainnet, address: address),
            network: .mainnet,
            family: .openZeppelin,
            classHash: "0x1",
            accountIndex: 0,
            address: address,
            publicKey: "0x1",
            deploymentSalt: nil,
            label: nil,
            displayName: "Account 1",
            shortAddress: accountLabel(address: address),
            typeLabel: nil,
            authorizationShape: "stark-pair",
            groupId: nil,
            active: true,
            hidden: false,
            imported: false,
            preFixReadyKey: false
        )
        let network = try XCTUnwrap(supportedNetworks().first { $0.network == .mainnet })
        await store.load(account: account, network: network)
        store.activityView = store.activity.scanApply(
            accountId: account.id,
            network: .mainnet,
            rows: rows(account.id),
            nowMs: 1_790_251_200_000
        )
        store.recomputeGroups()
        return store
    }

    /// A settled transfer of `amount` `symbol` with `party`, for the account `feed` assigns.
    private func row(
        _ hash: String,
        _ direction: TransferDirection,
        _ amount: String,
        _ symbol: String,
        _ party: String
    ) -> ActivityEntry {
        ActivityEntry(
            accountId: "",
            amount: amount,
            counterparty: party,
            direction: direction,
            failureNotice: nil,
            finalizedOnL1: nil,
            hash: hash,
            kind: .transfer,
            network: .mainnet,
            notFoundCount: nil,
            status: .accepted,
            submittedAt: 1_790_000_000_000,
            summary: "\(direction == .in ? "Received" : "Sent") \(amount) \(symbol)",
            token: symbol,
            tokenAddress: symbol == "ETH" ? Self.eth : Self.strk
        )
    }

    private func feed(_ id: String) -> [ActivityEntry] {
        var pending = row("0xa2", .in, "0.1", "ETH", Self.bob)
        pending.status = .pending
        return [row("0xa1", .out, "1.5", "STRK", Self.alice), pending, row("0xa3", .in, "2", "STRK", Self.alice)]
            .map { entry in
                var owned = entry
                owned.accountId = id
                return owned
            }
    }

    /// The controls offer only what the feed holds; an axis keeps the rows it names; a value the
    /// feed no longer offers resets to all; the amount sort is one untitled list grouped by token,
    /// largest first; a lock resets the filter.
    func testFilterAndSortGoThroughTheCore() async throws {
        let store = try await store(holding: feed)
        XCTAssertEqual(store.feed.options.actions, ["Received", "Sent"])
        XCTAssertEqual(store.feed.options.statuses, [.accepted, .pending])
        XCTAssertNil(store.feed.result)

        var filter = ActivityFeedState.all
        filter.action = "Received"
        store.refilter(filter)
        XCTAssertEqual(store.groupEntries.flatMap(\.self).map(\.hash).sorted(), ["0xa2", "0xa3"])
        XCTAssertEqual(store.feed.result, "2 of 3 transactions")

        filter = ActivityFeedState.all
        filter.status = .rejected
        store.refilter(filter)
        XCTAssertNil(store.feed.filter.status, "a status the feed does not hold resets to all")

        filter = ActivityFeedState.all
        filter.sort = .amount
        store.refilter(filter)
        XCTAssertEqual(store.groups.map(\.heading), [""])
        XCTAssertEqual(store.groupEntries.flatMap(\.self).map(\.hash), ["0xa2", "0xa3", "0xa1"])

        filter = ActivityFeedState.all
        filter.query = "nobody"
        store.refilter(filter)
        XCTAssertTrue(store.feed.hasNoMatches)
        XCTAssertEqual(store.groups.count, 0)

        store.lock()
        XCTAssertEqual(store.feed.filter, ActivityFeedState.all)
    }

    /// A search naming a saved contact summarises that one counterparty; a blank search shows none.
    func testSearchByContactSummarisesTheCounterparty() async throws {
        let store = try await store(holding: feed)
        store.refilter(contacts: [ActivityContact(address: Self.alice, label: "Alice")])
        XCTAssertNil(store.feed.summary)
        var filter = ActivityFeedState.all
        filter.query = "alice"
        store.refilter(filter)
        XCTAssertEqual(store.groupEntries.flatMap(\.self).map(\.hash).sorted(), ["0xa1", "0xa3"])
        let summary = try XCTUnwrap(store.feed.summary)
        XCTAssertEqual(summary.label, "Alice")
        XCTAssertTrue(summary.body.hasPrefix("2 transactions · "), summary.body)
        XCTAssertTrue(summary.body.contains("Sent 1.5 STRK"), summary.body)
        XCTAssertTrue(summary.body.contains("Received 2 STRK"), summary.body)
    }
}
