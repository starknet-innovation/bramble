import BrambleCore
import SwiftUI

// Each step reproduces its extension counterpart in `onboarding-views.ts` / `onboarding-surface.ts`:
// same badge, heading, lede, controls, and CTA copy.

/// `.onboarding-welcome`: wordmark lockup, two actions, the local-encryption note.
struct WelcomeStep: View {
    @Environment(\.skin) private var skin
    @Environment(\.deviceClass) private var device
    let create: () -> Void
    let recover: () -> Void

    var body: some View {
        let m = BrambleMetrics.Welcome.self
        let insets = OnboardingInsets(device)
        GeometryReader { proxy in
            VStack(spacing: BrambleMetrics.Onboarding.gap) {
                Image("BrandWordmark")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    // `width: min(60%, 220px)` of the step's content box.
                    .frame(width: min((proxy.size.width - 2 * insets.inline) * m.wordmarkFraction, m.wordmarkWidth))
                    .foregroundStyle(skin.text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .frame(minHeight: device.short ? m.lockupHeightShort : m.lockupHeight)
                    .accessibilityLabel("Bramble")
                    .accessibilityAddTraits(.isHeader)
                VStack(spacing: m.actionsGap) {
                    PillButton("Create a new wallet", action: create)
                    PillButton("Add an existing wallet", kind: .secondary, action: recover)
                }
                HStack(spacing: m.noteGap) {
                    BrambleIcon(.lock, size: m.noteGlyph)
                    Text("Encrypted locally on this device").brambleText(BrambleTypeScale.caption.sized(m.noteSize))
                }
                .foregroundStyle(skin.muted)
                .padding(.top, m.noteTop)
                .accessibilityElement(children: .combine)
            }
            .padding(.horizontal, insets.inline)
            .padding(.top, m.paddingTop)
            .padding(.bottom, insets.bottom)
        }
    }
}

struct ImportMethodStep: View {
    let back: () -> Void
    let recoveryPhrase: () -> Void

    var body: some View {
        OnboardingStep(back: back, icon: .wallet, title: "Choose how to add your wallet", lede: "Bring an existing Starknet wallet into Bramble.") {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
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
            .hitTarget(height: BrambleMetrics.InlineAction.height)
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
            .brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.InlineAction.fontSize), weight: BrambleMetrics.Button.weight, tracking: BrambleMetrics.Button.tracking)
            .foregroundStyle(configuration.isPressed ? skin.text : skin.muted)
            .padding(BrambleMetrics.InlineAction.padding)
            .frame(minHeight: BrambleMetrics.InlineAction.height)
            .background(configuration.isPressed ? skin.hover : .clear, in: Capsule())
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
    @FocusState private var focus: Field?

    private enum Field { case passphrase, confirmation }

    var body: some View {
        let strength = passphraseStrength(passphrase: passphrase)
        let matches = strength.acceptable && !confirmation.isEmpty && passphrase == confirmation
        OnboardingStep(back: back, icon: .lock, title: "Create your vault passphrase", lede: "You will use this to unlock Bramble on this device.") {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                BrambleField(label: "Vault passphrase", placeholder: "At least 8 characters", text: $passphrase, secure: true,
                             hint: "Use at least 8 characters; 12 or more is safer. This unlocks the encrypted vault on this device.")
                    .focused($focus, equals: .passphrase)
                    .submitLabel(.next)
                    .onSubmit { focus = .confirmation }
                BrambleField(label: "Confirm passphrase", placeholder: "Enter it again", text: $confirmation, secure: true)
                    .focused($focus, equals: .confirmation)
                    .submitLabel(.done)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
        VStack(alignment: .leading, spacing: BrambleMetrics.Meter.gap) {
            GeometryReader { proxy in
                Capsule().fill(skin.elevated)
                    .overlay(alignment: .leading) {
                        Capsule().fill(fill).frame(width: proxy.size.width * strength.ratio)
                    }
            }
            .frame(height: BrambleMetrics.Meter.barHeight)
            .animation(BrambleMotionPolicy.animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), reduceMotion: reduceMotion), value: strength.ratio)
            .accessibilityHidden(true)
            Text(status)
                .brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.Meter.fontSize))
                .foregroundStyle(ready ? skin.positive : skin.muted)
                .accessibilityLabel("Passphrase strength: \(status)")
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

/// `#account-preview` with the Mainnet acknowledgement: confirm the derived public address.
struct ReviewAccountStep: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(WalletStore.self) private var store
    let network: NetworkId
    let next: () -> Void
    @State private var account: AccountInfo?
    @State private var selected = true
    @State private var acknowledged = false

