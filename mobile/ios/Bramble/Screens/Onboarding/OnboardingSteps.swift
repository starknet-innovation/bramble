import BrambleCore
import SwiftUI

// Each step reproduces its extension counterpart in `onboarding-views.ts` / `onboarding-surface.ts`:
// same badge, heading, lede, controls, and CTA copy.

/// `.onboarding-welcome`: wordmark lockup and the two actions.
struct WelcomeStep: View {
    @Environment(\.skin) private var skin
    @Environment(\.deviceClass) private var device
    let create: () -> Void
    let recover: () -> Void

    /// The content box loses the inline inset on both sides.
    private static let insetSides: CGFloat = 2

    var body: some View {
        let metrics = BrambleMetrics.Welcome.self
        let insets = OnboardingInsets(device)
        GeometryReader { proxy in
            VStack(spacing: BrambleMetrics.Onboarding.gap) {
                Image(.brandWordmark)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    // `width: min(60%, 220px)` of the step's content box.
                    .frame(
                        width: min(
                            (proxy.size.width - Self.insetSides * insets.inline) * metrics.wordmarkFraction,
                            metrics.wordmarkWidth
                        )
                    )
                    .foregroundStyle(skin.text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .frame(minHeight: device.short ? metrics.lockupHeightShort : metrics.lockupHeight)
                    .accessibilityLabel("Bramble")
                    .accessibilityAddTraits(.isHeader)
                VStack(spacing: metrics.actionsGap) {
                    PillButton("Create a new wallet", action: create)
                    PillButton("Add an existing wallet", kind: .secondary, action: recover)
                }
            }
            .padding(.horizontal, insets.inline)
            .padding(.top, metrics.paddingTop)
            .padding(.bottom, insets.bottom)
        }
    }
}

struct ImportMethodStep: View {
    let back: () -> Void
    let recoveryPhrase: () -> Void

    var body: some View {
        OnboardingStep(
            back: back,
            icon: .wallet,
            title: "Choose how to add your wallet",
            lede: "Bring an existing Starknet wallet into Bramble."
        ) {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                OptionCard(
                    icon: .book,
                    title: "Recovery phrase",
                    detail: "Import 12 or 24 recovery words from another wallet.",
                    action: recoveryPhrase
                )
                OptionCard(icon: .shield, title: "Ledger hardware wallet", detail: "Coming to Bramble mobile.") {
                    // No action: not yet available on mobile, so the card is disabled.
                }
                .disabled(true)
                OptionCard(icon: .link, title: "Private key", detail: "Coming to Bramble mobile.") {
                    // No action: not yet available on mobile, so the card is disabled.
                }
                .disabled(true)
            }
        } cta: { EmptyView() }
    }
}

struct RecoveryPhraseStep: View {
    let back: () -> Void
    let next: (String) -> Void
    @State private var words = Array(repeating: "", count: RecoveryPhraseWordCount.standard)

    private var complete: Bool {
        words.allSatisfy { isRecoveryWord(word: $0) } && isValidRecoveryPhrase(phrase: words.joined(separator: " "))
    }

