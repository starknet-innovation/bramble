import SwiftUI

/// `homeView()` from `portfolio/home-view.ts`: hero total, the deploy notice, the four major
/// actions, and the token list (`PortfolioHeroView`, `PortfolioTokens`: prices, tracked tokens,
/// balances and their states all from the core, read once through the portfolio store).
struct HomeView: View {
    @Environment(WalletStore.self) private var store
    let receive: () -> Void
    let open: (WalletShell.Flow) -> Void
    var send: () -> Void = { /* No action unless the shell wires the send flow. */ }
    var deploy: () -> Void = { /* No action unless the shell wires deployment. */ }
    var privacy: () -> Void = { /* No action unless the shell wires the privacy journey. */ }

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            PortfolioHeroView()
            ShieldedHeroLabel()
            DeployNoticeView(receive: receive, deploy: deploy)
            HStack(spacing: BrambleMetrics.ActionRow.gap) {
                ActionTile(title: "Send", icon: .send, action: send).disabled(store.account == nil)
                ActionTile(title: "Swap", icon: .shuffle) {
                    // No action: swapping is not available on mobile yet, and the tile is disabled.
                }
                .disabled(true)
                ActionTile(title: "Receive", icon: .qrCode, action: receive)
                ShieldActionTile(receive: receive, journey: privacy)
            }
            PortfolioTokens(open: open)
        }
    }
}

/// `.action-tile`: accent-soft ground, 22.5pt icon over a caption label.
struct ActionTile: View {
    /// Opacity of a tile whose action is not available.
    private static let disabledOpacity: Double = 0.4

    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    let icon: BrambleIconName
    let action: () -> Void

    var body: some View {
        let tile = BrambleMetrics.ActionTile.self
        Button(action: action) {
            VStack(spacing: tile.gap) {
                BrambleIcon(icon, size: BrambleControl.majorIcon)
                Text(title)
                    .brambleText(
                        BrambleTypeScale.body,
                        weight: BrambleMetrics.Button.weight,
                        tracking: BrambleMetrics.Button.tracking
                    )
            }
            .foregroundStyle(skin.accent)
            .padding(tile.padding)
            .frame(maxWidth: .infinity, minHeight: tile.height)
        }
        .buttonStyle(
            FillPressStyle(
                fill: skin.accentSoft,
                pressed: skin.actionTilePress,
                shape: RoundedRectangle(cornerRadius: tile.radius, style: .continuous),
                scale: BramblePress.actionTile
            )
        )
        .opacity(enabled ? 1 : Self.disabledOpacity)
        .accessibilityLabel(title)
        .accessibilityHint(enabled ? "" : "Not available on mobile yet")
    }
}