    var body: some View {
        OnboardingStep(icon: .wallet, title: "Review your account", lede: "Confirm the derived public address, then add it to this wallet.") {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                let option = BrambleMetrics.OnboardingOption.self
                Button { selected.toggle() } label: {
                    HStack(spacing: option.gap) {
                        // `.onboarding-account-avatar`: the account's two-digit position.
                        Text(String(format: "%02d", Int(account?.index ?? 0) + 1))
                            .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.bold)
                            .frame(width: option.iconSize, height: option.iconSize)
                            .background(skin.panel, in: Circle())
                        VStack(alignment: .leading, spacing: option.copyGap) {
                            Text("Primary Bramble account").brambleText(BrambleTypeScale.body.sized(option.titleSize), weight: option.titleWeight)
                            Text(account.map { shortAddress($0.address) } ?? "Deriving account…")
                                .brambleText(BrambleTypeStyle(size: option.detailSize, lineHeight: option.detailLineHeight), weight: BrambleMetrics.Button.weight)
                                .foregroundStyle(selected ? skin.text : skin.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        BrambleIcon(.check, size: BrambleMetrics.OnboardingAccount.checkGlyph).foregroundStyle(skin.bg)
                            .frame(width: option.iconSize, height: option.iconSize).background(skin.text, in: Circle())
                            .opacity(selected ? 1 : 0).scaleEffect(reduceMotion || selected ? 1 : 0.92)
                    }
                    .padding(option.padding)
                    .frame(minHeight: BrambleMetrics.OnboardingAccount.height)
                }
                .buttonStyle(FillPressStyle(fill: selected ? skin.softPress : skin.elevated, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: option.radius, style: .continuous)))
                .elevation(selected ? BrambleElevation.onboardingAccountSelected : nil)
                .animation(BrambleMotionPolicy.animation(BrambleEase.out.animation(ms: BrambleMotion.liftMs), reduceMotion: reduceMotion), value: selected)
                .accessibilityLabel("Primary Bramble account, \(account.map { shortAddress($0.address) } ?? "deriving account")")
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                .accessibilityHint("Selects this account to add")
                .brambleHaptic(.selection, trigger: selected)
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
    @State private var captured = false

    var body: some View {
        OnboardingStep(icon: .book, title: "Save your recovery phrase", lede: "Write these words down in order and keep them offline.") {
            VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                ProtectedWordGrid(words: words, masked: !revealed || captured)
                PillButton(revealed ? "Hide recovery phrase" : "Show recovery phrase", kind: .secondary, icon: .book) { revealed.toggle() }
                Text("Anyone with these words controls the wallet. Bramble cannot recover them for you.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                StatusLine(text: captured ? "Hidden while the screen is being recorded." : "Reveal the phrase, save it offline, then continue.",
                           tone: captured ? .danger : .muted)
            }
        } cta: {
            PillButton("I saved my phrase", action: next).disabled(!revealed)
        }
        .trackingScreenCapture($captured)
        .warnsOnScreenshot()
    }
}

/// `BACKUP_VERIFY_POSITIONS` from `backup-verify.ts`.
private let backupVerifyPositions = [3, 7, 11]

struct ConfirmBackupStep: View {
    let words: [String]
    let back: () -> Void
    let next: () -> Void
    @State private var answers = ["", "", ""]
    @FocusState private var focus: Int?

    /// `verifyBackupWords`: trimmed, case-insensitive, every checked position.
    private var confirmed: Bool {
        words.count >= backupVerifyPositions.max()! && zip(backupVerifyPositions, answers).allSatisfy { position, answer in
            let typed = answer.trimmingCharacters(in: .whitespaces).lowercased()
            return !typed.isEmpty && typed == words[position - 1].lowercased()
        }
    }

    var body: some View {
        OnboardingStep(back: back, icon: .shield, title: "Confirm your backup", lede: "Enter the requested words to make sure your offline copy is accurate.") {
            VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                HStack(spacing: BrambleMetrics.Recovery.gridGap) {
                    ForEach(Array(backupVerifyPositions.enumerated()), id: \.offset) { index, position in
                        BrambleField(label: "Word \(position)", placeholder: "", text: $answers[index])
                            .focused($focus, equals: index)
                            .submitLabel(index == backupVerifyPositions.count - 1 ? .done : .next)
                            .onSubmit { focus = index + 1 < backupVerifyPositions.count ? index + 1 : nil }
                    }
                }
                StatusLine(text: confirmed ? "Backup confirmed." : "Enter the requested words to continue.")
            }
        } cta: {
            PillButton("Continue", action: next).disabled(!confirmed)
        }
    }
}

/// `onboardingComplete()`: check mark, eyebrow, heading, the two custody details, one action,
/// centred on the full-bleed complete card (`.onboarding-complete`).
struct CompleteStep: View {
    @Environment(\.skin) private var skin
    let open: () -> Void

    var body: some View {
        let gate = BrambleMetrics.Gate.self
        let complete = BrambleMetrics.Complete.self
        GeometryReader { proxy in
        ScrollView {
            VStack(spacing: gate.gap) {
                BrambleIcon(.check, size: gate.brandGlyph).foregroundStyle(skin.accentText)
                    .frame(width: gate.brandSize, height: gate.brandSize).background(skin.positive, in: Circle())
                    .accessibilityHidden(true)
                VStack(spacing: gate.headGap) {
                    Eyebrow(text: "Setup complete")
                    Text("You’re all set")
                        .brambleText(BrambleTypeStyle(size: gate.titleSize, lineHeight: gate.titleLineHeight), weight: gate.titleWeight, tracking: BrambleMetrics.Onboarding.titleTracking)
                        .accessibilityAddTraits(.isHeader)
                    Text("Your account is ready in Bramble. Receive assets, or deploy when you’re ready.")
                        .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted).multilineTextAlignment(.center)
                }
                VStack(spacing: complete.detailsGap) {
                    DetailRow(icon: .lock, text: "Vault encrypted locally on this device")
                    DetailRow(icon: .shield, text: "Recovery and signing material stay behind the wallet boundary")
                }
                .frame(maxWidth: complete.detailsWidth)
                PillButton("Open Bramble", action: open).frame(maxWidth: complete.actionsWidth)
            }
            .padding(complete.padding)
            .frame(maxWidth: .infinity, minHeight: proxy.size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
        }
        .elevation(BrambleElevation.onboardingCompletePhone)
    }
}
