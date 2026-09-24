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
            let rows = await scan(scope: scope, tokens: tokens)
            guard generation == self.generation else { return }
            activityView = if let rows {
                activity.scanApply(accountId: scope.accountId, network: net, rows: rows, nowMs: now)
            } else {
                activity.markUnavailable(accountId: scope.accountId, network: net, nowMs: now)
            }
        }
        guard generation == self.generation else { return }
        persist()
        recomputeGroups()
    }

    /// The day groups the Activity screen renders, priced with the active network's view.
    func recomputeGroups() {
        guard let scope, let view = activityView else {
            groups = []
            return
        }
        groups = activityGroups(
            entries: view.entries,
            tracked: preferences.tracked(network: scope.network.network).map(\.token),
            prices: priceView ?? emptyPrices,
            nowMs: clock()
        )
    }

    // The explorer lane: an answering page is authoritative; any failure falls through silently.
    private func starkscan(scope: Scope, tokens: [TokenConfig], now: Double, generation: Int) async -> ActivityView? {
        let net = scope.network.network
        guard let request = activity.starkscanRequest(
            accountId: scope.accountId, network: net, tracked: tokens,
            explorerAllowed: preferences.explorerFallbackAllowed(network: net), nowMs: now
        ) else { return nil }
        let outcome = await transport.perform(request)
        guard generation == self.generation else { return nil }
        return activity.starkscanApply(accountId: scope.accountId, network: net, tracked: tokens, outcome: outcome, nowMs: now)
    }

    // The RPC scan, replayed from the start on the next verified endpoint after a transport
    // failure (`withRpcFallback` around `collectTransactionHistory`); `nil` when every endpoint failed.
    private func scan(scope: Scope, tokens: [TokenConfig]) async -> [ActivityEntry]? {
        guard let history = try? HistoryScan(accountId: scope.accountId, network: scope.network.network, tracked: tokens) else {
            return nil
        }
        let endpoints = endpoints
        return await endpoints.firstAnswer(on: scope.network) { url in
            history.restart()
            while true {
                let calls = history.nextCalls()
                if calls.isEmpty { break }
                for reply in await endpoints.send(calls, to: url) where history.accept(reply: reply) == .transport {
                    return nil
                }
            }
            return try? history.finish()
        }
    }
}
