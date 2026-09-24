import BrambleCore
import SwiftUI

// Each step reproduces its extension counterpart in `onboarding-views.ts` / `onboarding-surface.ts`:
// same badge, heading, lede, controls, and CTA copy.

/// `.onboarding-welcome`: wordmark lockup, two actions, the local-encryption note.
struct WelcomeStep: View {
    @Environment(\.skin) private var skin
    let create: () -> Void
    let recover: () -> Void

    var body: some View {
        VStack(spacing: BrambleSpace.lg) {
            Spacer()
            Image("BrandWordmark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 220)
                .foregroundStyle(skin.text)
                .accessibilityLabel("Bramble")
            Spacer()
            VStack(spacing: BrambleSpace.sm) {
                PillButton("Create a new wallet", action: create)
                PillButton("Add an existing wallet", kind: .secondary, action: recover)
            }
            HStack(spacing: 6) {
                BrambleIcon(.lock, size: 13)
                Text("Encrypted locally on this device").brambleText(BrambleTypeScale.caption)
            }
            .foregroundStyle(skin.muted)
            .padding(.top, BrambleSpace.sm)
        }
        .padding(.horizontal, 28)
        .padding(.top, 26)
        .padding(.bottom, 30)
    }
}

struct ImportMethodStep: View {
    let back: () -> Void
    let recoveryPhrase: () -> Void

    var body: some View {
        OnboardingStep(back: back, icon: .wallet, title: "Choose how to add your wallet", lede: "Bring an existing Starknet wallet into Bramble.") {
            VStack(spacing: BrambleSpace.md) {
                OptionCard(icon: .book, title: "Recovery phrase", detail: "Import 12 or 24 recovery words from another wallet.", action: recoveryPhrase)
                OptionCard(icon: .shield, title: "Ledger hardware wallet", detail: "Coming to Bramble mobile.") {}
                    .disabled(true)
                OptionCard(icon: .link, title: "Private key", detail: "Coming to Bramble mobile.") {}
                    .disabled(true)
            }
        } cta: { EmptyView() }
    }
}

struct RecoveryPhraseStep: View {
    let back: () -> Void
    let next: (String) -> Void
    @State private var words = Array(repeating: "", count: 12)

    private var complete: Bool {
        words.allSatisfy { isRecoveryWord(word: $0) } && isValidRecoveryPhrase(phrase: words.joined(separator: " "))
    }

    var body: some View {
        OnboardingStep(back: back, icon: .book, title: "Enter your recovery phrase", lede: "Type each word, or paste the complete phrase into the first field. Unknown words are flagged as you go.") {
            RecoveryEntryGrid(words: $words)
            Button(words.count == 12 ? "Use a 24-word phrase" : "Use a 12-word phrase") {
                words = Array(repeating: "", count: words.count == 12 ? 24 : 12)
            }
            .buttonStyle(InlineActionStyle())
        } cta: {
            PillButton("Continue") {
                let phrase = words.joined(separator: " ")
                words = Array(repeating: "", count: words.count)
                next(phrase)
            }
            .disabled(!complete)
        }
    }
}

/// `.onboarding-inline-action`: a muted caption-sized text button.
struct InlineActionStyle: ButtonStyle {
    @Environment(\.skin) private var skin

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
            .foregroundStyle(configuration.isPressed ? skin.text : skin.muted)
            .frame(minHeight: 36)
            .padding(.horizontal, BrambleSpace.md)
    }
}

struct PassphraseStep: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    let path: OnboardingFlow.Path
    let back: () -> Void
    let submit: (String) async throws -> Void
    @State private var passphrase = ""
    @State private var confirmation = ""
    @State private var weakAcknowledged = false

    var body: some View {
        let strength = passphraseStrength(passphrase: passphrase)
        let matches = strength.acceptable && !confirmation.isEmpty && passphrase == confirmation
        OnboardingStep(back: back, icon: .lock, title: "Create your vault passphrase", lede: "You will use this to unlock Bramble on this device.") {
            VStack(spacing: BrambleSpace.md) {
                BrambleField(label: "Vault passphrase", placeholder: "At least 8 characters", text: $passphrase, secure: true,
                             hint: "Use at least 8 characters; 12 or more is safer. This unlocks the encrypted vault on this device.")
                BrambleField(label: "Confirm passphrase", placeholder: "Enter it again", text: $confirmation, secure: true)
                PassphraseMeter(strength: strength, status: meterStatus(strength, matches: matches), ready: matches)
                if strength.needsAcknowledgement {
                    CheckRow(text: "This passphrase is weak. I understand it is all that protects this wallet on this device.", isOn: $weakAcknowledged)
                }
            }
        } cta: {
            PillButton(path == .create ? "Continue" : "Find your accounts", busy: store.busy) {
                Task {
                    do {
                        try await submit(passphrase)
                        passphrase = ""
                        confirmation = ""
                    } catch { store.toast = describe(error) }
                }
            }
            .disabled(!matches || (strength.needsAcknowledgement && !weakAcknowledged))
        }
    }

    /// `applyPassphraseMeter`'s status line.
    private func meterStatus(_ strength: PassphraseStrength, matches: Bool) -> String {
        if !strength.acceptable || confirmation.isEmpty { return strength.hint }
        return matches ? "\(strength.hint) · Passphrases match" : "Passphrases do not match"
    }
}

/// `.password-requirement`: a 4pt track filled by the meter ratio in the band's colour.
struct PassphraseMeter: View {
    @Environment(\.skin) private var skin
    let strength: PassphraseStrength
    let status: String
    let ready: Bool

