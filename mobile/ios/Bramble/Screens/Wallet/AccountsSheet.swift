import BrambleCore
import SwiftUI

/// The account drawer (`account-drawer.ts`): title with the network, account rows with the
/// selected one on accent-soft and a check, then "Add account". On a phone the extension's left
/// drawer is a system bottom sheet with medium/large detents (an intentional platform difference);
/// its row metrics are the drawer's.
struct AccountsSheet: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let m = BrambleMetrics.Drawer.self
        VStack(alignment: .leading, spacing: m.gap) {
            HStack(alignment: .center, spacing: BrambleSpace.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Accounts")
                        .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.H2.size), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                        .accessibilityAddTraits(.isHeader)
                    Text(store.networkInfo.name).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                Spacer()
                IconButton(icon: .x, label: "Close", tint: skin.text) { dismiss() }
            }
            ScrollView {
                VStack(spacing: BrambleSpace.xs) {
                    ForEach(store.accounts, id: \.index) { account in
                        row(account, selected: account.index == store.account?.index)
                    }
                }
            }
            PillButton("Add account", kind: .secondary, icon: .plus, busy: store.busy) {
                Task {
                    do {
                        try await store.addAccount()
                        dismiss()
                    } catch { store.toast = describe(error) }
                }
            }
        }
        .padding(m.padding)
        .padding(.top, BrambleSpace.sm)
        .background(skin.panel.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(BrambleRadius.xl)
        .presentationBackground(skin.panel)
    }

    private func row(_ account: AccountInfo, selected: Bool) -> some View {
        let m = BrambleMetrics.Drawer.self
        let name = "Account \(account.index + 1)"
        return Button {
            Task { await store.select(account.index) }
            dismiss()
        } label: {
            HStack(spacing: m.rowGap) {
                AccountAvatarView(address: account.address)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text(shortAddress(account.address))
                        .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
                        .foregroundStyle(skin.muted)
                }
                Spacer()
                if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
            }
            .padding(m.rowPadding)
            .frame(minHeight: m.rowHeight)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: m.rowRadius, style: .continuous), scale: BramblePress.drawerRow))
        .accessibilityLabel("\(name), \(shortAddress(account.address))")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(selected ? "" : "Switches to this account")
    }
}
