import BrambleCore
import SwiftUI

/// The wallet frame from `wallet-shell.ts` / `styles-dock.ts`: persistent account header, the
/// active dock screen, and the floating dock. Flow screens push over it without the dock.
struct WalletShell: View {
    enum Flow: Hashable {
        case receive, network, appearance, security, reveal, remove, send, deploy, accounts
        /// Send, opened on one token (its address) from that token's screen.
        case sendToken(String)
        case coordination(CoordinationFlow)
        case tokens, addToken, discoverTokens
        case token(String)
        case privacy
    }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var flows: [Flow] = []
    @State private var accountsOpen = false

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $flows) {
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                    WalletHeader { accountsOpen = true }
                    switch store.tab {
                    case .home:
                        HomeView(
                            receive: { flows.append(.receive) },
                            open: { flows.append($0) },
                            send: { openSend(.send) },
                            privacy: { flows.append(.privacy) }
                        )

                    case .activity:
                        ActivityScreen()

                    case .settings:
                        SettingsHubView { flows.append($0) }
                    }
                }
                .padding(BrambleMetrics.Screen.shellPadding)
                // `.screen:not(.flow)`: clear the floating dock's footprint.
                .padding(.bottom, BrambleMetrics.Dock.height + BrambleSpace.lg)
            }
            .refreshable {
                await store.refreshBalances()
                if store.tab == .activity { await store.portfolio.refreshActivity(force: true) }
            }
            .background(skin.bg.ignoresSafeArea())
            .overlay(alignment: .bottom) { Dock(tab: $store.tab).padding(.bottom, BrambleMetrics.Dock.offset) }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Flow.self) { flow in
                destination(flow)
                    .toolbar(.hidden, for: .navigationBar)
                    .background(skin.bg.ignoresSafeArea())
                    // The hidden bar disables UIKit's interactive pop; restore the back swipe.
                    .edgeSwipeBack(enabled: flow != .reveal && !store.busy) { if !flows.isEmpty { flows.removeLast() } }
            }
        }
        .brambleHaptic(.selection, trigger: store.activeRecord?.id)
        .environment(\.openCoordinationFlow, CoordinationNavigator { flows.append(.coordination($0)) })
        .sheet(isPresented: $accountsOpen) {
            SkinProvider {
                AccountsSheet(
                    openManage: { flows.append(.accounts) },
                    openMultisig: { flows.append(.coordination(.readyMultisig)) }
                )
            }
            .environment(store)
        }
    }

    /// Opens a Send journey.
    private func openSend(_ flow: Flow) {
        flows.append(flow)
    }

    /// The screen each pushed flow shows.
    private func destination(_ flow: Flow) -> some View {
        Group {
            switch flow {
            case .receive:
                ReceiveView()

            case .network:
                NetworkView()

            case .appearance:
                AppearanceView()

            case .security:
                SecurityView()

            case .reveal:
                RevealSecretsView()

            case .remove:
                RemoveWalletView()

            case .send:
                SendFlowView { flows.append(.tokens) }

            case let .sendToken(address):
                SendFlowView(token: address) { flows.append(.tokens) }

            case .deploy:
                DeployAccountView()

            case .accounts:
                AccountsManageView()

            case .coordination(let coordinationFlow):
                CoordinationDestination(flow: coordinationFlow)

            case .tokens:
                TokensView { flows.append($0) }

            case .addToken:
                AddTokenView()

            case .discoverTokens:
                DiscoverTokensView()

            case let .token(id):
                TokenDetailView(
                    tokenId: id,
                    send: { openSend(.sendToken($0)) },
                    journey: { flows.append(.privacy) }
                )

            case .privacy:
                PrivacyJourneyView { flows.append(.network) }
            }
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
        let header = BrambleMetrics.WalletHeader.self
        let name = store.activeRecord?.displayName ?? ""
        HStack(spacing: header.gap) {
            Button(action: openAccounts) {
                HStack(spacing: header.triggerGap) {
                    AccountAvatarView(address: store.activeRecord?.address ?? "0x0")
                    VStack(alignment: .leading, spacing: header.accountGap) {
                        HStack(spacing: header.nameGap) {
                            // The core's display name: the user's label, else the friendly nickname.
                            Text(name)
                                .brambleText(BrambleTypeScale.body.sized(header.nameSize), weight: header.nameWeight)
                                .lineLimit(1)
                            BrambleIcon(.chevronDown, size: header.chevron).foregroundStyle(skin.muted)
                        }
                        HStack(spacing: header.netGap) {
                            StatusDot(
                                healthy: store.networkHealthy && store.portfolio.issue == nil,
                                size: header.netDot
                            )
                            Text(store.networkLabel)
                                .brambleText(BrambleTypeScale.caption.sized(header.netSize))
                                .foregroundStyle(skin.muted)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityValue(privacyStatusText)
                    }
                }
                .padding(header.triggerPadding)
            }
            .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Capsule(), scale: 1))
            .accessibilityLabel("Accounts")
            // `aria-describedby="network-status-detail"`: the header's data-freshness copy.
            .accessibilityValue("\(name), \(store.networkLabel)\(networkDetail)")
            .accessibilityHint("Opens the account list")
            Spacer(minLength: 0)
            HStack(spacing: BrambleMetrics.HeaderActions.gap) {
                IconButton(
                    icon: .externalLink,
                    label: "Open in explorer",
                    hint: "Opens this account in the block explorer",
                    tint: skin.muted
                ) { openExplorer() }
                IconButton(icon: .lock, label: "Lock wallet", tint: skin.muted) { store.lock() }
            }
        }
        .padding(header.padding)
    }

    /// The data-freshness suffix of the header's spoken value: the portfolio issue, else a
    /// degraded-network note, else nothing.
    private var networkDetail: String {
        store.portfolio.issue.map { ", \($0)" } ?? (store.networkHealthy ? "" : ", network degraded")
    }

    /// `privacyDataIssue`, spoken with the network status (the extension shows it in the header).
    private var privacyStatusText: String {
        switch store.privacyHeaderStatus {
        case .current:
            ""

        case .refreshing:
            PrivacyCopy.statusRefreshing

        case .unavailable:
            PrivacyCopy.statusUnavailable
        }
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
        let dock = BrambleMetrics.Dock.self
        HStack(spacing: dock.gap) {
            item(.home, .home, "Home")
            item(.activity, .activity, "Activity")
            item(.settings, .settings, "Settings")
        }
        .padding(dock.padding)
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
        .buttonStyle(
            FillPressStyle(
                fill: selected ? skin.accentSoft : .clear,
                pressed: skin.softPress,
                shape: Circle(),
                scale: BramblePress.navItem
            )
        )
        .animation(
            BrambleMotionPolicy.animation(
                BrambleEase.standard.animation(ms: BrambleMotion.tabMs),
                reduceMotion: reduceMotion
            ),
            value: selected
        )
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
