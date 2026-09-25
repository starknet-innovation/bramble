import SwiftUI

/// `Unlock & auto-lock`: the extension's settings-flow layout (flow header, eyebrow sections, a
/// status line) in the `.shell` padding with the `.section` gap, like the other settings flows.
/// Biometric unlock is an Off/On segmented control, as Appearance uses, because the ui-kit has no
/// switch. Turning it on re-checks the passphrase in the core first; turning it off
/// needs no key. Auto-lock is the extension's fixed policy, shown read-only.
struct SecurityView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var choice = false
    @State private var confirming = false
    @State private var passphrase = ""

    /// Milliseconds in a minute, to show the idle lock in whole minutes.
    private static let millisecondsPerMinute: UInt64 = 60_000

    private var biometry: String { BiometricKeychain.name }

    private func fill(_ text: String) -> String {
        text.replacingOccurrences(of: "{biometry}", with: biometry)
            .replacingOccurrences(of: "{minutes}", with: "\(BrambleCopy.idleLockMs / Self.millisecondsPerMinute)")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: BrambleCopy.securityTitle,
                    subtitle: BrambleCopy.securitySubtitle,
                    network: store.networkLabel
                ) { dismiss() }
                // `.section`: each eyebrow sits over its controls at the section gap.
                VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                    Eyebrow(text: BrambleCopy.biometricEyebrow)
                    SegmentedControl(options: [("Off", false), ("On", true)], selection: $choice)
                        .disabled(!BiometricKeychain.available && !store.security.biometricEnabled)
                        .accessibilityIdentifier("biometric-choice")
                    if confirming {
                        BrambleField(
                            label: "Confirm vault passphrase",
                            placeholder: "",
                            text: $passphrase,
                            secure: true
                        )
                        PillButton(
                            fill(BrambleCopy.biometricEnable),
                            icon: .lockKeyhole,
                            busy: store.busy,
                            action: enable
                        )
                            .disabled(passphrase.isEmpty || store.retryAt != nil)
                    }
                    StatusLine(
                        text: status,
                        tone: !BiometricKeychain.available && !store.security.biometricEnabled ? .danger : .muted
                    )
                }
                VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                    Eyebrow(text: BrambleCopy.autoLockEyebrow)
                    DetailRow(icon: .lockKeyhole, text: fill(BrambleCopy.autoLockIdle))
                    DetailRow(icon: .lock, text: BrambleCopy.autoLockBackground)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .onAppear {
            store.refreshSecurity()
            choice = store.security.biometricEnabled
        }
        .onChange(of: choice) { _, turnedOn in
            if turnedOn == store.security.biometricEnabled {
                confirming = false
            } else if turnedOn {
                confirming = true
            } else {
                store.disableBiometric()
                confirming = false
            }
        }
        .onDisappear { passphrase = "" }
    }

    private var status: String? {
        if store.security.biometricEnabled { return fill(BrambleCopy.biometricOnStatus) }
        if !BiometricKeychain.available { return fill(BrambleCopy.biometricUnavailable) }
        return nil
    }

    private func enable() {
        Task {
            do {
                try await store.enableBiometric(password: passphrase)
                passphrase = ""
                confirming = false
            } catch {
                switch error {
                case BiometricKeychain.Failure.cancelled:
                    break

                case is BiometricKeychain.Failure:
                    store.toast = fill(BrambleCopy.biometricUnavailable)

                default:
                    store.toast = describe(error)
                }
                choice = store.security.biometricEnabled
            }
        }
    }
}