    var body: some View {
        let standard = RecoveryPhraseWordCount.standard
        OnboardingStep(
            back: back,
            icon: .book,
            title: "Enter your recovery phrase",
            lede: "Type each word, or paste the complete phrase into the first field. "
                + "Unknown words are flagged as you go."
        ) {
            RecoveryEntryGrid(words: $words)
            Button(words.count == standard ? "Use a 24-word phrase" : "Use a 12-word phrase") {
                words = Array(
                    repeating: "",
                    count: words.count == standard ? RecoveryPhraseWordCount.extended : standard
                )
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
            .brambleText(
                BrambleTypeScale.caption.sized(BrambleMetrics.InlineAction.fontSize),
                weight: BrambleMetrics.Button.weight,
                tracking: BrambleMetrics.Button.tracking
            )
            .foregroundStyle(configuration.isPressed ? skin.text : skin.muted)
            .padding(BrambleMetrics.InlineAction.padding)
            .frame(minHeight: BrambleMetrics.InlineAction.height)
            .background(configuration.isPressed ? skin.hover : .clear, in: Capsule())
    }
}

struct PassphraseStep: View {
    @Environment(WalletStore.self) private var store
    let path: OnboardingFlow.Path
    let back: () -> Void
    let submit: (String) async throws -> Void
    @State private var passphrase = ""
    @State private var confirmation = ""
    @FocusState private var focus: Field?

    private enum Field { case passphrase, confirmation }

    var body: some View {
        let strength = passphraseStrength(passphrase: passphrase)
        let matches = Self.canSubmit(strength, passphrase: passphrase, confirmation: confirmation)
        OnboardingStep(
            back: back,
            icon: .lock,
            title: "Create your vault passphrase",
            lede: "You will use this to unlock Bramble on this device."
        ) {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                BrambleField(
                    label: "Vault passphrase",
                    placeholder: "At least 8 characters",
                    text: $passphrase,
                    secure: true,
                    hint: "Use at least 8 characters; 12 or more is safer. "
                        + "This unlocks the encrypted vault on this device."
                )
                .focused($focus, equals: .passphrase)
                .submitLabel(.next)
                .onSubmit { focus = .confirmation }
                BrambleField(
                    label: "Confirm passphrase",
                    placeholder: "Enter it again",
                    text: $confirmation,
                    secure: true
                )
                .focused($focus, equals: .confirmation)
                .submitLabel(.done)
                PassphraseMeter(strength: strength, status: meterStatus(strength, matches: matches), ready: matches)
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
            .disabled(!matches)
        }
    }

    /// The setup form's one gate: a passphrase the vault accepts (the 8-character floor), matched
    /// by its confirmation. A weak one is named by the meter but needs no acknowledgement.
    nonisolated static func canSubmit(
        _ strength: PassphraseStrength,
        passphrase: String,
        confirmation: String
    ) -> Bool {
        strength.acceptable && !confirmation.isEmpty && passphrase == confirmation
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
        case .weak:
            skin.danger

        case .fair:
            skin.warning

        case .strong:
            skin.positive

        case .empty:
            skin.muted
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
            .animation(
                BrambleMotionPolicy.animation(
                    BrambleEase.out.animation(ms: BrambleMotion.enterMs),
                    reduceMotion: reduceMotion
                ),
                value: strength.ratio
            )
            .accessibilityHidden(true)
            Text(status)
                .brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.Meter.fontSize))
                .foregroundStyle(ready ? skin.positive : skin.muted)
                .accessibilityLabel("Passphrase strength: \(status)")
                .accessibilityAddTraits(.updatesFrequently)
        }
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
        OnboardingStep(
            icon: .book,
            title: "Save your recovery phrase",
            lede: "Write these words down in order and keep them offline."
        ) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                ProtectedWordGrid(words: words, masked: !revealed || captured)
                PillButton(
                    revealed ? "Hide recovery phrase" : "Show recovery phrase",
                    kind: .secondary,
                    icon: .book
                ) { revealed.toggle() }
                Text("Anyone with these words controls the wallet. Bramble cannot recover them for you.")
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.muted)
                StatusLine(
                    text: captured
                        ? "Hidden while the screen is being recorded."
                        : "Reveal the phrase, save it offline, then continue.",
                    tone: captured ? .danger : .muted
                )
            }
        } cta: {
            PillButton("I saved my phrase", action: next).disabled(!revealed)
        }
        .trackingScreenCapture($captured)
        .warnsOnScreenshot()
    }
}

/// `BACKUP_VERIFY_POSITIONS` from `backup-verify.ts`: the 1-based word positions a backup check asks for.
private enum BackupVerifyPosition {
    static let first = 3
    static let second = 7
    static let third = 11
}

private let backupVerifyPositions = [
    BackupVerifyPosition.first,
    BackupVerifyPosition.second,
    BackupVerifyPosition.third
]

struct ConfirmBackupStep: View {
    let words: [String]
    let back: () -> Void
    let next: () -> Void
    @State private var answers = ["", "", ""]
    @FocusState private var focus: Int?

    /// `verifyBackupWords`: trimmed, case-insensitive, every checked position.
    private var confirmed: Bool {
        // `max()` of the fixed, non-empty positions is never nil; `Int.max` would fail closed.
        let highest = backupVerifyPositions.max() ?? Int.max
        return words.count >= highest && zip(backupVerifyPositions, answers).allSatisfy { position, answer in
            let typed = answer.trimmingCharacters(in: .whitespaces).lowercased()
            return !typed.isEmpty && typed == words[position - 1].lowercased()
        }
    }

    var body: some View {
        OnboardingStep(
            back: back,
            icon: .shield,
            title: "Confirm your backup",
            lede: "Enter the requested words to make sure your offline copy is accurate."
        ) {
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

/// `onboardingComplete()`: check mark, heading and one action, centred on the full-bleed complete
/// card (`.onboarding-complete`).
struct CompleteStep: View {
    @Environment(\.skin) private var skin
    let open: () -> Void

    var body: some View {
        let gate = BrambleMetrics.Gate.self
        let complete = BrambleMetrics.Complete.self
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: gate.gap) {
                    BrambleIcon(.check, size: gate.brandGlyph)
                        .foregroundStyle(skin.accentText)
                        .frame(width: gate.brandSize, height: gate.brandSize)
                        .background(skin.positive, in: Circle())
                        .accessibilityHidden(true)
                    Text("You’re all set")
                        .brambleText(
                            BrambleTypeStyle(size: gate.titleSize, lineHeight: gate.titleLineHeight),
                            weight: gate.titleWeight,
                            tracking: BrambleMetrics.Onboarding.titleTracking
                        )
                        .accessibilityAddTraits(.isHeader)
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
