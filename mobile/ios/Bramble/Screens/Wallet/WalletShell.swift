import BrambleCore
import SwiftUI

/// The wallet frame from `wallet-shell.ts` / `styles-dock.ts`: persistent account header, the
/// active dock screen, and the floating dock. Flow screens push over it without the dock.
struct WalletShell: View {
    enum Flow: Hashable { case receive, network, appearance, reveal, remove, coordination(CoordinationFlow) }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var flows: [Flow] = []
    @State private var accountsOpen = false

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $flows) {
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleSpace.lg) {
                    WalletHeader(openAccounts: { accountsOpen = true })
                    switch store.tab {
                    case .home: HomeView(receive: { flows.append(.receive) })
                    case .activity: ActivityView()
                    case .settings: SettingsHubView(open: { flows.append($0) })
                    }
                }
                .padding(.horizontal, BrambleSpace.lg)
                .padding(.bottom, BrambleControl.dockItem + 12 + BrambleSpace.lg + BrambleSpace.lg)
            }
            .refreshable { await store.refreshBalances() }
            .background(skin.bg.ignoresSafeArea())
            .overlay(alignment: .bottom) { Dock(tab: $store.tab).padding(.bottom, BrambleSpace.sm) }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Flow.self) { flow in
                Group {
                    switch flow {
                    case .receive: ReceiveView()
                    case .network: NetworkView()
                    case .appearance: AppearanceView()
                    case .reveal: RevealSecretsView()
                    case .remove: RemoveWalletView()
                    case .coordination(let flow): CoordinationDestination(flow: flow)
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
                .background(skin.bg.ignoresSafeArea())
            }
        }
        .environment(\.openCoordinationFlow, CoordinationNavigator { flows.append(.coordination($0)) })
        .sheet(isPresented: $accountsOpen) {
            SkinProvider { AccountsSheet() }.environment(store)
        }
    }
}

/// `.wallet-header`: avatar, account name with the drawer chevron, network status, actions.
struct WalletHeader: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let openAccounts: () -> Void

    var body: some View {
        HStack(spacing: BrambleSpace.md) {
            Button(action: openAccounts) {
                HStack(spacing: BrambleSpace.md) {
                    AccountAvatarView(address: store.account?.address ?? "0x0")
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text("Account \((store.account?.index ?? 0) + 1)")
                                .brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                                .lineLimit(1)
                            BrambleIcon(.chevronDown, size: 12).foregroundStyle(skin.muted)
                        }
                        HStack(spacing: 6) {
                            Circle().fill(store.networkHealthy ? skin.positive : skin.warning).frame(width: 6, height: 6)
                            Text(store.networkLabel).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Accounts")
            Spacer()
            HStack(spacing: BrambleSpace.xs) {
                IconButton(icon: .externalLink, label: "Open in explorer", tint: skin.muted) { openExplorer() }
                IconButton(icon: .lock, label: "Lock wallet", tint: skin.muted) { store.lock() }
            }
        }
        .padding(.top, BrambleSpace.sm)
    }

    private func openExplorer() {
        guard let address = store.account?.address,
              let link = explorerAccountUrl(network: store.network, address: address),
              let url = URL(string: link) else { return }
        UIApplication.shared.open(url)
    }
}

/// `.wallet-dock`: a floating pill of three 44pt items; the active one sits on accent-soft.
struct Dock: View {
    @Environment(\.skin) private var skin
    @Binding var tab: WalletStore.Tab

    var body: some View {
        HStack(spacing: BrambleSpace.md) {
            item(.home, .home, "Home")
            item(.activity, .activity, "Activity")
            item(.settings, .settings, "Settings")
        }
        .padding(.vertical, 6)
        .padding(.horizontal, BrambleSpace.md)
        .background(skin.panel, in: Capsule())
        .brambleShadow(BrambleShadow.md)
    }

    private func item(_ target: WalletStore.Tab, _ icon: BrambleIconName, _ label: String) -> some View {
        let selected = tab == target
        return Button { tab = target } label: {
            BrambleIcon(icon, size: BrambleControl.dockIcon)
                .foregroundStyle(selected ? skin.accent : skin.muted)
                .frame(width: BrambleControl.dockItem, height: BrambleControl.dockItem)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: Circle(), scale: 0.96))
        .animation(BrambleEase.standard.animation(ms: BrambleMotion.tabMs), value: selected)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
