import BrambleCore
import SwiftUI

/// First-run flow, step for step with the extension's onboarding wizard:
///
///   create: welcome → passphrase → review account → save phrase → confirm backup → all set
///   import: welcome → method → recovery phrase → passphrase → review account → all set
///
/// The vault is written when the passphrase is accepted (the core generates or imports the phrase
/// and seals it in one call); later steps only read public data or the words kept for backup.
struct OnboardingFlow: View {
    enum Path: Equatable { case create, recover }
    enum Step: Equatable {
        case welcome, importMethod, recoveryPhrase, passphrase, reviewAccount, savePhrase, confirmBackup, complete

        /// The edge back-swipe runs only on the steps before the vault is written. `welcome` is
        /// the root, and every step from `reviewAccount` on comes after `replace(with:)`, so a
        /// swipe there must do nothing (design-mobile.md 4.6).
        var allowsSwipeBack: Bool {
            switch self {
            case .importMethod, .recoveryPhrase, .passphrase: true
            case .welcome, .reviewAccount, .savePhrase, .confirmBackup, .complete: false
            }
        }
    }

    @Environment(WalletStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var steps: [Step] = [.welcome]
    @State private var path: Path = .create
    @State private var forward = true
    /// Phrase typed on the recovery step, handed to the core at the passphrase step, then cleared.
    @State private var importedPhrase = ""

    var body: some View {
        ZStack {
            OnboardingCard {
                ZStack {
                    stepView(steps.last ?? .welcome)
                        .id(steps.last)
                        .transition(BrambleMotionPolicy.step(forward: forward, reduceMotion: reduceMotion))
                }
                .animation(BrambleMotionPolicy.animation(BrambleSpring.drawer, reduceMotion: reduceMotion), value: steps)
            }
        }
        .background { OnboardingBackdrop() }
        .edgeSwipeBack(enabled: (steps.last ?? .welcome).allowsSwipeBack && steps.count > 1, action: pop)
    }

    private func push(_ step: Step) {
        forward = true
        steps.append(step)
    }

    private func pop() {
        forward = false
        // The recovery step always remounts with empty cells, so the handed-off copy is unreachable
        // once we leave the passphrase step; drop it now rather than at the next submit.
        if steps.last == .passphrase { importedPhrase = "" }
        if steps.count > 1 { steps.removeLast() }
    }

    /// Once the vault exists there is no going back past it.
    private func replace(with step: Step) {
        forward = true
        steps = [step]
    }

    @ViewBuilder
    private func stepView(_ step: Step) -> some View {
        switch step {
        case .welcome:
            WelcomeStep(
                create: { path = .create; push(.passphrase) },
                recover: { path = .recover; push(.importMethod) }
            )
        case .importMethod:
            ImportMethodStep(back: pop, recoveryPhrase: { push(.recoveryPhrase) })
        case .recoveryPhrase:
            RecoveryPhraseStep(back: pop) { phrase in
                importedPhrase = phrase
                push(.passphrase)
            }
        case .passphrase:
            PassphraseStep(path: path, back: pop) { passphrase in
                if path == .create {
                    try await store.create(password: passphrase)
                } else {
                    try await store.importWallet(phrase: importedPhrase, password: passphrase)
                    importedPhrase = ""
                }
                replace(with: .reviewAccount)
            }
        case .reviewAccount:
            ReviewAccountStep(network: store.network) {
                replace(with: path == .create ? .savePhrase : .complete)
            }
        case .savePhrase:
            SavePhraseStep(words: store.pendingBackup) { push(.confirmBackup) }
        case .confirmBackup:
            ConfirmBackupStep(words: store.pendingBackup, back: pop) { replace(with: .complete) }
        case .complete:
            CompleteStep { Task { await store.finishOnboarding() } }
        }
    }
}
