import BrambleCore
import SwiftUI

/// `activityScreen` from `activity-views.ts`: the Activity dock for the active account and network,
/// fed by the explorer lane or the RPC scan, grouped by UTC day. Export CSV is out of scope, so no
/// control for it is shown. Opening the tab reads history when due; the refresh control forces a
/// read; while visible the feed re-checks every 60 s.
struct ActivityScreen: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.scenePhase) private var phase

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
            if portfolio.groups.isEmpty {
                EmptyState(message: activityEmptyCopy(historyUnavailable: view?.historyUnavailable == true))
                    .accessibilityIdentifier("activity-empty")
            } else {
                days
            }
        }
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
        }
    }

    /// The feed grouped by UTC day, each day under its heading.
    private var days: some View {
        ForEach(Array(store.portfolio.groups.enumerated()), id: \.offset) { index, group in
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                Text(group.heading)
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                    .foregroundStyle(skin.muted)
                    .padding(.horizontal, BrambleSpace.lg)
                    .accessibilityAddTraits(.isHeader)
                VStack(spacing: BrambleSpace.xs) {
                    ForEach(group.rows, id: \.hash) { row in ActivityRowView(row: row) }
                }
            }
            .padding(.top, index == 0 ? 0 : BrambleSpace.lg)
        }
    }
}