    private var fill: Color {
        switch strength.level {
        case .weak: skin.danger
        case .fair: skin.warning
        case .strong: skin.positive
        case .empty: skin.muted
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { proxy in
                Capsule().fill(skin.elevated)
                    .overlay(alignment: .leading) {
                        Capsule().fill(fill).frame(width: proxy.size.width * strength.ratio)
                    }
            }
            .frame(height: 4)
            .animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), value: strength.ratio)
            Text(status).brambleText(BrambleTypeScale.caption).foregroundStyle(ready ? skin.positive : skin.muted)
        }
    }
}

/// `#account-preview` with the Mainnet acknowledgement: confirm the derived public address.
struct ReviewAccountStep: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    let network: NetworkId
    let next: () -> Void
    @State private var account: AccountInfo?
    @State private var selected = true
    @State private var acknowledged = false

    var body: some View {
        OnboardingStep(icon: .wallet, title: "Review your account", lede: "Confirm the derived public address, then add it to this wallet.") {
            VStack(spacing: BrambleSpace.md) {
                Button { selected.toggle() } label: {
                    HStack(spacing: BrambleSpace.md) {
                        if let address = account?.address {
                            AccountAvatarView(address: address, size: 40)
                        } else {
                            Circle().fill(skin.panel).frame(width: 40, height: 40)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Primary Bramble account").brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                            Text(account.map { shortAddress($0.address) } ?? "Deriving account…")
                                .brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        BrambleIcon(.check, size: 17).foregroundStyle(skin.bg)
                            .frame(width: 40, height: 40).background(skin.text, in: Circle())
                            .opacity(selected ? 1 : 0).scaleEffect(selected ? 1 : 0.92)
                    }
                    .padding(BrambleSpace.md)
                    .frame(minHeight: 76)
                }
                .buttonStyle(FillPressStyle(fill: selected ? skin.softPress : skin.elevated, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous)))
                if network == .mainnet {
                    CheckRow(text: "I understand this wallet can hold real funds on Starknet Mainnet.", isOn: $acknowledged)
                }
            }
        } cta: {
            PillButton("Add selected account", action: next)
                .disabled(account == nil || !selected || (network == .mainnet && !acknowledged))
        }
        .task { account = try? await store.previewAccount() }
    }
}

/// `data-onboarding-step="generated"`: words stay blurred until deliberately revealed, and are
/// hidden entirely while the screen is recorded or mirrored.
struct SavePhraseStep: View {
    @Environment(\.skin) private var skin
    let words: [String]
    let next: () -> Void
    @State private var revealed = false
    @State private var captured = UIScreen.main.isCaptured

    var body: some View {
        OnboardingStep(icon: .book, title: "Save your recovery phrase", lede: "Write these words down in order and keep them offline.") {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                RecoveryWordGrid(words: words, masked: !revealed || captured)
                PillButton(revealed ? "Hide recovery phrase" : "Show recovery phrase", kind: .secondary, icon: .book) { revealed.toggle() }
                Text("Anyone with these words controls the wallet. Bramble cannot recover them for you.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                StatusLine(text: captured ? "Hidden while the screen is being recorded." : "Reveal the phrase, save it offline, then continue.",
                           tone: captured ? .danger : .muted)
            }
        } cta: {
            PillButton("I saved my phrase", action: next).disabled(!revealed)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
            captured = UIScreen.main.isCaptured
        }
    }
}

/// `BACKUP_VERIFY_POSITIONS` from `backup-verify.ts`.
private let backupVerifyPositions = [3, 7, 11]

struct ConfirmBackupStep: View {
    let words: [String]
    let back: () -> Void
    let next: () -> Void
    @State private var answers = ["", "", ""]

    /// `verifyBackupWords`: trimmed, case-insensitive, every checked position.
    private var confirmed: Bool {
        words.count >= backupVerifyPositions.max()! && zip(backupVerifyPositions, answers).allSatisfy { position, answer in
            let typed = answer.trimmingCharacters(in: .whitespaces).lowercased()
            return !typed.isEmpty && typed == words[position - 1].lowercased()
        }
    }

    var body: some View {
        OnboardingStep(back: back, icon: .shield, title: "Confirm your backup", lede: "Enter the requested words to make sure your offline copy is accurate.") {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                HStack(spacing: BrambleSpace.sm) {
                    ForEach(Array(backupVerifyPositions.enumerated()), id: \.offset) { index, position in
                        BrambleField(label: "Word \(position)", placeholder: "", text: $answers[index])
                    }
                }
                StatusLine(text: confirmed ? "Backup confirmed." : "Enter the requested words to continue.")
            }
        } cta: {
            PillButton("Continue", action: next).disabled(!confirmed)
        }
    }
}

/// `onboardingComplete()`: check mark, eyebrow, heading, the two custody details, one action.
struct CompleteStep: View {
    @Environment(\.skin) private var skin
    let open: () -> Void

    var body: some View {
        VStack(spacing: BrambleSpace.lg) {
            Spacer()
            BrambleIcon(.check, size: 28).foregroundStyle(skin.accentText)
                .frame(width: 64, height: 64).background(skin.positive, in: Circle())
            VStack(spacing: BrambleSpace.sm) {
                Eyebrow(text: "Setup complete")
                Text("You’re all set").brambleText(BrambleTypeScale.headline, weight: BrambleWeight.heavy, tracking: -0.035)
                Text("Your account is ready in Bramble. Receive assets, or deploy when you’re ready.")
                    .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted).multilineTextAlignment(.center)
            }
            VStack(spacing: BrambleSpace.sm) {
                DetailRow(icon: .lock, text: "Vault encrypted locally on this device")
                DetailRow(icon: .shield, text: "Recovery and signing material stay behind the wallet boundary")
            }
            PillButton("Open Bramble", action: open)
            Spacer()
        }
        .padding(.horizontal, 32)
    }
}
