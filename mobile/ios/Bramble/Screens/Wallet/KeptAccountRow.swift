import SwiftUI

/// Metrics of `KeptAccountRow` (a generic view cannot hold static stored constants).
private enum KeptAccountRowLayout {
    /// Vertical gap between the title and detail lines.
    static let lineSpacing: CGFloat = 2
}

/// One account line Manage lists but does not select (hidden and kept accounts): avatar, a title,
/// a muted detail, and an optional trailing control.
struct KeptAccountRow<Trailing: View>: View {
    @Environment(\.skin) private var skin
    let address: String
    let title: String
    let detail: String
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        let row = BrambleMetrics.MenuRow.self
        HStack(spacing: BrambleMetrics.Drawer.rowGap) {
            AccountAvatarView(address: address)
            VStack(alignment: .leading, spacing: KeptAccountRowLayout.lineSpacing) {
                Text(title)
                    .brambleText(BrambleTypeScale.body.sized(row.titleSize), weight: row.titleWeight)
                    .lineLimit(1)
                Text(detail)
                    .brambleText(BrambleTypeScale.caption.sized(row.valueSize))
                    .foregroundStyle(skin.muted)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            trailing()
        }
        .padding(row.padding)
        .frame(minHeight: BrambleMetrics.Drawer.rowHeight)
    }
}
