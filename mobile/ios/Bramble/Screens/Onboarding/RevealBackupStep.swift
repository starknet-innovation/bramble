import SwiftUI

/// Resuming a backup that is still pending after an unlock that did not reveal the words (a
/// biometric unlock): the passphrase is checked again by the core's `revealRecoveryPhrase`, as
/// the side panel's reveal-software flow asks, before Save phrase shows the words.
struct RevealBackupStep: View {
    @Environment(WalletStore.self) private var store
    let submit: (String) async throws -> Void
    @State private var passphrase = ""

    var body: some View {
        OnboardingStep(
            icon: .book,
            title: "Finish your backup",
            lede: "Your recovery phrase has not been confirmed yet. Save it and confirm it to open your wallet."
        ) {
            BrambleField(
                label: "Confirm vault passphrase",
                placeholder: "",
                text: $passphrase,
                secure: true,
                hint: "Re-enter it to reveal. An unlocked session alone is not enough."
            )
            .submitLabel(.go)
            .onSubmit(reveal)
            .accessibilityIdentifier("reveal-backup-passphrase")
        } cta: {
            PillButton("Show recovery phrase", icon: .book, busy: store.busy, action: reveal)
                .disabled(passphrase.isEmpty)
        }
        .onDisappear { passphrase = "" }
    }

    private func reveal() {
        guard !passphrase.isEmpty else { return }
        Task {
            do {
                try await submit(passphrase)
                passphrase = ""
            } catch { store.toast = describe(error) }
        }
    }
}
