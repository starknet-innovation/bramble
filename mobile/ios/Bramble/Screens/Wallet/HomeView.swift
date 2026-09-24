import BrambleCore
import SwiftUI

/// `homeView()` from `portfolio/home-view.ts`: hero total, the four major actions, the token list.
/// Mobile has no price source yet, so the total and fiat column read "—", exactly the side
/// panel's prices-unavailable state; token amounts still show under each symbol.
struct HomeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let receive: () -> Void
    var send: () -> Void = {}
    var deploy: () -> Void = {}
    var privacy: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xl) {
            Text("—")
                .brambleText(BrambleTypeScale.portfolio, weight: BrambleWeight.heavy, tracking: BrambleTracking.amount)
                .frame(maxWidth: .infinity)
                .padding(.top, BrambleSpace.md)
                .accessibilityLabel("Portfolio total unavailable")
            ShieldedHeroLabel()
            DeployNoticeView(receive: receive, deploy: deploy)
            HStack(spacing: BrambleSpace.md) {
                ActionTile(title: "Send", icon: .send, action: send).disabled(store.account == nil)
                ActionTile(title: "Swap", icon: .shuffle) {}.disabled(true)
                ActionTile(title: "Receive", icon: .qrCode, action: receive)
                ShieldActionTile(receive: receive, journey: privacy)
            }
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                HStack {
                    Text("Tokens").brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
                    Spacer()
                    BrambleIcon(.moreHorizontal).foregroundStyle(skin.muted).frame(width: BrambleControl.hit, height: BrambleControl.hit)
                }
                VStack(spacing: 0) {
                    let unified = store.unifiedRows
                    if unified.isEmpty {
                        ForEach(Array(store.networkInfo.tokens.enumerated()), id: \.element.address) { offset, token in
                            TokenRow(token: token, amount: store.amount(of: token))
                                .overlay(alignment: .top) {
                                    if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1) }
                                }
                        }
                    } else {
                        // Public and private summed per token (mobile/docs/privacy.md §2.2).
                        ForEach(Array(unified.enumerated()), id: \.element.tokenAddress) { offset, row in
                            UnifiedTokenRow(row: row, receive: receive, journey: privacy)
                                .overlay(alignment: .top) {
                                    if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1) }
                                }
                        }
                    }
                    PrivacyRetryRow()
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
        Button(action: action) {
            VStack(spacing: BrambleSpace.xs) {
                BrambleIcon(icon, size: BrambleControl.majorIcon)
                Text(title).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
            }
            .foregroundStyle(skin.accent)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.actionTile)
        }
        .buttonStyle(FillPressStyle(fill: skin.accentSoft, pressed: skin.accentSoft.opacity(0.8), shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous), scale: 0.97))
        .opacity(enabled ? 1 : 0.4)
    }
}

/// `.token-row`: logo, symbol over amount, fiat value on the right.
struct TokenRow: View {
    @Environment(\.skin) private var skin
    let token: TokenInfo
    let amount: String?

    var body: some View {
        HStack(spacing: BrambleSpace.md) {
            TokenMark(address: token.address, symbol: token.symbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(token.symbol).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                Text(amount ?? "…").brambleText(BrambleTypeScale.body).monospacedDigit().foregroundStyle(skin.muted)
            }
            Spacer()
            Text("—").brambleText(BrambleTypeScale.row, weight: BrambleWeight.bold)
        }
        .padding(.horizontal, BrambleSpace.sm)
        .padding(.vertical, BrambleSpace.md)
        .frame(minHeight: BrambleSize.rowCompact)
    }
}

/// Activity dock screen: mobile keeps no history yet, so it shows the side panel's empty copy.
struct ActivityView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Text("Activity").brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
            LocalActivityRows()
            if store.activity.isEmpty {
                Text("No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.")
                    .brambleText(BrambleTypeScale.label)
                    .foregroundStyle(skin.muted)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, BrambleSpace.lg)
                    .padding(.horizontal, BrambleSpace.md)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}
