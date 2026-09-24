import SwiftUI

/// `.gate` unlock: the brand disc, "Welcome back", one passphrase field, Unlock at the foot, and
/// the error toast the side panel raises on a wrong passphrase. With biometrics on, the system
/// prompt starts once per appearance and a secondary button offers it again; the passphrase
/// always stays usable. While the core throttles attempts the button is disabled and the status
/// line counts down (the core refuses early attempts regardless).
struct UnlockView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var passphrase = ""
    @State private var failed = false

    var body: some View {
        VStack(spacing: BrambleSpace.lg) {
            Image("BrandMark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 34, height: 34)
                .foregroundStyle(skin.accentText)
                .frame(width: BrambleSize.brand, height: BrambleSize.brand)
                .background(skin.accent, in: Circle())
                .padding(.top, BrambleSpace.xl + BrambleSpace.xl)
            VStack(spacing: BrambleSpace.sm) {
                Text("Welcome back").brambleText(BrambleTypeScale.headline, weight: BrambleWeight.heavy, tracking: -0.035)
                Text("Unlock your wallet to continue.").brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            }
            BrambleField(placeholder: "Enter your passphrase", text: $passphrase, secure: true)
                .onSubmit(unlock)
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let remaining = remainingMs
                VStack(spacing: BrambleSpace.sm) {
                    if let notice = store.biometricNotice {
                        StatusLine(text: notice, tone: .danger)
                    }
                    if remaining > 0 {
                        StatusLine(text: throttledText(ms: remaining), tone: .danger)
                    } else {
                        StatusLine(text: failed ? BrambleCopy.incorrectPassphrase : nil, tone: .danger)
                    }
                    Spacer(minLength: 0)
                    if store.security.biometricEnabled {
                        PillButton(biometricTitle, kind: .secondary, icon: .lockKeyhole) {
                            Task { await store.unlockWithBiometric() }
                        }
                    }
                    PillButton("Unlock", busy: store.busy, action: unlock)
                        .disabled(passphrase.isEmpty || remaining > 0)
                }
            }
        }
        .padding(.horizontal, BrambleSpace.lg)
        .padding(.bottom, BrambleSpace.lg)
        .background(skin.bg.ignoresSafeArea())
        .task {
            store.refreshSecurity()
            if store.security.biometricEnabled && store.biometricNotice == nil {
                await store.unlockWithBiometric()
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
        return UInt64(left.components.seconds) * 1000 + UInt64(left.components.attoseconds / 1_000_000_000_000_000)
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
