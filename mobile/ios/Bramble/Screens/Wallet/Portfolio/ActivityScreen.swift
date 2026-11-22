import BrambleCore
import SwiftUI

/// `activityScreen` from `activity-views.ts`: the Activity dock for the active account and network,
/// fed by the explorer lane or the RPC scan, grouped by UTC day. Above the feed: the search, the
/// filters and the sort (`ActivityFilterBar`), and the counterparty summary while a search resolves
/// one party; Export CSV shares the whole feed. Opening the tab reads history when due; the refresh
/// control forces a read; while visible the feed re-checks every 60 s.
struct ActivityScreen: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.scenePhase) private var phase
    @State private var export: ActivityExport?

    /// Seconds between feed re-checks while the tab is visible.
    private static let pollIntervalSeconds = 60

    var body: some View {
        let portfolio = store.portfolio
        let view = portfolio.activityView
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            header
            if view?.historyUnavailable == true {
                Text(activityUnavailableNotice())
                    .brambleText(BrambleTypeScale.label)
                    .foregroundStyle(skin.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(BrambleSpace.md)
                    .background(skin.elevated, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
                    .accessibilityIdentifier("history-unavailable")
            }
            if portfolio.feed.total == 0 {
                EmptyState(message: activityEmptyCopy(historyUnavailable: view?.historyUnavailable == true))
                    .accessibilityIdentifier("activity-empty")
            } else {
                ActivityFilterBar()
                if let summary = portfolio.feed.summary {
                    ActivityPartySummaryView(parts: summary)
                }
                if portfolio.feed.hasNoMatches {
                    StatusLine(text: "No matching transactions.")
                        .accessibilityIdentifier("activity-no-matches")
                } else {
                    days
                }
                StatusLine(text: portfolio.feed.result)
            }
        }
        // A sheet dismissed without the share controller (a swipe, a lock) still removes the file.
        .sheet(item: $export, onDismiss: PortfolioStore.removeActivityCsvFile) { file in
            ActivityShareSheet(export: file) { completed in
                export = nil
                PortfolioStore.removeActivityCsvFile()
                if completed { store.activityExported() }
            }
        }
        .task(id: store.activityContacts) { portfolio.refilter(contacts: store.activityContacts) }
        .task(id: portfolio.scope?.accountId) { await store.coordination.refresh() }
        .task(id: portfolio.scope?.accountId) {
            await portfolio.refreshActivity(force: false)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.pollIntervalSeconds))
                guard !Task.isCancelled, phase == .active else { continue }
                await portfolio.refreshActivity(force: false)
            }
        }
    }

    /// The title with the refresh control, or a spinner while history loads.
    private var header: some View {
        let portfolio = store.portfolio
        return HStack {
            Text("Activity")
                .brambleText(
                    BrambleTypeScale.title.sized(BrambleMetrics.H2.size),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                .accessibilityLabel("Activity on \(store.networkInfo.name)")
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if portfolio.historyLoading {
                ProgressView().frame(width: BrambleControl.hit, height: BrambleControl.hit)
            } else {
                IconButton(icon: .refresh, label: "Refresh transactions", tint: skin.muted) {
                    Task { await portfolio.refreshActivity(force: true) }
                }
            }
            IconButton(icon: .receive, label: "Export CSV", tint: skin.muted) {
                export = portfolio.activityCsvFile().map(ActivityExport.init(url:))
                if export == nil { store.toast = "Export failed" }
            }
            .disabled(portfolio.activityEntries.isEmpty)
        }
    }

    /// One day's rows, each with the stored entry behind it and an identity of its own.
    ///
    /// A swap's legs share one hash, so the identity is the hash plus what the core tells legs
    /// apart by: token, token contract, counterparty and amount.
    private func legs(of group: ActivityDayGroup, at index: Int) -> [Leg] {
        let all = store.portfolio.groupEntries
        return zip(group.rows, all.indices.contains(index) ? all[index] : []).map { row, entry in
            let leg: [String?] = [entry.hash, entry.token, entry.tokenAddress, entry.counterparty, entry.amount]
            return Leg(id: leg.map { $0 ?? "" }.joined(separator: "\u{0}"), row: row, entry: entry)
        }
    }

    /// The feed grouped by UTC day, each day under its heading.
    private var days: some View {
        ForEach(Array(store.portfolio.groups.enumerated()), id: \.offset) { index, group in
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                // The amount sort's one group is untitled, as the extension lists it.
                if !group.heading.isEmpty {
                    Text(group.heading)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                        .foregroundStyle(skin.muted)
                        .padding(.horizontal, BrambleSpace.lg)
                        .accessibilityAddTraits(.isHeader)
                }
                VStack(spacing: BrambleSpace.xs) {
                    ForEach(legs(of: group, at: index)) { leg in
                        ActivityRowView(row: leg.row, entry: leg.entry)
                    }
                }
            }
            .padding(.top, index == 0 ? 0 : BrambleSpace.lg)
        }
    }
}

/// One activity row with the stored entry behind it.
private struct Leg: Identifiable {
    let id: String
    let row: ActivityRow
    let entry: ActivityEntry
}
