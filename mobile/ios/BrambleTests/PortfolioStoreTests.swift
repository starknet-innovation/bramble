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
        let (status, body) = PortfolioStubResponder.respond(scenario: scenario, url: url, body: request.body.map { Data($0.utf8) })
        return status == 0 ? .unanswered : HttpOutcome(status: UInt16(status), retryAfter: nil, body: body, timedOut: false)
    }
}

@MainActor
final class PortfolioStoreTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func network(_ id: NetworkId) -> NetworkInfo {
        supportedNetworks().first { $0.network == id }!
    }

    private func account(_ id: NetworkId) -> AccountInfo {
        AccountInfo(index: 0, address: PortfolioStubResponder.account, publicKey: "0x1", classHash: "0x1", network: id)
    }

    private func store(_ scenario: String, transport: StubTransport? = nil, now: Double = 1_790_251_200_000) -> PortfolioStore {
        PortfolioStore(files: PortfolioFiles(directory: directory), transport: transport ?? StubTransport(scenario: scenario), clock: { now })
    }

    func testHeroRowsAndCurrencySwitch() async {
        let store = store("ready")
        await store.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(store.hero.totalText, "$1,242.25")
        XCTAssertEqual(store.hero.delta?.windowText.hasSuffix("% · 24h"), true)
        XCTAssertEqual(store.home?.visible.first?.token.symbol, "STRK", "STRK first")
        XCTAssertEqual(store.home?.notShown, 0)
        XCTAssertNil(store.issue)
        await store.setCurrency(.eur)
        XCTAssertEqual(store.hero.totalText?.first, "€")
        XCTAssertEqual(store.priceView?.prices.count, 2, "a currency switch never blanks a priced row")
    }

    func testSepoliaServesCachedMainnetPricesAndNeverFetches() async {
        let transport = StubTransport(scenario: "ready")
        let store = store("ready", transport: transport)
        await store.load(account: account(.mainnet), network: network(.mainnet))
        let before = transport.requested.filter { $0.contains("coingecko") }.count
        await store.load(account: account(.sepolia), network: network(.sepolia))
        XCTAssertEqual(transport.requested.filter { $0.contains("coingecko") }.count, before, "off mainnet never fetches")
        XCTAssertEqual(store.priceView?.stale, false)
        XCTAssertNil(store.priceView?.asOfMs)
        XCTAssertNotNil(store.hero.totalText, "Sepolia STRK/ETH share mainnet addresses")
    }

    func testDegradedStoriesUseTheExtensionCopy() async {
        let offline = PortfolioStore(files: PortfolioFiles(directory: directory.appendingPathComponent("o")), transport: StubTransport(scenario: "prices-offline"))
        await offline.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(offline.issue, "Live prices are temporarily unavailable.")
        XCTAssertNil(offline.hero.totalText)

        let failed = PortfolioStore(files: PortfolioFiles(directory: directory.appendingPathComponent("b")), transport: StubTransport(scenario: "balance-error"))
        await failed.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(failed.balances, .failed(balanceFailureCopy(transport: true)))
        XCTAssertTrue(failed.issue?.hasPrefix("Balances are temporarily unavailable.") == true)

        let saved = PortfolioStore(files: PortfolioFiles(directory: directory.appendingPathComponent("s")), transport: StubTransport(scenario: "saved-data"))
        await saved.load(account: account(.mainnet), network: network(.mainnet))
        await saved.refresh(force: true)
        guard case let .loaded(view) = saved.balances else { return XCTFail("saved balances stay") }
        XCTAssertTrue(view.stale)
        XCTAssertTrue(saved.issue?.hasPrefix("Using saved balances (") == true, saved.issue ?? "nil")
    }

    func testHideShowPersistsAndCountsNotShown() async {
        let first = store("ready")
        await first.load(account: account(.mainnet), network: network(.mainnet))
        let strk = first.tracked.first { $0.token.symbol == "STRK" }!.token
        let hidden = await first.setHidden(strk.id, hidden: true)
        XCTAssertTrue(hidden)
        XCTAssertEqual(first.home?.notShown, 1)
        let second = store("ready")
        await second.load(account: account(.mainnet), network: network(.mainnet))
        XCTAssertEqual(second.home?.notShown, 1, "hidden ids persist in preferences.json")
        let refused = await second.setHidden("", hidden: true)
        XCTAssertFalse(refused)
    }

    func testAddAndDiscoverTokens() async {
        let store = store("ready")
        await store.load(account: account(.mainnet), network: network(.mainnet))
        let invalid = await store.addToken("hello")
        XCTAssertEqual(invalid, "invalid add token request")
        let added = await store.addToken("0xABC")
        XCTAssertNil(added)
        XCTAssertTrue(store.tracked.contains { $0.token.symbol == "TST" && $0.token.name == "Test Token" })
        let found = await store.discoverTokens()
        XCTAssertEqual(try found.get().map(\.token.symbol), ["USDC"])
    }

    func testFailsOverToTheNextEndpoint() async {
        let first = network(.mainnet).rpcUrls[0]
        let store = store("ready", transport: StubTransport(scenario: "ready", deadHost: first))
        await store.load(account: account(.mainnet), network: network(.mainnet))
        guard case .loaded = store.balances else { return XCTFail("the second endpoint answers") }
        await store.refreshActivity(force: true)
        XCTAssertEqual(store.activityView?.historyUnavailable, false)
    }

    func testLateResultsAfterLockAreDropped() async {
        let store = store("ready", transport: StubTransport(scenario: "ready", delayMs: 150))
        let load = Task { await store.load(account: account(.mainnet), network: network(.mainnet)) }
        try? await Task.sleep(for: .milliseconds(50))
        store.lock()
        await load.value
        XCTAssertEqual(store.balances, .loading)
        XCTAssertNil(store.scope)
        XCTAssertNil(store.hero.totalText)
    }

    func testLateChartAndDiscoveryAfterDeleteAreDropped() async {
        let store = store("ready", transport: StubTransport(scenario: "ready", delayMs: 150))
        await store.load(account: account(.mainnet), network: network(.mainnet))
        guard let strk = store.tracked.first(where: { $0.token.symbol == "STRK" })?.token else {
            return XCTFail("STRK is tracked by default")
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

    func testActivityFromTheExplorerAndUnavailableHistory() async {
        let store = store("ready")
        await store.load(account: account(.mainnet), network: network(.mainnet))
        await store.refreshActivity(force: false)
        let rows = store.groups.flatMap(\.rows)
        XCTAssertEqual(rows.map(\.title), ["Received", "Sent"])
        XCTAssertEqual(rows.first?.explorerUrl, "https://starkscan.co/tx/0xabc1")
        XCTAssertEqual(rows.first?.fiatText, "+$0.75")
        XCTAssertEqual(rows.first?.copyLabel, "Copy sender address")

        let down = PortfolioStore(files: PortfolioFiles(directory: directory.appendingPathComponent("d")), transport: StubTransport(scenario: "history-unavailable"))
        await down.load(account: account(.mainnet), network: network(.mainnet))
        await down.refreshActivity(force: true)
        XCTAssertEqual(down.activityView?.historyUnavailable, true)
        XCTAssertEqual(activityEmptyCopy(historyUnavailable: true), "No transactions recorded on this device yet.")
    }

    func testFilesAreProtectedAndRemovedWithTheWallet() async throws {
        let store = store("ready")
        await store.load(account: account(.mainnet), network: network(.mainnet))
        let prices = PortfolioFiles(directory: directory).url(.prices)
        let values = try prices.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
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
