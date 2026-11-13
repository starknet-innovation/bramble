import BrambleCore
import SwiftUI

/// The asset picker, as a sheet over the details (the platform idiom for the extension's token
/// dropdown, `tokenDropdown` in `send-views.ts`): "Tokens you can send", one "Your tokens" group
/// of the network's tokens (glyph and symbol, the chosen one checked), and "Manage tokens" under
/// the list. A handful of held tokens is faster to read than to search, so there is no field.
struct SendAssetSheet: View {
    @Environment(\.skin) private var skin
    let tokens: [TokenInfo]
    /// The address of the token the journey is on.
    let selected: String
    let choose: (TokenInfo) -> Void
    let manageTokens: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            HStack(spacing: BrambleSpace.sm) {
                Text(SendCopy.tokensYouCanSend)
                    .brambleText(
                        BrambleTypeScale.title.sized(BrambleMetrics.H2.size),
                        weight: BrambleMetrics.H2.weight,
                        tracking: BrambleMetrics.H2.tracking
                    )
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                IconButton(icon: .x, label: "Close \(SendCopy.tokensYouCanSend)", tint: skin.text, action: close)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                    SettingsSection(title: SendCopy.yourTokens) {
                        ForEach(tokens, id: \.address) { token in option(token) }
                    }
                    MenuGroup {
                        MenuRow(icon: .coins, title: SendCopy.manageTokens, action: manageTokens)
                    }
                }
            }
        }
    }

    /// `.token-dropdown-option`: the token's glyph and symbol; the chosen one on accent-soft.
    private func option(_ token: TokenInfo) -> some View {
        let row = BrambleMetrics.MenuRow.self
        let glyph = BrambleMetrics.Send.tokenTriggerGlyph
        let chosen = token.address == selected
        return Button { choose(token) } label: {
            HStack(spacing: row.gap) {
                TokenMark(address: token.address, symbol: token.symbol)
                    .scaleEffect(glyph / BrambleMetrics.TokenRow.markSize)
                    .frame(width: glyph, height: glyph)
                Text(token.symbol).brambleText(BrambleTypeScale.body.sized(row.titleSize), weight: row.titleWeight)
                Spacer(minLength: row.gap)
                if chosen { BrambleIcon(.check).foregroundStyle(skin.accent) }
            }
            .padding(row.padding)
            .frame(minHeight: row.height)
        }
        .buttonStyle(
            FillPressStyle(
                fill: chosen ? skin.accentSoft : .clear,
                pressed: skin.softPress,
                shape: RoundedRectangle(cornerRadius: row.radius, style: .continuous),
                scale: 1
            )
        )
        .accessibilityLabel(token.symbol)
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    }
}
