import BrambleCore
import SwiftUI

@main
struct BrambleApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase
    @State private var store: WalletStore

    init() {
        let core = try! WalletCore(dataDir: VaultDirectory.prepare().path, clock: DeviceClock())
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
                // Sheets present above the overlay, so the cover also goes up in its own window.
                PrivacyWindow.shared.update(covered: next != .active)
                // Leaving the foreground ends the session: the core zeroizes the phrase.
                if next == .background { store.lock() }
                // Coming back: biometric enrolment and the idle deadline are re-checked.
                if next == .active { store.sceneBecameActive() }
            }
        }
    }
}

/// Blocks third-party keyboards app-wide, so no keyboard extension sees a passphrase or a phrase
/// word, and none can learn from them.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, shouldAllowExtensionPointIdentifier identifier: UIApplication.ExtensionPointIdentifier) -> Bool {
        identifier != .keyboard
    }
}

/// App-private vault location: Application Support, complete file protection, no backups.
enum VaultDirectory {
    static func prepare() throws -> URL {
        var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("vault", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        // createDirectory leaves an existing directory's class alone: re-assert it every launch, so
        // the files the core writes there (vault.json, its .tmp, security.json) inherit it. The
        // app-wide default comes from the Data Protection entitlement (Bramble.entitlements).
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        return url
    }
}

struct RootView: View {
    @Environment(WalletStore.self) private var store

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        DeviceClassReader {
            ZStack(alignment: .bottom) {
                switch store.route {
                case .onboarding: OnboardingFlow()
                case .locked: UnlockView()
                case .wallet: WalletShell()
                }
                // Errors, plus the few confirmations raised through `store.notify`; other success is
                // shown in place by each screen.
                ToastHost(message: store.toast, tone: store.toastTone) { store.toast = nil }
            }
        }
        .animation(BrambleMotionPolicy.animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), reduceMotion: reduceMotion), value: store.route)
        .brambleHaptic(.success, trigger: store.route) { old, new in old != .wallet && new == .wallet }
    }
}

/// Covers the app-switcher snapshot so no phrase, address, or balance lands in it.
struct PrivacyCover: View {
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
