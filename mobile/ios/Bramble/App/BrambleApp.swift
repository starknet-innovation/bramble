import BrambleCore
import SwiftUI

@main
struct BrambleApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var store: WalletStore

    init() {
        let core = try! WalletCore(dataDir: VaultDirectory.prepare().path)
        _store = State(initialValue: WalletStore(core: core))
    }

    var body: some Scene {
        WindowGroup {
            SkinProvider {
                RootView()
                    .environment(store)
                    // Covers the app-switcher snapshot so a phrase or balance never lands in it.
                    .overlay { if phase != .active { PrivacyCover() } }
            }
            .onChange(of: phase) { _, next in
                // Leaving the foreground ends the session: the core zeroizes the phrase.
                if next == .background { store.lock() }
            }
        }
    }
}

/// App-private vault location: Application Support, complete file protection, no backups.
enum VaultDirectory {
    static func prepare() throws -> URL {
        var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("vault", isDirectory: true)
        #if DEBUG
        // UI tests start from an empty wallet (`-BrambleResetData YES`); never in release builds.
        if UserDefaults.standard.bool(forKey: "BrambleResetData") { try? FileManager.default.removeItem(at: url) }
        #endif
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        return url
    }
}

struct RootView: View {
    @Environment(WalletStore.self) private var store

    var body: some View {
        ZStack(alignment: .bottom) {
            switch store.route {
            case .onboarding: OnboardingFlow()
            case .locked: UnlockView()
            case .wallet: WalletShell()
            }
            if let message = store.toast {
                Toast(message: message)
                    .padding(.horizontal, BrambleSpace.md)
                    .padding(.bottom, 76)
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(3))
                        store.toast = nil
                    }
            }
        }
        .animation(BrambleEase.out.animation(ms: BrambleMotion.toastMs), value: store.toast)
        .animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), value: store.route)
    }
}

/// Covers the app-switcher snapshot so no phrase, address, or balance lands in it.
private struct PrivacyCover: View {
    @Environment(\.skin) private var skin

    var body: some View {
        ZStack {
            skin.bg.ignoresSafeArea()
            Image("BrandWordmark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 180)
                .foregroundStyle(skin.text)
        }
    }
}
