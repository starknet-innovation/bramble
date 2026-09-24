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
        Group {
            switch store.route {
            case .welcome: NavigationStack { WelcomeView() }
            case .backup: BackupPhraseView()
            case .locked: UnlockView()
            case .home: HomeView()
            }
        }
        .animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), value: store.route)
    }
}

private struct PrivacyCover: View {
    @Environment(\.skin) private var skin

    var body: some View {
        ZStack {
            skin.bg.ignoresSafeArea()
            BrandMark()
        }
    }
}

/// The Bramble wordmark block used on welcome, unlock, and the privacy cover.
struct BrandMark: View {
    @Environment(\.skin) private var skin

    var body: some View {
        VStack(spacing: BrambleSpace.sm) {
            Image("BrandMark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: BrambleSize.brand, height: BrambleSize.brand)
                .foregroundStyle(skin.text)
            Text("Bramble")
                .brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                .foregroundStyle(skin.text)
        }
    }
}
