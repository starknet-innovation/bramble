import BrambleCore
import Foundation
import Observation

/// Converts `Date`'s seconds to JavaScript's epoch milliseconds.
private let millisecondsPerSecond: Double = 1_000

/// Balance state as Home renders it: the side panel's `BalanceState`.
enum PortfolioBalances: Equatable {
    case loading
    case loaded(BalanceView)
    case failed(String)
}

/// UI state for the portfolio and activity screens over the Rust core's sans-IO objects
/// (`TokenPreferences`, `PriceBook`, `BalanceSnapshots`, `ActivityBook`, `HistoryScan`). The core
/// decides every rule and judges every response; this store only sequences the reads, moves bytes
/// through `PortfolioEndpoints` / `PortfolioTransport`, and writes the documents the core produces.
/// Activity is the exception: the core owns the wallet's one activity log (submitted transactions
/// and on-chain history together), so this store only reads it through `ActivityBook`.
///
/// Every view is keyed by account and network. A result that lands after the scope changed or
/// the wallet locked carries an old `generation` and is dropped, never shown under a new account.
@MainActor
@Observable
final class PortfolioStore {
    struct Scope: Equatable {
        let accountId: String
        let address: String
        let network: NetworkInfo
    }

    private(set) var preferences: TokenPreferences
    private(set) var prices: PriceBook
    private(set) var snapshots: BalanceSnapshots
    let activity: ActivityBook
    let files: PortfolioFiles
    let transport: any PortfolioTransport
    let endpoints: PortfolioEndpoints
    let clock: @Sendable () -> Double

    private(set) var scope: Scope?
    private(set) var balances: PortfolioBalances = .loading
    private(set) var priceView: PriceView?
    private(set) var home: HomeRows?
    /// Home's rows with private value summed in (`unifiedHomeBalances` over `home.visible`); the
    /// public rows unchanged until a registered private reading settles.
    private(set) var unified: [UnifiedBalance] = []
    /// The last private-balance reading for this scope (`PrivacyModel`), fed in by the wallet.
    private(set) var privacyReading: PrivacyReading = .idle
    private(set) var privacyState: PrivacyState?
    private(set) var hero = PortfolioHero(totalText: nil, totalValue: nil, delta: nil)
    private(set) var currency: DisplayCurrency
    private(set) var tracked: [TrackedToken] = []
    var activityView: ActivityView?
    var groups: [ActivityDayGroup] = []
    var historyLoading = false
    /// Bumped on every scope change and on lock; in-flight results compare against it.
    var generation = 0

    init(
        activity: ActivityBook,
        files: PortfolioFiles = .standard(),
        transport: any PortfolioTransport = BoundedHttp.shared,
        // Whole epoch milliseconds, as JavaScript's `Date.now()`: the core's stored timestamps
        // must be safe integers or it refuses to record them.
        clock: @escaping @Sendable () -> Double = {
            (Date().timeIntervalSince1970 * millisecondsPerSecond).rounded(.down)
        }
    ) {
        self.files = files
        self.transport = transport
        self.clock = clock
        endpoints = PortfolioEndpoints(transport: transport)
        let saved = TokenPreferences(persisted: files.read(.preferences))
        preferences = saved
        prices = PriceBook(persisted: files.read(.prices))
        snapshots = BalanceSnapshots(persisted: files.read(.snapshots))
        self.activity = activity
        currency = saved.displayCurrency()
    }

    /// The header pill's description (`networkDataIssue`), `nil` while data is current.
    var issue: String? {
        let health: BalanceHealth = switch balances {
        case .loading:
            .loading

        case let .loaded(view):
            .loaded(stale: view.stale, asOfMs: view.fetchedAtMs)

        case .failed:
            .failed
        }
        return networkDataIssue(balances: health, prices: priceView)
    }

    var emptyPrices: PriceView {
        PriceView(currency: currency, prices: [], changes: [], asOfMs: nil, stale: false)
    }

    /// Enters an account's scope: saved balances, prices and activity at once, then a live read.
    /// The scope is the account record id, which the core builds exactly as `activityAccountId`.
    func load(account: AccountRecord, network: NetworkInfo) async {
        let accountId = account.id
        let next = Scope(accountId: accountId, address: account.address, network: network)
        if scope != next {
            clearView()
            scope = next
        }
        tracked = preferences.tracked(network: network.network)
        let savedBalances = snapshots.plan(
            accountId: accountId,
            network: network.network,
            nowMs: clock(),
            cachedOnly: true,
            force: false
        )
        if case let .serve(view) = savedBalances {
            balances = .loaded(view)
        }
        let savedPrices = prices.plan(
            network: network.network,
            addresses: addresses,
            currency: currency,
            nowMs: clock(),
            cachedOnly: true
        )
        if case let .serve(view) = savedPrices {
            priceView = view
        }
        activityView = activity.cached(accountId: accountId, network: network.network)
        recompute()
        await refresh(force: false)
    }

