import SwiftUI

/// `.gate` unlock: the brand disc, "Welcome back", one passphrase field, Unlock at the foot, and
/// the error toast the side panel raises on a wrong passphrase. Laid out in the `.shell` padding
/// with the `.gate` / `.gate-brand` / `.gate-head` / `.gate-cta` metrics. With biometrics on, the
/// system prompt starts once per appearance and a secondary button offers it again; the passphrase
/// always stays usable. While the core throttles attempts the button is disabled and the status
/// line counts down (the core refuses early attempts regardless).
struct UnlockView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var passphrase = ""
    @State private var failed = false
    @FocusState private var focused: Bool

    private static let millisecondsPerSecond: UInt64 = 1_000
    private static let attosecondsPerMillisecond: Int64 = 1_000_000_000_000_000

    var body: some View {
        let gate = BrambleMetrics.Gate.self
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: gate.gap) {
                    brandMark
                    heading
                    VStack(spacing: gate.formGap) {
                        BrambleField(placeholder: "Enter your passphrase", text: $passphrase, secure: true)
                            .focused($focused)
                            .submitLabel(.go)
                            .onSubmit(unlock)
                        status
                    }
                }
                .padding(.top, gate.paddingTop)
                .padding(BrambleMetrics.Screen.shellPadding)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            // `.gate-cta` (`margin-top: auto`): at the foot, above the keyboard while it is up. The
            // biometric button sits above Unlock as the secondary action.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let remaining = remainingMs
                VStack(spacing: gate.ctaGap) {
                    if store.security.biometricEnabled {
                        PillButton(biometricTitle, kind: .secondary, icon: .lockKeyhole) {
                            Task { await store.unlockWithBiometric() }
                        }
                    }
                    PillButton("Unlock", busy: store.busy, action: unlock)
                        .disabled(passphrase.isEmpty || remaining > 0)
                }
                .toastAnchor()
            }
            .padding(.top, gate.ctaTop)
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .background(skin.bg.ignoresSafeArea())
        .task {
            store.refreshSecurity()
            if store.security.biometricEnabled, store.biometricNotice == nil {
                await store.unlockWithBiometric()
            }
        }
    }

    /// `.gate-brand`: the brand mark on the accent disc.
    private var brandMark: some View {
        let gate = BrambleMetrics.Gate.self
        return Image(.brandMark)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: gate.brandGlyph, height: gate.brandGlyph)
            .foregroundStyle(skin.accentText)
            .frame(width: gate.brandSize, height: gate.brandSize)
            .background(skin.accent, in: Circle())
            .padding(.top, gate.brandTop)
            .accessibilityHidden(true)
    }

    /// `.gate-head`: the title and the lede.
    private var heading: some View {
        let gate = BrambleMetrics.Gate.self
        return VStack(spacing: gate.headGap) {
            Text("Welcome back")
                .brambleText(
                    BrambleTypeStyle(size: gate.titleSize, lineHeight: gate.titleLineHeight),
                    weight: gate.titleWeight,
                    tracking: gate.titleTracking
                )
                .accessibilityAddTraits(.isHeader)
            Text("Unlock your wallet to continue.")
                .brambleText(BrambleTypeScale.body)
                .foregroundStyle(skin.muted)
        }
        .multilineTextAlignment(.center)
    }

    /// The biometric-invalidation notice, then either the throttle countdown or the wrong-passphrase
    /// line, refreshed every second so the countdown ticks.
    private var status: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let remaining = remainingMs
            VStack(spacing: BrambleMetrics.Gate.formGap) {
                if let notice = store.biometricNotice {
                    StatusLine(text: notice, tone: .danger)
                }
                if remaining > 0 {
                    StatusLine(text: throttledText(ms: remaining), tone: .danger)
                } else {
                    StatusLine(text: failed ? BrambleCopy.incorrectPassphrase : nil, tone: .danger)
                }
            }
        }
    }

    private var biometricTitle: String {
        BrambleCopy.unlockWithBiometry.replacingOccurrences(of: "{biometry}", with: BiometricKeychain.name)
    }

    private var remainingMs: UInt64 {
        guard let retryAt = store.retryAt else { return 0 }
        let left = ContinuousClock.now.duration(to: retryAt)
        guard left > .zero else { return 0 }
        return UInt64(left.components.seconds) * Self.millisecondsPerSecond
            + UInt64(left.components.attoseconds / Self.attosecondsPerMillisecond)
    }

    private func unlock() {
        guard !passphrase.isEmpty, remainingMs == 0 else { return }
        Task {
            do {
                try await store.unlock(password: passphrase)
                passphrase = ""
                failed = false
            } catch {
                failed = true
                store.toast = describe(error)
            }
        }
    }
}
