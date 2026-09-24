import BrambleCore
import SwiftUI

/// Wallet home, mirroring `portfolio/home-view.ts`: account header, hero amount, action row,
/// token list. Send is shown disabled until transaction review lands in the core.
struct HomeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var sheet: Sheet?

    enum Sheet: String, Identifiable {
        case receive, settings, accounts
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.xl) {
                header
                hero
                HStack(spacing: BrambleSpace.sm) {
                    ActionTile(title: "Send", systemImage: "paperplane") {}.disabled(true)
                    ActionTile(title: "Receive", systemImage: "qrcode") { sheet = .receive }
                    ActionTile(title: "Explorer", systemImage: "arrow.up.right.square") { openExplorer() }
                }
                tokens
            }
            .padding(BrambleSpace.lg)
        }
        .refreshable { await store.refreshBalances() }
        .background(skin.bg.ignoresSafeArea())
        .sheet(item: $sheet) { sheet in
            SkinProvider {
                switch sheet {
                case .receive: ReceiveView()
                case .settings: SettingsView()
                case .accounts: AccountsView()
                }
            }
            .environment(store)
        }
    }

    private var header: some View {
        HStack(spacing: BrambleSpace.md) {
            Button { sheet = .accounts } label: {
                HStack(spacing: BrambleSpace.sm) {
                    AccountAvatar(index: store.account?.index ?? 0)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Account \((store.account?.index ?? 0) + 1)")
                            .brambleText(BrambleTypeScale.title, weight: BrambleWeight.semibold, tracking: BrambleTracking.title)
                            .foregroundStyle(skin.text)
                            .lineLimit(1)
                            .fixedSize()
                        Text(shortAddress(store.account?.address ?? ""))
                            .brambleText(BrambleTypeScale.mono, mono: true)
                            .foregroundStyle(skin.muted)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(skin.muted)
                }
            }
            .buttonStyle(PressStyle())
            Spacer()
            Text(store.network == .mainnet ? "Mainnet" : "Sepolia")
                .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                .lineLimit(1)
                .padding(.horizontal, BrambleSpace.sm)
                .frame(height: BrambleSize.pill)
                .foregroundStyle(skin.muted)
                .background(skin.elevated, in: Capsule())
            Button { sheet = .settings } label: {
                Image(systemName: "gearshape").font(.system(size: BrambleControl.icon, weight: .medium))
                    .frame(width: BrambleControl.hit, height: BrambleControl.hit)
                    .foregroundStyle(skin.text)
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Text(amount("STRK") ?? "—")
                .brambleText(BrambleTypeScale.portfolio, weight: BrambleWeight.heavy, tracking: BrambleTracking.amount)
                .monospacedDigit()
                .foregroundStyle(skin.text)
                .contentTransition(.numericText())
            Text("STRK").brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium).foregroundStyle(skin.muted)
            ErrorText(message: store.balanceError)
        }
    }

    private var tokens: some View {
        Card {
            Text("Tokens").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold, tracking: BrambleTracking.label).foregroundStyle(skin.muted)
            ForEach(Array(store.networkInfo.tokens.enumerated()), id: \.element.address) { offset, token in
                if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1) }
                HStack(spacing: BrambleSpace.md) {
                    Text(token.symbol.prefix(1))
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                        .frame(width: BrambleSize.avatar, height: BrambleSize.avatar)
                        .foregroundStyle(skin.text)
                        .background(skin.sunken, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(token.symbol).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold).foregroundStyle(skin.text)
                        Text(token.name).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    }
                    Spacer()
                    Text(amount(token.symbol) ?? "—")
                        .brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                        .monospacedDigit()
                        .foregroundStyle(skin.text)
                }
                .frame(minHeight: BrambleSize.rowCompact)
            }
        }
    }

    private func amount(_ symbol: String) -> String? {
        guard let raw = store.balances[symbol],
              let token = store.networkInfo.tokens.first(where: { $0.symbol == symbol }) else { return nil }
        return try? formatTokenAmount(raw: raw, decimals: token.decimals, maxFraction: 4)
    }

    private func openExplorer() {
        guard let address = store.account?.address,
              let link = explorerAccountUrl(network: store.network, address: address),
              let url = URL(string: link) else { return }
        UIApplication.shared.open(url)
    }
}

/// Account switcher sheet.
struct AccountsView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        @Bindable var store = store
        Screen(title: "Accounts") {
            Card {
                ForEach(store.accounts, id: \.index) { account in
                    Button {
                        store.selectedAccount = account.index
                        Task { await store.refreshBalances() }
                        dismiss()
                    } label: {
                        HStack(spacing: BrambleSpace.md) {
                            AccountAvatar(index: account.index)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Account \(account.index + 1)").brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold).foregroundStyle(skin.text)
                                Text(shortAddress(account.address)).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted)
                            }
                            Spacer()
                            if account.index == store.account?.index {
                                Image(systemName: "checkmark").foregroundStyle(skin.accent)
                            }
                        }
                        .frame(minHeight: BrambleSize.rowCompact)
                    }
                    .buttonStyle(PressStyle())
                }
            }
            ErrorText(message: error)
            SecondaryButton(title: "Add account") {
                Task {
                    do { try await store.addAccount(); dismiss() } catch { self.error = describe(error) }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