    /// `cachedBalances` then `getPrices`: a fresh snapshot is served unless `force`; a failed read
    /// keeps the saved balances, marked stale, and only shows an error when nothing was saved.
    func refresh(force: Bool) async {
        guard let scope else { return }
        let started = generation
        let net = scope.network.network
        let plan = snapshots.plan(
            accountId: scope.accountId,
            network: net,
            nowMs: clock(),
            cachedOnly: false,
            force: force
        )
        switch plan {
        case let .serve(view):
            balances = .loaded(view)

        case .empty:
            break

        case .load:
            let tokens = tracked.map(\.token)
            let address = scope.address
            let reader = endpoints
            let outcome: BalanceOutcome? = await reader.firstAnswer(on: scope.network) { url in
                guard let calls = try? balanceRequests(firstId: 1, account: address, tokens: tokens) else {
                    return .failed
                }
                let judged = balanceJudge(firstId: 1, tokens: tokens, replies: await reader.send(calls, to: url))
                if case .transport = judged { return nil }
                return judged
            }
            guard started == generation else { return }
            if case let .balances(rows) = outcome {
                let fresh = snapshots.loaded(accountId: scope.accountId, network: net, balances: rows, nowMs: clock())
                balances = .loaded(fresh)
            } else if let saved = snapshots.failed(accountId: scope.accountId, network: net) {
                balances = .loaded(saved)
            } else {
                balances = .failed(balanceFailureCopy(transport: outcome == nil))
            }
            persist()
        }
        recompute()
        await refreshPrices()
    }

    /// `getPrices` for the tracked tokens on the active network, in the display currency.
    func refreshPrices() async {
        guard let scope else { return }
        let started = generation
        let net = scope.network.network
        let now = clock()
        switch prices.plan(network: net, addresses: addresses, currency: currency, nowMs: now, cachedOnly: false) {
        case let .serve(view):
            priceView = view

        case let .fetch(requests):
            let session = transport
            let outcomes = await withTaskGroup(of: PriceOutcome.self) { group in
                for request in requests {
                    group.addTask {
                        PriceOutcome(address: request.address, outcome: await session.perform(request.request))
                    }
                }
                var collected: [PriceOutcome] = []
                for await outcome in group {
                    collected.append(outcome)
                }
                return collected
            }
            guard started == generation else { return }
            priceView = prices.apply(
                network: net,
                addresses: addresses,
                currency: currency,
                outcomes: outcomes,
                attemptedAtMs: now
            )
            persist()
        }
        recompute()
    }

    /// Switches the display currency (each cached entry holds all three, so rows stay priced).
    func setCurrency(_ next: DisplayCurrency) async {
        preferences.setDisplayCurrency(currency: next)
        currency = next
        persist()
        await refreshPrices()
    }

    /// Ends the session's view state; the public caches stay on disk, as the extension keeps them.
    func lock() {
        clearView()
        scope = nil
    }

    /// Re-reads the scope's activity from the core's log (after the send journey recorded or
    /// settled a transaction).
    func reloadActivity() {
        guard let scope else { return }
        activityView = activity.cached(accountId: scope.accountId, network: scope.network.network)
        recomputeGroups()
    }

    /// Removes every cache (delete wallet; the core removes the activity log itself) and starts
    /// from the extension's defaults.
    func deleteFiles() {
        lock()
        files.removeAll()
        preferences = TokenPreferences(persisted: nil)
        prices = PriceBook(persisted: nil)
        snapshots = BalanceSnapshots(persisted: nil)
        currency = preferences.displayCurrency()
    }

    var addresses: [String] { tracked.map(\.token.address) }

    /// Tokens the user hid from Home, whose private balances Home must not count either.
    var hiddenTokenAddresses: [String] { tracked.filter(\.hiddenFromHome).map(\.token.address) }

    /// Takes the latest private reading and recomputes the unified rows and the hero.
    func setPrivacy(reading: PrivacyReading, state: PrivacyState?) {
        privacyReading = reading
        privacyState = state
        recompute()
    }

    func recompute() {
        if let scope {
            tracked = preferences.tracked(network: scope.network.network)
        }
        let view = priceView ?? emptyPrices
        if case let .loaded(saved) = balances {
            let rows = preferences.homeRows(balances: saved.balances)
            home = rows
            unified = scope.map { active in
                unifiedHomeBalances(
                    network: active.network.network,
                    visible: rows.visible,
                    hiddenTokenAddresses: hiddenTokenAddresses,
                    reading: privacyReading,
                    state: privacyState
                )
            } ?? rows.visible.map { balance in
                UnifiedBalance(
                    balance: balance,
                    publicCompact: portfolioAmount(formatted: balance.formatted),
                    privateOnly: false
                )
            }
            hero = portfolioHero(visible: unified.map(\.balance), prices: view, hasAccount: scope != nil)
        } else {
            home = nil
            unified = []
            hero = portfolioHero(visible: nil, prices: view, hasAccount: scope != nil)
        }
        recomputeGroups()
    }

    func persist() {
        if let text = preferences.persisted() { files.write(.preferences, text) }
        files.write(.prices, prices.persisted())
        files.write(.snapshots, snapshots.persisted())
    }

    private func clearView() {
        generation += 1
        balances = .loading
        priceView = nil
        home = nil
        unified = []
        privacyReading = .idle
        privacyState = nil
        hero = PortfolioHero(totalText: nil, totalValue: nil, delta: nil)
        tracked = []
        activityView = nil
        groups = []
        historyLoading = false
    }
}
