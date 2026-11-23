import SwiftUI

/// `importAccountChooser`: the second stage of "Import an existing account". Mobile imports a
/// private key; another recovery phrase is shown as coming, as onboarding shows what it lacks.
/// "Find my other accounts" and "Ready Ledger account" are left out, as Ledger is on Add account.
struct ImportAccountChooser: View {
    let back: () -> Void
    let importKey: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            FlowHeader(title: "Import an existing account", back: back)
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                OptionCard(icon: .book, title: "Recovery phrase", detail: "Coming to Bramble mobile.") {
                    // No action: another wallet's phrase is not offered yet, and the card is disabled.
                }
                    .disabled(true)
                OptionCard(
                    icon: .link,
                    title: "Private key",
                    detail: "Import a single account from its raw Starknet key.",
                    action: importKey
                )
            }
            Spacer(minLength: 0)
        }
    }
}

/// `importKeyFlow` (Bramble account only: the core imports no Ready key and takes no salt). The
/// key field takes the phrase entry's handling: no autocorrect, capitalisation or AutoFill, an
/// ASCII keyboard (third-party keyboards are blocked app-wide), blurred while the screen is
/// captured, and the clipboard emptied after a paste. The key leaves view state when the import is
/// sent and when the form leaves the screen; a lock removes the wallet's screens with it.
struct ImportKeyForm: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let back: () -> Void
    let imported: () -> Void
    @State private var key = ""
    @State private var result: String?
    @State private var captured = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            FlowHeader(
                title: "Import private key",
                subtitle: "Add a standalone account on \(store.networkInfo.name)",
                back: back
            )
            Text("Anyone with this key controls the account.")
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.danger)
            Text("Your recovery phrase does not restore this account. This key is its only backup.")
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.danger)
            BrambleTextArea(
                label: "Raw Starknet private key",
                placeholder: "0x…",
                text: keyBinding,
                hint: "The key is validated and stored inside the encrypted vault, never in plain settings."
            )
            .blur(radius: captured ? maskedWordBlur : 0)
            .privacySensitive()
            PillButton("Import account", icon: .wallet, busy: store.busy, action: submit)
            StatusLine(text: result, tone: .danger)
            Spacer(minLength: 0)
        }
        .trackingScreenCapture($captured)
        .onDisappear { key = "" }
    }

    /// A jump of more than one character is a paste: empty the clipboard (a write, never a read)
    /// so the key does not linger for other apps or Universal Clipboard.
    private var keyBinding: Binding<String> {
        Binding {
            key
        } set: { value in
            if value.count > key.count + 1 {
                UIPasteboard.general.items = []
                store.notify(BrambleCopy.clipboardCleared)
            }
            key = value
        }
    }

    private func submit() {
        guard !store.busy else { return }
        let privateKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !privateKey.isEmpty else {
            result = "Enter a private key to import"
            return
        }
        key = ""
        result = nil
        Task {
            do {
                try await store.importPrivateKey(privateKey)
                imported()
            } catch {
                result = describe(error)
                store.toast = describe(error)
            }
        }
    }
}
