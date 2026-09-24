import BrambleCore
import SwiftUI

/// Settings: network, lock, phrase reveal, wallet removal, and build info.
struct SettingsView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var passwordPrompt: PasswordAction?
    @State private var revealed: [String] = []

    enum PasswordAction: String, Identifiable {
        case reveal, delete
        var id: String { rawValue }
    }

    var body: some View {
        Screen(title: "Settings") {
            Card {
                Text("Network").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
                Picker("Network", selection: Binding(get: { store.network }, set: { next in Task { await store.switchNetwork(next) } })) {
                    Text("Mainnet").tag(NetworkId.mainnet)
                    Text("Sepolia").tag(NetworkId.sepolia)
                }
                .pickerStyle(.segmented)
            }
            Card {
                Text("Security").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
                SecondaryButton(title: "Lock now") { store.lock(); dismiss() }
                SecondaryButton(title: "Show recovery phrase") { passwordPrompt = .reveal }
                if !revealed.isEmpty {
                    PhraseGrid(words: revealed)
                    SecondaryButton(title: "Hide phrase") { revealed = [] }
                }
                SecondaryButton(title: "Remove wallet from this device", role: .destructive) { passwordPrompt = .delete }
            }
            let info = coreInfo()
            Text("Bramble core \(info.coreVersion) · Krusty KMS \(info.krustyVersion)")
                .brambleText(BrambleTypeScale.caption, mono: true)
                .foregroundStyle(skin.muted)
        }
        .sheet(item: $passwordPrompt) { action in
            SkinProvider {
                PasswordPrompt(action: action) { words in
                    revealed = words
                    if action == .delete { dismiss() }
                }
            }
            .environment(store)
        }
        .onDisappear { revealed = [] }
    }
}

/// Re-asks for the password before a sensitive action; the core re-checks it against the vault.
private struct PasswordPrompt: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let action: SettingsView.PasswordAction
    let completed: ([String]) -> Void
    @State private var password = ""
    @State private var error: String?

    var body: some View {
        Screen(
            title: action == .reveal ? "Show recovery phrase" : "Remove wallet",
            subtitle: action == .reveal
                ? "Anyone who sees your phrase can take your funds."
                : "Your funds stay on Starknet, but you'll need your recovery phrase to restore this wallet."
        ) {
            BrambleField(label: "Password", text: $password, secure: true)
            ErrorText(message: error)
            PrimaryButton(title: action == .reveal ? "Show phrase" : "Remove wallet", busy: store.busy) {
                Task {
                    do {
                        if action == .reveal {
                            completed(try await store.revealPhrase(password: password))
                        } else {
                            try await store.deleteWallet(password: password)
                            completed([])
                        }
                        dismiss()
                    } catch { self.error = describe(error) }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
