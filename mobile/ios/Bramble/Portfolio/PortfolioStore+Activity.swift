import BrambleCore
import Foundation

/// The Activity feed (`activity-ops.ts handleActivity` over `createExplorerFirstHistory`): the saved
/// log first, then — when a read is due or forced — Starkscan when the explorer lane is permitted,
/// otherwise (or when it fails) the RPC history scan with endpoint failover. History is marked
/// unavailable only when no lane answered.
extension PortfolioStore {
    /// Reads history for the current scope when due; `force` is the Refresh button.
    func refreshActivity(force: Bool) async {
        guard let scope, !historyLoading else { return }
        let generation = generation
        let net = scope.network.network
        let now = clock()
        activityView = activity.cached(accountId: scope.accountId, network: net)
        recomputeGroups()
        guard activity.historyDue(accountId: scope.accountId, network: net, force: force, nowMs: now) else { return }
        historyLoading = true
        defer { if generation == self.generation { historyLoading = false } }
        let tokens = preferences.tracked(network: net).map(\.token)
        if tokens.isEmpty {
            activityView = activity.scanApply(accountId: scope.accountId, network: net, rows: [], nowMs: now)
        } else if let view = await starkscan(scope: scope, tokens: tokens, now: now, generation: generation) {
            activityView = view
        } else {
            guard generation == self.generation else { return }
            let scanned = await scan(scope: scope, tokens: tokens)
            guard generation == self.generation else { return }
            activityView = switch scanned {
            case let .answered(rows):
                activity.scanApply(accountId: scope.accountId, network: net, rows: rows, nowMs: now)

            case .unanswered:
                activity.markUnavailable(accountId: scope.accountId, network: net, nowMs: now)
            }
        }
        guard generation == self.generation else { return }
        persist()
        recomputeGroups()
    }

    /// The day groups the Activity screen renders, and the entry behind each row, under the
    /// current filter and contacts. The tracked tokens resolve each row's token mark and the token
    /// filter; rows carry no fiat figure from today's prices, so prices are not an input.
    func recomputeGroups() {
        refilter()
    }

    /// Rebuilds `feed` under `filter` (by default the one it holds): after a read, or when the
    /// person changes the filter.
    func refilter(_ filter: ActivityFilter? = nil) {
        rebuildFeed(filter: filter ?? feed.filter, contacts: feed.contacts)
    }

    /// Rebuilds `feed` when the names the search resolves changed.
    func refilter(contacts: [ActivityContact]) {
        guard contacts != feed.contacts else { return }
        rebuildFeed(filter: feed.filter, contacts: contacts)
    }

    private func rebuildFeed(filter: ActivityFilter, contacts: [ActivityContact]) {
        feed = ActivityFeedState(
            entries: activityEntries,
            filter: filter,
            tracked: scope.map { preferences.tracked(network: $0.network.network).map(\.token) } ?? [],
            contacts: contacts,
            nowMs: clock()
        )
    }

    /// The scope's whole feed: every row, not the filtered view.
    var activityEntries: [ActivityEntry] { scope == nil ? [] : activityView?.entries ?? [] }

    /// Writes the scope's whole feed (`activityCsv`) to a temporary file named
    /// `activityCsvFileName()` for the share sheet, replacing the last export; nil when there is
    /// nothing to export or the file cannot be written.
    func activityCsvFile() -> URL? {
        let entries = activityEntries
        guard !entries.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(activityCsvFileName())
        do {
            try Data(activityCsv(entries: entries).utf8).write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            return nil
        }
        return url
    }

    // The explorer lane: an answering page is authoritative; any failure falls through silently.
    private func starkscan(scope: Scope, tokens: [TokenConfig], now: Double, generation: Int) async -> ActivityView? {
        let net = scope.network.network
        guard let request = activity.starkscanRequest(
            accountId: scope.accountId,
            network: net,
            tracked: tokens,
            explorerAllowed: explorerAllowed(net, preferences),
            nowMs: now
        ) else { return nil }
        let outcome = await transport.perform(request)
        guard generation == self.generation else { return nil }
        return activity.starkscanApply(
            accountId: scope.accountId,
            network: net,
            tracked: tokens,
            outcome: outcome,
            nowMs: now
        )
    }

    // The RPC scan, replayed from the start on the next verified endpoint after a transport
    // failure (`withRpcFallback` around `collectTransactionHistory`); `.unanswered` when every
    // endpoint failed.
    private func scan(scope: Scope, tokens: [TokenConfig]) async -> HistoryScanOutcome {
        let started = try? HistoryScan(accountId: scope.accountId, network: scope.network.network, tracked: tokens)
        guard let history = started else {
            return .unanswered
        }
        let endpoints = endpoints
        let answered: HistoryScanOutcome? = await endpoints.firstAnswer(on: scope.network) { url in
            history.restart()
            while true {
                let calls = history.nextCalls()
                if calls.isEmpty { break }
                for reply in await endpoints.send(calls, to: url) where history.accept(reply: reply) == .transport {
                    return nil
                }
            }
            guard let rows = try? history.finish() else { return nil }
            return .answered(rows)
        }
        return answered ?? .unanswered
    }
}

/// What the RPC history scan produced: the rows from the first endpoint that answered (possibly
/// none), or no answer from any endpoint, which marks history unavailable.
private enum HistoryScanOutcome: Sendable {
    case answered([ActivityEntry])
    case unanswered
}
