import BrambleCore
import SwiftUI
import UniformTypeIdentifiers

/// `activityScreen` from `activity-views.ts`: the Activity dock for the active account and network,
/// fed by the explorer lane or the RPC scan, grouped by UTC day. Export CSV is out of scope, so no
/// control for it is shown. Opening the tab reads history when due; the refresh control forces a
/// read; while visible the feed re-checks every 60 s.
struct ActivityScreen: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.scenePhase) private var phase

    var body: some View {
        let portfolio = store.portfolio
        let view = portfolio.activityView
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            HStack {
                Text("Activity")
                    .brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
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
                EmptyCopy(text: activityEmptyCopy(historyUnavailable: view?.historyUnavailable == true))
                    .accessibilityIdentifier("activity-empty")
            } else {
                ForEach(Array(portfolio.groups.enumerated()), id: \.offset) { index, group in
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
        .task(id: portfolio.scope?.accountId) {
            await portfolio.refreshActivity(force: false)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled, phase == .active else { continue }
                await portfolio.refreshActivity(force: false)
            }
        }
    }
}

/// `transactionRow`: the kind glyph beside the verb (a link to the explorer in the system
/// browser), the detail line with its copy control, the status word when unsettled, the signed
/// fiat over the amount, and the trailing token mark.
struct ActivityRowView: View {
    @Environment(\.skin) private var skin
    @Environment(\.openURL) private var openURL
    let row: ActivityRow

    var body: some View {
        HStack(spacing: BrambleSpace.sm) {
            VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                title
                detail
                if let word = row.statusWord {
                    Text(word)
                        .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.medium, tracking: BrambleTracking.caption)
                        .foregroundStyle(tone)
                        .lineLimit(1)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: BrambleSpace.xs) {
                Text(row.fiatText ?? "—")
                    .brambleText(BrambleTypeScale.row, weight: row.fiatText == nil ? BrambleWeight.regular : BrambleWeight.medium)
                    .foregroundStyle(row.fiatText == nil ? skin.muted : skin.text)
                Text(row.amountText ?? "—")
                    .brambleText(BrambleTypeScale.body)
                    .foregroundStyle(skin.muted)
            }
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize(horizontal: false, vertical: true)
            TokenGlyphView(glyph: row.avatar, size: BrambleSize.avatar)
        }
        .padding(.vertical, BrambleSpace.sm)
        .padding(.horizontal, BrambleSpace.lg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity-row-\(row.hash)")
    }

    private var tone: Color {
        switch row.tone {
        case .settled: skin.muted
        case .pending: skin.warning
        case .preconfirmed: skin.positive
        case .failed: skin.danger
        }
    }

    private var glyph: some View {
        BrambleIcon(BrambleIconName(rawValue: "Icons/\(row.icon)") ?? .layoutGrid, size: 16)
            .foregroundStyle(row.tone == .settled ? skin.text.opacity(0.27) : tone)
            .background { if row.tone == .settled { BrambleIcon(BrambleIconName(rawValue: "Icons/\(row.icon)") ?? .layoutGrid, size: 16).foregroundStyle(skin.muted) } }
            .opacity(row.tone == .preconfirmed ? 0.68 : 1)
            .accessibilityLabel(row.glyphLabel)
            .help(row.statusHint ?? row.glyphLabel)
    }

    @ViewBuilder private var title: some View {
        HStack(spacing: BrambleSpace.xs) {
            glyph
            if let link = row.explorerUrl.flatMap(URL.init(string:)) {
                Button { openURL(link) } label: {
                    Text(row.title).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium).foregroundStyle(skin.text).lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(row.accessibilityLabel)
                .accessibilityValue(link.absoluteString)
                .accessibilityIdentifier("activity-link-\(row.hash)")
            } else {
                Text(row.title)
                    .brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium)
                    .lineLimit(1)
                    .accessibilityLabel(row.accessibilityLabel)
            }
        }
    }

    @ViewBuilder private var detail: some View {
        if let detail = row.detail {
            HStack(spacing: 2) {
                Text(detail).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted).lineLimit(1)
                if let address = row.counterparty, let label = row.copyLabel {
                    IconButton(icon: .copy, label: label, tint: skin.muted) {
                        UIPasteboard.general.setItems(
                            [[UTType.plainText.identifier: address]],
                            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
                        )
                    }
                    .frame(width: 28, height: 28)
                }
            }
        }
    }
}
