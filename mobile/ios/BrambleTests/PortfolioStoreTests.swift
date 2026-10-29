@testable import Bramble
import BrambleCore
import XCTest

/// A transport answering from the debug fixture network, optionally slowed or with the first
/// endpoint dead, so the store's sequencing, failover and generation guard can be exercised.
final class StubTransport: PortfolioTransport, @unchecked Sendable {
    let scenario: String
    let delayMs: Int
    let deadHost: String?
    private let lock = NSLock()
    private var urls: [String] = []

    init(scenario: String, delayMs: Int = 0, deadHost: String? = nil) {
        self.scenario = scenario
        self.delayMs = delayMs
        self.deadHost = deadHost
    }

    var requested: [String] {
        lock.lock()
        defer { lock.unlock() }
        return urls
    }

    func perform(_ request: HttpRequest) async -> HttpOutcome {
        lock.lock()
        urls.append(request.url)
        lock.unlock()
        if delayMs > 0 { try? await Task.sleep(for: .milliseconds(delayMs)) }
        let url = URL(string: request.url)
        if let deadHost, url?.absoluteString.hasPrefix(deadHost) == true { return .unanswered }
        let (status, body) = PortfolioStubResponder.respond(
            scenario: scenario,
            url: url,
            body: request.body.map { Data($0.utf8) }
        )
        return status == 0
            ? .unanswered
            : HttpOutcome(status: UInt16(status), retryAfter: nil, body: body, timedOut: false)
    }
}

@MainActor
final class PortfolioStoreTests: XCTestCase {
    private var directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func network(_ id: NetworkId) throws -> NetworkInfo {
        try XCTUnwrap(supportedNetworks().first { $0.network == id })
    }

    /// The core's one activity log for a store's directory (a scratch core beside its caches).
    private func book(_ files: PortfolioFiles) throws -> ActivityBook {
        let dataDir = files.directory.appendingPathComponent("core").path
        return try WalletCore(dataDir: dataDir, clock: DeviceClock()).activityBook()
    }

    private func account(_ id: NetworkId) throws -> AccountRecord {
        let address = PortfolioStubResponder.account
        return AccountRecord(
            id: try activityAccountId(network: id, address: address),
            network: id,
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
            active: true
        )
    }

    private func store(
        _ scenario: String,
        transport: StubTransport? = nil,
        now: Double = 1_790_251_200_000
    ) throws -> PortfolioStore {
        PortfolioStore(
            activity: try book(PortfolioFiles(directory: directory)),
            files: PortfolioFiles(directory: directory),
            transport: transport ?? StubTransport(scenario: scenario)
        ) { now }
    }

    /// A store in its own subdirectory, on the store's default clock.
    private func store(_ scenario: String, in subdirectory: String) throws -> PortfolioStore {
        PortfolioStore(
            activity: try book(PortfolioFiles(directory: directory.appendingPathComponent(subdirectory))),
            files: PortfolioFiles(directory: directory.appendingPathComponent(subdirectory)),
            transport: StubTransport(scenario: scenario)
        )
    }

    func testHeroRowsAndCurrencySwitch() async throws {
        let store = try store("ready")
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(store.hero.totalText, "$1,242.25")
        XCTAssertEqual(store.hero.delta?.windowText.hasSuffix("% · 24h"), true)
        XCTAssertEqual(store.home?.visible.first?.token.symbol, "STRK", "STRK first")
        XCTAssertEqual(store.home?.notShown, 0)
        XCTAssertNil(store.issue)
        await store.setCurrency(.eur)
        XCTAssertEqual(store.hero.totalText?.first, "€")
        XCTAssertEqual(store.priceView?.prices.count, 2, "a currency switch never blanks a priced row")
    }

    func testSepoliaServesCachedMainnetPricesAndNeverFetches() async throws {
        let transport = StubTransport(scenario: "ready")
        let store = try store("ready", transport: transport)
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        let before = transport.requested.filter { $0.contains("coingecko") }.count
        try await store.load(account: account(.sepolia), network: network(.sepolia))
        let after = transport.requested.filter { $0.contains("coingecko") }.count
        XCTAssertEqual(after, before, "off mainnet never fetches")
        XCTAssertEqual(store.priceView?.stale, false)
        XCTAssertNil(store.priceView?.asOfMs)
        XCTAssertNotNil(store.hero.totalText, "Sepolia STRK/ETH share mainnet addresses")
    }

    func testDegradedStoriesUseTheExtensionCopy() async throws {
        let offline = try store("prices-offline", in: "o")
        try await offline.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(offline.issue, "Live prices are temporarily unavailable.")
        XCTAssertNil(offline.hero.totalText)

        let failed = try store("balance-error", in: "b")
        try await failed.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(failed.balances, .failed(balanceFailureCopy(transport: true)))
        XCTAssertEqual(failed.issue?.hasPrefix("Balances are temporarily unavailable."), true)

        let saved = try store("saved-data", in: "s")
        try await saved.load(account: account(.mainnet), network: network(.mainnet))
        await saved.refresh(force: true)
        guard case let .loaded(view) = saved.balances else {
            XCTFail("saved balances stay")
            return
        }
        XCTAssertTrue(view.stale)
        XCTAssertEqual(saved.issue?.hasPrefix("Using saved balances ("), true, saved.issue ?? "nil")
    }

