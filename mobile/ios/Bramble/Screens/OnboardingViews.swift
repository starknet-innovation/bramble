import BrambleCore
import SwiftUI

/// First run: create a new phrase or import one, as the extension's onboarding entry.
struct WelcomeView: View {
    @Environment(\.skin) private var skin

    var body: some View {
        VStack(spacing: BrambleSpace.xl) {
            Spacer()
            BrandMark()
            Text("A Starknet wallet whose keys never leave this device.")
                .brambleText(BrambleTypeScale.body)
                .foregroundStyle(skin.muted)
                .multilineTextAlignment(.center)
            Spacer()
            VStack(spacing: BrambleSpace.sm) {
                NavigationLink(value: "create") { primaryLabel("Create a new wallet") }
                NavigationLink(value: "import") { secondaryLabel("I already have a recovery phrase") }
            }
        }
        .padding(BrambleSpace.lg)
        .navigationDestination(for: String.self) { step in
            if step == "create" { CreatePasswordView() } else { ImportView() }
        }
    }

    private func primaryLabel(_ title: String) -> some View {
        Text(title)
            .brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
            .foregroundStyle(skin.accentText)
            .background(skin.accent, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
    }

    private func secondaryLabel(_ title: String) -> some View {
        Text(title)
            .brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
            .foregroundStyle(skin.text)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous).stroke(skin.hairline))
    }
}

/// Password rules shared by create and import. The core enforces the same floor.
struct PasswordFields: View {
    @Binding var password: String
    @Binding var confirmation: String

    var body: some View {
        BrambleField(label: "Password", text: $password, secure: true)
        BrambleField(label: "Confirm password", text: $confirmation, secure: true)
    }

    static func problem(_ password: String, _ confirmation: String) -> String? {
        if password.trimmingCharacters(in: .whitespaces).count < 8 { return "Use at least 8 characters." }
        if password != confirmation { return "Passwords don't match." }
        return nil
    }
}

struct CreatePasswordView: View {
    @Environment(WalletStore.self) private var store
    @State private var password = ""
    @State private var confirmation = ""
    @State private var error: String?

    var body: some View {
        Screen(title: "Set a password", subtitle: "It encrypts your wallet on this device. Bramble can't recover it for you.") {
            PasswordFields(password: $password, confirmation: $confirmation)
            ErrorText(message: error)
            PrimaryButton(title: "Create wallet", busy: store.busy) {
                if let problem = PasswordFields.problem(password, confirmation) { error = problem; return }
                Task {
                    do { try await store.create(password: password) } catch { self.error = describe(error) }
                }
            }
        }
    }
}

/// Shows the new phrase once. The words are hidden while the screen is being recorded or
/// mirrored, and a screenshot raises a warning, since a captured phrase is a stolen wallet.
struct BackupPhraseView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var confirmed = false
    @State private var captured = UIScreen.main.isCaptured
    @State private var screenshotWarning = false

    var body: some View {
        Screen(title: "Write down your recovery phrase", subtitle: "These 12 words are the only way to restore this wallet. Keep them offline, in order, and never share them.") {
            Card {
                if captured {
                    Label("Hidden while the screen is being recorded.", systemImage: "eye.slash")
                        .brambleText(BrambleTypeScale.body).foregroundStyle(skin.warning)
                } else {
                    PhraseGrid(words: store.pendingBackup)
                }
            }
            if screenshotWarning {
                Label("A screenshot of your phrase can be synced or shared. Delete it.", systemImage: "exclamationmark.triangle")
                    .brambleText(BrambleTypeScale.label).foregroundStyle(skin.warning)
            }
            Toggle("I've written it down somewhere safe", isOn: $confirmed)
                .brambleText(BrambleTypeScale.body).foregroundStyle(skin.text)
            PrimaryButton(title: "Continue") { Task { await store.confirmBackup() } }
                .disabled(!confirmed)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
            captured = UIScreen.main.isCaptured
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            screenshotWarning = true
        }
    }
}

struct PhraseGrid: View {
    @Environment(\.skin) private var skin
    let words: [String]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: BrambleSpace.sm) {
            ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                HStack(spacing: BrambleSpace.sm) {
                    Text("\(index + 1)").brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted)
                        .frame(width: 20, alignment: .trailing)
                    Text(word).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium, mono: true).foregroundStyle(skin.text)
                }
                .privacySensitive()
            }
        }
    }
}

struct ImportView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var phrase = ""
    @State private var passphrase = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var error: String?

    var body: some View {
        Screen(title: "Import a wallet", subtitle: "Enter your 12–24 word recovery phrase.") {
            VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                Text("Recovery phrase").brambleText(BrambleTypeScale.label, weight: BrambleWeight.medium).foregroundStyle(skin.muted)
                TextEditor(text: $phrase)
                    .accessibilityLabel("Recovery phrase")
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .brambleText(BrambleTypeScale.row, mono: true)
                    .scrollContentBackground(.hidden)
                    .padding(BrambleSpace.sm)
                    .frame(minHeight: 120)
                    .background(skin.sunken, in: RoundedRectangle(cornerRadius: BrambleRadius.sm, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: BrambleRadius.sm, style: .continuous).stroke(skin.border))
                    .privacySensitive()
            }
            BrambleField(label: "BIP-39 passphrase (optional)", text: $passphrase, secure: true)
            PasswordFields(password: $password, confirmation: $confirmation)
            ErrorText(message: error)
            PrimaryButton(title: "Import wallet", busy: store.busy) {
                guard isValidRecoveryPhrase(phrase: phrase) else { error = "That isn't a valid recovery phrase."; return }
                if let problem = PasswordFields.problem(password, confirmation) { error = problem; return }
                Task {
                    do {
                        try await store.importWallet(phrase: phrase, password: password, passphrase: passphrase.isEmpty ? nil : passphrase)
                        phrase = ""
                    } catch { self.error = describe(error) }
                }
            }
        }
    }
}

struct UnlockView: View {
    @Environment(WalletStore.self) private var store
    @State private var password = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: BrambleSpace.xl) {
            Spacer()
            BrandMark()
            BrambleField(label: "Password", text: $password, secure: true)
                .onSubmit(unlock)
            ErrorText(message: error)
            PrimaryButton(title: "Unlock", busy: store.busy, action: unlock)
            Spacer()
        }
        .padding(BrambleSpace.lg)
    }

    private func unlock() {
        Task {
            do {
                try await store.unlock(password: password)
                password = ""
            } catch { self.error = describe(error) }
        }
    }
}

/// User-facing text for a core error. Never includes input.
func describe(_ error: Error) -> String {
    switch error as? CoreError {
    case .WrongPassword: "Wrong password."
    case .InvalidInput(let reason): reason.prefix(1).uppercased() + reason.dropFirst() + "."
    case .WalletExists: "A wallet already exists on this device."
    case .Locked: "The wallet is locked."
    default: "Something went wrong. Please try again."
    }
}
