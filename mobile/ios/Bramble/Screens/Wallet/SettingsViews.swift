import BrambleCore
import SwiftUI

/// Settings hub (`settings-ui.ts`): eyebrow-labelled groups of menu rows.
struct SettingsHubView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.default
    let open: (WalletShell.Flow) -> Void

    private var securityValue: String {
        store.security.biometricEnabled
            ? BrambleCopy.securityRowOn.replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)
            : BrambleCopy.securityRowOff
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            Text("Settings")
                .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.H2.size), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                .accessibilityAddTraits(.isHeader)
            SettingsSection(title: "Accounts & networks") {
                MenuRow(icon: .wallet, title: "Accounts & groups") { open(.accounts) }
                MenuRow(icon: .globe, title: "Network", value: store.networkInfo.name) { open(.network) }
                MenuRow(icon: .book, title: "Address book") { open(.coordination(.addressBook)) }
                MenuRow(icon: .users, title: "Shared accounts") { open(.coordination(.sharedAccounts)) }
            }
            SettingsSection(title: "Preferences") {
                MenuRow(icon: .settings, title: "Appearance", value: theme == .light ? "Light" : "Dark") { open(.appearance) }
            }
            SettingsSection(title: "Backup & recovery") {
                MenuRow(icon: .lock, title: "Reveal recovery secrets", hint: "Asks for your passphrase first") { open(.reveal) }
            }
            SettingsSection(title: "Security") {
                MenuRow(icon: .shield, title: BrambleCopy.securityTitle, value: securityValue) { open(.security) }
                MenuRow(icon: .lockKeyhole, title: "Lock wallet", chevron: false) { store.lock() }
                MenuRow(icon: .alert, title: "Remove wallet from this device", tone: skin.danger, hint: "Asks for your passphrase first") { open(.remove) }
            }
            let info = coreInfo()
            Text("Bramble core \(info.coreVersion) · Krusty KMS \(info.krustyVersion)")
                .brambleText(BrambleTypeScale.caption, mono: true)
                .foregroundStyle(skin.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, BrambleSpace.sm)
        }
    }
}

/// `.section`: an eyebrow over one menu group.
struct SettingsSection<Rows: View>: View {
    let title: String
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
            Eyebrow(text: title)
            MenuGroup { rows() }
        }
    }
}

/// `network`: the supported networks as an option list, the active one selected.
struct NetworkView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            FlowHeader(title: "Network", subtitle: "Choose where the wallet operates", network: store.networkLabel) { dismiss() }
            MenuGroup {
                ForEach(supportedNetworks(), id: \.chainId) { network in
                    let selected = network.network == store.network
                    Button {
                        Task { await store.switchNetwork(network.network) }
                    } label: {
                        HStack(spacing: BrambleMetrics.MenuRow.gap) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(network.name).brambleText(BrambleTypeScale.body.sized(BrambleMetrics.MenuRow.titleSize), weight: BrambleMetrics.MenuRow.titleWeight)
                                Text(network.network == .mainnet ? "SN_MAIN" : "SN_SEPOLIA")
                                    .brambleText(BrambleTypeScale.mono, mono: true)
                                    .foregroundStyle(skin.muted)
                            }
                            Spacer()
                            if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                        }
                        .padding(BrambleMetrics.MenuRow.padding)
                        .padding(.vertical, BrambleSpace.md)
                        .frame(minHeight: BrambleMetrics.MenuRow.height)
                    }
                    .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleMetrics.MenuRow.radius, style: .continuous), scale: 1))
                    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                    .accessibilityHint(selected ? "" : "Switches the wallet to \(network.name)")
                }
            }
            Text("Switching selects or derives an account on the target network.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            CoordinationRelayDisclosure()
            Spacer()
        }
        .padding(BrambleMetrics.Screen.shellPadding)
    }
}

/// `reveal-software`: warning, re-entered passphrase, then the words, wiped when the screen goes.
struct RevealSecretsView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var passphrase = ""
    @State private var words: [String] = []
    @State private var captured = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                FlowHeader(title: "Reveal secrets", subtitle: "Recovery phrase", network: store.networkLabel) { dismiss() }
                HStack(alignment: .top, spacing: 6) {
                    BrambleIcon(.alert, size: 20)
                    Text("Anyone who sees these can take your funds.").brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
                }
                .foregroundStyle(skin.danger)
                Text("Reveal only in private. Bramble will never ask you for them. They are shown once here and never leave this screen.")
                    .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                if words.isEmpty {
                    BrambleField(label: "Confirm vault passphrase", placeholder: "", text: $passphrase, secure: true,
                                 hint: "Re-enter it to reveal. An unlocked session alone is not enough.")
                    PillButton("Reveal secrets", icon: .lock, busy: store.busy) {
                        Task {
                            do {
                                words = try await store.revealPhrase(password: passphrase)
                                passphrase = ""
                            } catch { store.toast = describe(error) }
                        }
                    }
                    .disabled(passphrase.isEmpty)
                } else {
                    ProtectedWordGrid(words: words, masked: captured)
                        .accessibilityIdentifier("reveal-grid")
                    PillButton("Hide secrets", kind: .secondary) { words = [] }
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .onDisappear { words = []; passphrase = "" }
        .trackingScreenCapture($captured)
        .warnsOnScreenshot()
    }
}

/// Removing the wallet re-checks the passphrase in the core before the vault is deleted.
struct RemoveWalletView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var passphrase = ""

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            FlowHeader(title: "Remove wallet", subtitle: "From this device only", network: store.networkLabel) { dismiss() }
            Text("Your funds stay on Starknet, but you will need your recovery phrase to restore this wallet.")
                .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            BrambleField(label: "Confirm vault passphrase", placeholder: "", text: $passphrase, secure: true)
            PillButton("Remove wallet", kind: .danger, busy: store.busy) {
                Task {
                    do { try await store.deleteWallet(password: passphrase) } catch { store.toast = describe(error) }
                }
            }
            .disabled(passphrase.isEmpty)
            Spacer()
        }
        .padding(BrambleMetrics.Screen.shellPadding)
    }
}

/// `appearance`: the Dark / Light theme segmented control.
struct AppearanceView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.default

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            FlowHeader(title: "Appearance", subtitle: "How the wallet looks", network: store.networkLabel) { dismiss() }
            Eyebrow(text: "Theme")
            SegmentedControl(options: [("Dark", ThemeChoice.dark), ("Light", ThemeChoice.light)], selection: $theme)
                .accessibilityIdentifier("theme-control")
            Spacer()
        }
        .padding(BrambleMetrics.Screen.shellPadding)
    }
}