    func testHideShowPersistsAndCountsNotShown() async throws {
        let first = try store("ready")
        try await first.load(account: account(.mainnet), network: network(.mainnet))
        let strk = try XCTUnwrap(first.tracked.first { $0.token.symbol == "STRK" }).token
        let hidden = first.setHidden(strk.id, hidden: true)
        XCTAssertTrue(hidden)
        XCTAssertEqual(first.home?.notShown, 1)
        let second = try store("ready")
        try await second.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(second.home?.notShown, 1, "hidden ids persist in preferences.json")
        let refused = second.setHidden("", hidden: true)
        XCTAssertFalse(refused)
    }

    func testAddAndDiscoverTokens() async throws {
        let store = try store("ready")
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        let invalid = await store.addToken("hello")
        XCTAssertEqual(invalid, "invalid add token request")
        let added = await store.addToken("0xABC")
        XCTAssertNil(added)
        XCTAssertTrue(store.tracked.contains { $0.token.symbol == "TST" && $0.token.name == "Test Token" })
        let found = await store.discoverTokens()
        XCTAssertEqual(try found.get().map(\.token.symbol), ["USDC"])
    }

    func testFailsOverToTheNextEndpoint() async throws {
        let first = try network(.mainnet).rpcUrls[0]
        let store = try store("ready", transport: StubTransport(scenario: "ready", deadHost: first))
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        guard case .loaded = store.balances else {
            XCTFail("the second endpoint answers")
            return
        }
        await store.refreshActivity(force: true)
        XCTAssertEqual(store.activityView?.historyUnavailable, false)
    }

    func testLateResultsAfterLockAreDropped() async throws {
        let store = try store("ready", transport: StubTransport(scenario: "ready", delayMs: 150))
        let load = Task { try await store.load(account: account(.mainnet), network: network(.mainnet)) }
        try? await Task.sleep(for: .milliseconds(50))
        store.lock()
        try await load.value
        XCTAssertEqual(store.balances, .loading)
        XCTAssertNil(store.scope)
        XCTAssertNil(store.hero.totalText)
    }

    func testLateChartAndDiscoveryAfterDeleteAreDropped() async throws {
        let store = try store("ready", transport: StubTransport(scenario: "ready", delayMs: 150))
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        guard let strk = store.tracked.first(where: { $0.token.symbol == "STRK" })?.token else {
            XCTFail("STRK is tracked by default")
            return
        }
        let chart = Task { await store.chart(for: strk) }
        let discovery = Task { await store.discoverTokens() }
        try? await Task.sleep(for: .milliseconds(50))
        store.deleteFiles()
        let points = await chart.value
        let found = await discovery.value
        XCTAssertEqual(points, [])
        XCTAssertEqual(try found.get(), [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path), "no cache is rewritten after delete")
    }

    func testActivityFromTheExplorerAndUnavailableHistory() async throws {
        let store = try store("ready")
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        await store.refreshActivity(force: false)
        let rows = store.groups.flatMap(\.rows)
        // The heading joins the verb and the amount; no row carries a fiat figure.
        XCTAssertEqual(rows.map { $0.heading.split(separator: " ").first.map(String.init) }, ["Received", "Sent"])
        XCTAssertEqual(rows.first?.explorerUrl, "https://starkscan.co/tx/0xabc1")
        XCTAssertEqual(rows.first?.hashCopyLabel, "Copy transaction hash")
        XCTAssertEqual(rows.first?.counterparty?.role, "Sender")
        XCTAssertEqual(rows.first?.counterparty?.copyLabel, "Copy sender address")
        XCTAssertEqual(rows.last?.counterparty?.copyLabel, "Copy recipient address")

        let down = try self.store("history-unavailable", in: "d")
        try await down.load(account: account(.mainnet), network: network(.mainnet))
        await down.refreshActivity(force: true)
        XCTAssertEqual(down.activityView?.historyUnavailable, true)
        XCTAssertEqual(activityEmptyCopy(historyUnavailable: true), "No transactions recorded on this device yet.")
    }

    func testFilesAreProtectedAndRemovedWithTheWallet() async throws {
        let store = try store("ready")
        try await store.load(account: account(.mainnet), network: network(.mainnet))
        let prices = PortfolioFiles(directory: directory).url(.prices)
        let values = try prices.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertTrue(values.isExcludedFromBackup ?? false)
        #if !targetEnvironment(simulator)
        // The simulator does not report data protection; a device run checks it.
        let attributes = try FileManager.default.attributesOfItem(atPath: prices.path)
        XCTAssertEqual(attributes[.protectionKey] as? FileProtectionType, .complete)
        #endif
        store.deleteFiles()
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
        XCTAssertEqual(store.currency, .usd)
    }
}
