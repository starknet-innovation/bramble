import SwiftUI

// `details.disclosure` and the checkbox glyph, shared by the account screens (Find your accounts,
// Receive's wallet identity) and the onboarding check rows. Both are flat, as the menu list is:
// the panel fill and the generated menu metrics, no edge and no shadow.

/// `details.disclosure`: a menu-row header (title, optional summary, chevron) over a panel that
/// reveals its content when open. The header reports Expanded/Collapsed to VoiceOver.
struct Disclosure<Content: View>: View {
    @Environment(\.skin) private var skin
    let title: String
    var summary: String?
    @Binding var isOpen: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        let row = BrambleMetrics.MenuRow.self
        let shape = RoundedRectangle(cornerRadius: BrambleMetrics.MenuList.radius, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            Button { isOpen.toggle() } label: {
                HStack(spacing: row.gap) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).brambleText(BrambleTypeScale.body.sized(row.titleSize), weight: row.titleWeight)
                            .foregroundStyle(skin.text)
                        if let summary {
                            Text(summary).brambleText(BrambleTypeScale.caption.sized(row.valueSize)).foregroundStyle(skin.muted)
                        }
                    }
                    Spacer(minLength: row.gap)
                    BrambleIcon(isOpen ? .chevronDown : .chevronRight).foregroundStyle(skin.muted)
                }
                .padding(row.padding)
                .frame(minHeight: row.height)
            }
            .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: shape, scale: 1))
            .accessibilityLabel(title)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            .accessibilityHint(summary ?? "")
            if isOpen {
                VStack(alignment: .leading, spacing: 0) { content() }
                    .padding(row.padding)
            }
        }
        .background(skin.panel, in: shape)
        .clipShape(shape)
    }
}

/// `input[type=checkbox]` in the accent colour, at the generated checkbox size.
struct CheckBox: View {
    @Environment(\.skin) private var skin
    let isOn: Bool

    var body: some View {
        let size = BrambleMetrics.Checkbox.size
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(isOn ? skin.accent : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(isOn ? skin.accent : skin.border, lineWidth: 1.5))
            .overlay { if isOn { BrambleIcon(.check, size: 13).foregroundStyle(skin.accentText) } }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
