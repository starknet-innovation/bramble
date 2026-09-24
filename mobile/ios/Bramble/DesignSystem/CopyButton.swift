import BrambleCore
import SwiftUI

/// The extension's `[data-copy]` control (`bindCopyButtons` in `dom.ts`): copies the full value,
/// says "Copied" in the section's status line when it has one, otherwise in a success toast, and
/// swaps its glyph to a check for `COPY_CONFIRM_MS`. The confirmation time and the toast lifetimes
/// are design-mobile's generated `BrambleToast` values (read from `dom.ts`), never typed here.
struct CopyButton: View {
    enum Style { case icon, pill(PillKind), receipt }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let value: String
    /// Accessibility label, e.g. "Copy address"; the visible title for the pill style.
    let label: String
    var style: Style = .icon
    /// The section's `[role=status]` line, when it has one.
    var status: Binding<String?>?
    @State private var confirmed = false

    var body: some View {
        switch style {
        case .icon:
            IconButton(icon: confirmed ? .check : .copy, label: label, tint: confirmed ? skin.positive : skin.muted, action: copy)
        case .pill(let kind):
            PillButton(label, kind: kind, icon: confirmed ? .check : .copy, action: copy)
        case .receipt:
            Button(action: copy) {
                HStack(spacing: 6) {
                    BrambleIcon(confirmed ? .check : .copy, size: 16)
                    Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                }
                .foregroundStyle(confirmed ? skin.positive : skin.accent)
                .frame(minHeight: BrambleControl.hit)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }

    private func copy() {
        guard !value.isEmpty else { return }
        Clipboard.copy(value)
        if let status {
            status.wrappedValue = "Copied"
        } else {
            store.notify("Copied")
        }
        confirmed = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(BrambleToast.copyConfirmMs))
            confirmed = false
        }
    }
}
