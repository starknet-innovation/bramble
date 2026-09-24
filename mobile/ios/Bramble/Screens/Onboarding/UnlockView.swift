import SwiftUI

/// `.gate` unlock: the brand disc, "Welcome back", one passphrase field, Unlock at the foot, and
/// the error toast the side panel raises on a wrong passphrase.
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
            StatusLine(text: failed ? "Vault passphrase is incorrect" : nil)
            Spacer()
            PillButton("Unlock", busy: store.busy, action: unlock)
                .disabled(passphrase.isEmpty)
        }
        .padding(.horizontal, BrambleSpace.lg)
        .padding(.bottom, BrambleSpace.lg)
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
