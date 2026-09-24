import BrambleCore
import SwiftUI

/// The account drawer (`account-drawer.ts`): title with the network, account rows with the
/// selected one on accent-soft and a check, then "Add account".
struct AccountsSheet: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.lg) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Accounts").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                    Text(store.networkInfo.name).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                Spacer()
                IconButton(icon: .x, label: "Close", tint: skin.muted) { dismiss() }
            }
            ScrollView {
                VStack(spacing: BrambleSpace.xs) {
                    ForEach(store.accounts, id: \.index) { account in
                        let selected = account.index == store.account?.index
                        Button {
                            Task { await store.select(account.index) }
                            dismiss()
                        } label: {
                            HStack(spacing: BrambleSpace.md) {
                                AccountAvatarView(address: account.address)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Account \(account.index + 1)").brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                                    Text(shortAddress(account.address))
                                        .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold, mono: true)
                                        .foregroundStyle(skin.muted)
                                }
                                Spacer()
                                if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                            }
                            .padding(.horizontal, BrambleSpace.sm)
                            .frame(minHeight: BrambleSize.row)
                        }
                        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous), scale: 1))
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
        .padding(BrambleSpace.xl)
        .background(skin.panel.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(BrambleRadius.xl)
    }
}
