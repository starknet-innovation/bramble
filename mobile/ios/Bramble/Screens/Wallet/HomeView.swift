import BrambleCore
import SwiftUI

/// `homeView()` from `portfolio/home-view.ts`: hero total, the deploy notice, the four major
/// actions, and the token list (`PortfolioHeroView`, `PortfolioTokens`: prices, tracked tokens,
/// balances and their states all from the core, read once through the portfolio store).
struct HomeView: View {
    @Environment(WalletStore.self) private var store
    let receive: () -> Void
    let open: (WalletShell.Flow) -> Void
    var send: () -> Void = {}
    var deploy: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            PortfolioHeroView()
            DeployNoticeView(receive: receive, deploy: deploy)
            HStack(spacing: BrambleMetrics.ActionRow.gap) {
                ActionTile(title: "Send", icon: .send, action: send).disabled(store.account == nil)
                ActionTile(title: "Swap", icon: .shuffle) {}.disabled(true)
                ActionTile(title: "Receive", icon: .qrCode, action: receive)
                ActionTile(title: "Shield", icon: .shield) {}.disabled(true)
            }
            PortfolioTokens(open: open)
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
