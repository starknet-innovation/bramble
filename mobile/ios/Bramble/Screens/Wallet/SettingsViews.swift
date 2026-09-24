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
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Text("Settings").brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
            Eyebrow(text: "Accounts & networks")
            MenuGroup {
                MenuRow(icon: .globe, title: "Network", value: store.networkInfo.name) { open(.network) }
            }
            Eyebrow(text: "Preferences")
            MenuGroup {
                MenuRow(icon: .settings, title: "Appearance", value: theme == .light ? "Light" : "Dark") { open(.appearance) }
            }
            Eyebrow(text: "Backup & recovery")
            MenuGroup {
                MenuRow(icon: .lock, title: "Reveal recovery secrets") { open(.reveal) }
            }
            Eyebrow(text: "Security")
            MenuGroup {
                MenuRow(icon: .shield, title: BrambleCopy.securityTitle, value: securityValue) { open(.security) }
                MenuRow(icon: .lockKeyhole, title: "Lock wallet", chevron: false) { store.lock() }
                MenuRow(icon: .alert, title: "Remove wallet from this device", tone: skin.danger) { open(.remove) }
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

/// `network`: the supported networks as an option list, the active one selected.
struct NetworkView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            FlowHeader(title: "Network", subtitle: "Choose where the wallet operates", network: store.networkLabel) { dismiss() }
            MenuGroup {
                ForEach(supportedNetworks(), id: \.chainId) { network in
                    let selected = network.network == store.network
                    Button {
                        Task { await store.switchNetwork(network.network) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(network.name).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium)
                                Text(network.network == .mainnet ? "SN_MAIN" : "SN_SEPOLIA")
                                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold, mono: true)
                                    .foregroundStyle(skin.muted)
                            }
                            Spacer()
                            if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                        }
                        .padding(.horizontal, BrambleSpace.lg)
                        .frame(minHeight: 64)
                    }
                    .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous), scale: 1))
                }
            }
            Text("Switching selects or derives an account on the target network.")
                .brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted)
            Spacer()
        }
        .padding(.horizontal, BrambleSpace.lg)
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
                    PillButton("Hide secrets", kind: .secondary) { words = [] }
                }
            }
            .padding(.horizontal, BrambleSpace.lg)
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
        .padding(.horizontal, BrambleSpace.lg)
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
            Spacer()
        }
        .padding(.horizontal, BrambleSpace.lg)
    }
}
