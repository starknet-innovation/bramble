import BrambleCore
import SwiftUI

/// `homeView()` from `portfolio/home-view.ts`: hero total, the four major actions, the token list.
/// Mobile has no price source yet, so the total and fiat column read "—", exactly the side
/// panel's prices-unavailable state; token amounts still show under each symbol. When no endpoint
/// answers, the list becomes the extension's `.panel-error` with a retry.
struct HomeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var retrying = false
    let receive: () -> Void
    var send: () -> Void = {}
    var deploy: () -> Void = {}

    var body: some View {
        let hero = BrambleMetrics.Hero.self
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            Placeholder(
                style: BrambleTypeStyle(size: hero.totalSize, lineHeight: hero.totalLineHeight),
                weight: hero.totalWeight,
                accessibilityText: "Portfolio total unavailable"
            )
            .tracking(hero.totalSize * hero.totalTracking)
            .frame(maxWidth: .infinity)
            .padding(hero.padding)
            DeployNoticeView(receive: receive, deploy: deploy)
            HStack(spacing: BrambleMetrics.ActionRow.gap) {
                ActionTile(title: "Send", icon: .send, action: send).disabled(store.account == nil)
                ActionTile(title: "Swap", icon: .shuffle) {}.disabled(true)
                ActionTile(title: "Receive", icon: .qrCode, action: receive)
                ActionTile(title: "Shield", icon: .shield) {}.disabled(true)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Tokens")
                        .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.HomeTab.fontSize), weight: BrambleMetrics.HomeTab.weight)
                        .frame(minHeight: BrambleMetrics.HomeTab.height)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    BrambleIcon(.moreHorizontal).foregroundStyle(skin.muted)
                        .frame(width: BrambleMetrics.IconButton.size, height: BrambleMetrics.IconButton.size)
                        .accessibilityHidden(true)
                }
                if store.networkHealthy {
                    VStack(spacing: 0) {
                        ForEach(Array(store.networkInfo.tokens.enumerated()), id: \.element.address) { offset, token in
                            TokenRow(token: token, amount: store.amount(of: token))
                                .overlay(alignment: .top) {
                                    if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
                                }
                        }
                    }
                } else {
                    ErrorPanel(message: "RPC endpoints unavailable", retryHint: "Retry loading balances", busy: retrying) {
                        Task {
                            retrying = true
                            await store.refreshBalances()
                            retrying = false
                        }
                    }
                    .padding(.top, BrambleSpace.sm)
                }
            }
        }
    }
}

/// `.action-tile`: accent-soft ground, 22.5pt icon over a caption label.
struct ActionTile: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    let icon: BrambleIconName
    let action: () -> Void

    var body: some View {
        let m = BrambleMetrics.ActionTile.self
        Button(action: action) {
            VStack(spacing: m.gap) {
                BrambleIcon(icon, size: BrambleControl.majorIcon)
                Text(title).brambleText(BrambleTypeScale.body, weight: BrambleMetrics.Button.weight, tracking: BrambleMetrics.Button.tracking)
            }
            .foregroundStyle(skin.accent)
            .padding(m.padding)
            .frame(maxWidth: .infinity, minHeight: m.height)
        }
        .buttonStyle(FillPressStyle(fill: skin.accentSoft, pressed: skin.actionTilePress, shape: RoundedRectangle(cornerRadius: m.radius, style: .continuous), scale: BramblePress.actionTile))
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(title)
        .accessibilityHint(enabled ? "" : "Not available on mobile yet")
    }
}

/// `.token-row`: logo, symbol over amount, fiat value on the right.
struct TokenRow: View {
    @Environment(\.skin) private var skin
    let token: TokenInfo
    let amount: String?

    var body: some View {
        let m = BrambleMetrics.TokenRow.self
        HStack(spacing: m.gap) {
            TokenMark(address: token.address, symbol: token.symbol)
            VStack(alignment: .leading, spacing: m.copyGap) {
                Text(token.symbol).brambleText(BrambleTypeScale.body.sized(m.symbolSize), weight: m.symbolWeight)
                Text(amount ?? "…").brambleText(BrambleTypeScale.caption.sized(m.amountSize)).monospacedDigit().foregroundStyle(skin.muted)
            }
            Spacer(minLength: m.gap)
            Text("—").brambleText(BrambleTypeScale.body, weight: m.valueWeight).monospacedDigit()
        }
        .padding(m.padding)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(token.symbol), \(amount ?? "loading"), value unavailable")
    }
}

/// Activity dock screen: the transactions this wallet submitted (the core's local records), or the
/// side panel's empty copy. Mobile does not index on-chain history yet.
struct ActivityView: View {
    @Environment(WalletStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            Text("Activity")
                .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.H2.size), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                .accessibilityAddTraits(.isHeader)
            LocalActivityRows()
            if store.activity.isEmpty {
                EmptyState(message: "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.")
            }
        }
    }
}
