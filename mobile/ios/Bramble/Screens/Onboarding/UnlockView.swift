import SwiftUI

/// `.gate` unlock: the brand disc, "Welcome back", one passphrase field, Unlock at the foot, and
/// the error toast the side panel raises on a wrong passphrase. Laid out in the `.shell` padding
/// with the `.gate` / `.gate-brand` / `.gate-head` / `.gate-cta` metrics.
struct UnlockView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var passphrase = ""
    @State private var failed = false
    @FocusState private var focused: Bool

    var body: some View {
        let gate = BrambleMetrics.Gate.self
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: gate.gap) {
                    Image("BrandMark")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: gate.brandGlyph, height: gate.brandGlyph)
                        .foregroundStyle(skin.accentText)
                        .frame(width: gate.brandSize, height: gate.brandSize)
                        .background(skin.accent, in: Circle())
                        .padding(.top, gate.brandTop)
                        .accessibilityHidden(true)
                    VStack(spacing: gate.headGap) {
                        Text("Welcome back")
                            .brambleText(BrambleTypeStyle(size: gate.titleSize, lineHeight: gate.titleLineHeight), weight: gate.titleWeight, tracking: gate.titleTracking)
                            .accessibilityAddTraits(.isHeader)
                        Text("Unlock your wallet to continue.").brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    }
                    .multilineTextAlignment(.center)
                    VStack(spacing: gate.formGap) {
                        BrambleField(placeholder: "Enter your passphrase", text: $passphrase, secure: true)
                            .focused($focused)
                            .submitLabel(.go)
                            .onSubmit(unlock)
                        StatusLine(text: failed ? "Vault passphrase is incorrect" : nil)
                    }
                }
                .padding(.top, gate.paddingTop)
                .padding(BrambleMetrics.Screen.shellPadding)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            // `.gate-cta` (`margin-top: auto`): at the foot, above the keyboard while it is up.
            PillButton("Unlock", busy: store.busy, action: unlock)
                .disabled(passphrase.isEmpty)
                .padding(.top, gate.ctaTop)
                .padding(BrambleMetrics.Screen.shellPadding)
        }
        .background(skin.bg.ignoresSafeArea())
    }

    private func unlock() {
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
