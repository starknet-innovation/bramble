import Foundation

/// Launch-argument hooks for the UI suites, compiled into debug builds only. Release builds have
/// no way to reach them.
enum UITestHooks {
    /// `-BrambleUITestReset`: start from an empty vault directory, so each UI test begins at
    /// onboarding whatever the previous test left behind. Only the published test phrase is ever
    /// used by the suites that pass it.
    static func prepare(vaultDirectory: URL) {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("-BrambleUITestReset") else { return }
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: vaultDirectory,
            includingPropertiesForKeys: nil
        )) ?? []
        for file in contents { try? FileManager.default.removeItem(at: file) }
        #endif
    }
}
