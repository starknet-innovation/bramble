import BrambleCore
import SwiftUI

/// First-run flow, step for step with the extension's onboarding wizard:
///
///   create: welcome → passphrase → review account → save phrase → confirm backup → all set
///   import: welcome → method → recovery phrase → passphrase → find your accounts → all set
///
/// The vault is written when the passphrase is accepted (the core generates or imports the phrase
/// and seals it in one call); later steps only read public data or the words kept for backup. An
/// imported vault stays "recovery pending" until discovery restores its accounts, so unlocking one
/// resumes at "Find your accounts" (`resumingDiscovery`).
struct OnboardingFlow: View {
    enum Path: Equatable { case create, recover }
    enum Step: Equatable {
        case welcome, importMethod, recoveryPhrase, passphrase, reviewAccount, findAccounts, savePhrase, confirmBackup, complete
    }

    @Environment(WalletStore.self) private var store
    @State private var steps: [Step]
    @State private var path: Path

    init(resumingDiscovery: Bool = false) {
        _steps = State(initialValue: [resumingDiscovery ? .findAccounts : .welcome])
        _path = State(initialValue: resumingDiscovery ? .recover : .create)
    }
    @State private var forward = true
    /// Phrase typed on the recovery step, handed to the core at the passphrase step, then cleared.
    @State private var importedPhrase = ""

    var body: some View {
        ZStack {
            OnboardingCard {
                ZStack {
                    stepView(steps.last ?? .welcome)
                        .id(steps.last)
                        .transition(.asymmetric(
                            insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                            removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
                        ))
                }
                .animation(BrambleEase.out.animation(ms: BrambleMotion.drawerMs), value: steps)
            }
        }
        .background { OnboardingBackdrop() }
    }

    private func push(_ step: Step) {
        forward = true
        steps.append(step)
    }

    private func pop() {
        forward = false
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
                replace(with: path == .create ? .reviewAccount : .findAccounts)
            }
        case .reviewAccount:
            ReviewAccountStep(network: store.network) { replace(with: .savePhrase) }
        case .findAccounts:
            FindAccountsStep { replace(with: .complete) }
        case .savePhrase:
            SavePhraseStep(words: store.pendingBackup) { push(.confirmBackup) }
        case .confirmBackup:
            ConfirmBackupStep(words: store.pendingBackup, back: pop) { replace(with: .complete) }
        case .complete:
            CompleteStep { Task { await store.finishOnboarding() } }
        }
    }
}
