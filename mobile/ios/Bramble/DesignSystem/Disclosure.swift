import SwiftUI

// `details.disclosure` and the checkbox glyph, shared by the account screens (Find your accounts and
// its candidate rows, Receive's wallet identity). Both are flat, as the menu list is:
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
                    VStack(alignment: .leading, spacing: DisclosureLayout.summaryGap) {
                        Text(title)
                            .brambleText(BrambleTypeScale.body.sized(row.titleSize), weight: row.titleWeight)
                            .foregroundStyle(skin.text)
                        if let summary {
                            Text(summary)
                                .brambleText(BrambleTypeScale.caption.sized(row.valueSize))
                                .foregroundStyle(skin.muted)
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

/// `Disclosure` is generic, so its fixed metrics live outside it.
private enum DisclosureLayout {
    /// Gap between the header title and its summary line.
    static let summaryGap: CGFloat = 2
}

/// `input[type=checkbox]` in the accent colour, at the generated checkbox size.
struct CheckBox: View {
    @Environment(\.skin) private var skin
    let isOn: Bool

    private static let cornerRadius: CGFloat = 4
    private static let borderWidth: CGFloat = 1.5
    private static let checkGlyph: CGFloat = 13

    var body: some View {
        let size = BrambleMetrics.Checkbox.size
        let box = RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
        box
            .fill(isOn ? skin.accent : Color.clear)
            .overlay(box.stroke(isOn ? skin.accent : skin.border, lineWidth: Self.borderWidth))
            .overlay { if isOn { BrambleIcon(.check, size: Self.checkGlyph).foregroundStyle(skin.accentText) } }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
