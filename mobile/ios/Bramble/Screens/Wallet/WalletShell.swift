import BrambleCore
import SwiftUI

/// The wallet frame from `wallet-shell.ts` / `styles-dock.ts`: persistent account header, the
/// active dock screen, and the floating dock. Flow screens push over it without the dock.
struct WalletShell: View {
    enum Flow: Hashable { case receive, network, appearance, security, reveal, remove, send, deploy, accounts }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var flows: [Flow] = []
    @State private var accountsOpen = false

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $flows) {
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                    WalletHeader(openAccounts: { accountsOpen = true })
                    switch store.tab {
                    case .home: HomeView(receive: { flows.append(.receive) }, send: {
                        // Ready and Braavos accounts are refused by the core; say why up front.
                        if let refusal = store.sendRefusal { store.toast = refusal } else { flows.append(.send) }
                    }, deploy: { flows.append(.deploy) })
                    case .activity: ActivityView()
                    case .settings: SettingsHubView(open: { flows.append($0) })
                    }
                }
                .padding(BrambleMetrics.Screen.shellPadding)
                // `.screen:not(.flow)`: clear the floating dock's footprint.
                .padding(.bottom, BrambleMetrics.Dock.height + BrambleSpace.lg)
            }
            .refreshable { await store.refreshBalances() }
            .background(skin.bg.ignoresSafeArea())
            .overlay(alignment: .bottom) { Dock(tab: $store.tab).padding(.bottom, BrambleMetrics.Dock.offset) }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Flow.self) { flow in
                Group {
                    switch flow {
                    case .receive: ReceiveView()
                    case .network: NetworkView()
                    case .appearance: AppearanceView()
                    case .security: SecurityView()
                    case .reveal: RevealSecretsView()
                    case .remove: RemoveWalletView()
                    case .send: SendFlowView()
                    case .deploy: DeployAccountView()
                    case .accounts: AccountsManageView()
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
                .background(skin.bg.ignoresSafeArea())
                // The hidden bar disables UIKit's interactive pop; restore the back swipe.
                .edgeSwipeBack(enabled: flow != .reveal && !store.busy) { if !flows.isEmpty { flows.removeLast() } }
            }
        }
        .brambleHaptic(.selection, trigger: store.activeRecord?.id)
        .sheet(isPresented: $accountsOpen) {
            SkinProvider { AccountsSheet(openManage: { flows.append(.accounts) }) }.environment(store)
        }
    }
}

/// `.wallet-header`: avatar, account name with the drawer chevron, network status, actions. The
/// extension's Connected sites button is absent: mobile has no dApp connections (recorded as an
/// intentional difference).
struct WalletHeader: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let openAccounts: () -> Void

    var body: some View {
        let m = BrambleMetrics.WalletHeader.self
        let name = store.activeRecord?.displayName ?? ""
        HStack(spacing: m.gap) {
            Button(action: openAccounts) {
                HStack(spacing: m.triggerGap) {
                    AccountAvatarView(address: store.activeRecord?.address ?? "0x0")
                    VStack(alignment: .leading, spacing: m.accountGap) {
                        HStack(spacing: m.nameGap) {
                            // The core's display name: the user's label, else the friendly nickname.
                            Text(name)
                                .brambleText(BrambleTypeScale.body.sized(m.nameSize), weight: m.nameWeight)
                                .lineLimit(1)
                            BrambleIcon(.chevronDown, size: m.chevron).foregroundStyle(skin.muted)
                        }
                        HStack(spacing: m.netGap) {
                            StatusDot(healthy: store.networkHealthy, size: m.netDot)
                            Text(store.networkLabel).brambleText(BrambleTypeScale.caption.sized(m.netSize)).foregroundStyle(skin.muted)
                        }
                    }
                }
                .padding(m.triggerPadding)
            }
            .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Capsule(), scale: 1))
            .accessibilityLabel("Accounts")
            .accessibilityValue("\(name), \(store.networkLabel)\(store.networkHealthy ? "" : ", network degraded")")
            .accessibilityHint("Opens the account list")
            Spacer(minLength: 0)
            HStack(spacing: BrambleMetrics.HeaderActions.gap) {
                IconButton(icon: .externalLink, label: "Open in explorer", hint: "Opens this account in the block explorer", tint: skin.muted) { openExplorer() }
                IconButton(icon: .lock, label: "Lock wallet", tint: skin.muted) { store.lock() }
            }
        }
        .padding(m.padding)
    }

    private func openExplorer() {
        guard let address = store.account?.address,
              let link = explorerAccountUrl(network: store.network, address: address),
              let url = URL(string: link) else { return }
        UIApplication.shared.open(url)
    }
}

/// `.wallet-dock`: a floating pill of 44pt items with the md elevation; the active one sits on
/// accent-soft.
struct Dock: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var tab: WalletStore.Tab

    var body: some View {
        let m = BrambleMetrics.Dock.self
        HStack(spacing: m.gap) {
            item(.home, .home, "Home")
            item(.activity, .activity, "Activity")
            item(.settings, .settings, "Settings")
        }
        .padding(m.padding)
        .background(skin.panel, in: Capsule())
        .elevation(BrambleElevation.dock)
        // Chrome stops growing at accessibility sizes; content does not (design-mobile.md 4.2).
        .dynamicTypeSize(...DynamicTypeSize.accessibility3)
        .brambleHaptic(.selection, trigger: tab)
    }

    private func item(_ target: WalletStore.Tab, _ icon: BrambleIconName, _ label: String) -> some View {
        let selected = tab == target
        let size = BrambleMetrics.Dock.item
        return Button { tab = target } label: {
            BrambleIcon(icon, size: BrambleControl.dockIcon)
                .foregroundStyle(selected ? skin.accent : skin.muted)
                .frame(width: size, height: size)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: Circle(), scale: BramblePress.navItem))
        .animation(BrambleMotionPolicy.animation(BrambleEase.standard.animation(ms: BrambleMotion.tabMs), reduceMotion: reduceMotion), value: selected)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
