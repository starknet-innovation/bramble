import Foundation

/// Where the portfolio and activity caches live: `Application Support/portfolio/`, each file with
/// complete protection and excluded from backup, written atomically (write-then-rename). The
/// documents are public metadata the core produced and validates on read; nothing here parses them.
/// Activity is not here: the core keeps the one activity log beside the vault.
struct PortfolioFiles: Sendable {
    enum Name: String, CaseIterable, Sendable {
        case preferences, prices, snapshots
    }

    let directory: URL

    /// The app's own location, created on first use.
    static func standard() -> PortfolioFiles {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let files = PortfolioFiles(directory: base.appendingPathComponent("portfolio", isDirectory: true))
        #if DEBUG
        // UI tests start a degraded story from empty caches (`-BrambleUITestFreshCaches YES`); only
        // honoured together with the fixture network, and compiled out of release builds.
        if PortfolioNetworkStub.scenario != nil, UserDefaults.standard.bool(forKey: "BrambleUITestFreshCaches") {
            files.removeAll()
        }
        #endif
        return files
    }

    func read(_ name: Name) -> String? {
        try? String(contentsOf: url(name), encoding: .utf8)
    }

    func write(_ name: Name, _ text: String) {
        do {
            try prepare()
            let target = url(name)
            try Data(text.utf8).write(to: target, options: [.atomic, .completeFileProtection])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = target
            try mutable.setResourceValues(values)
        } catch {
            // A cache that cannot be written is only a cache: the next launch refetches.
        }
    }

    /// Removes every cache (delete wallet).
    func removeAll() {
        try? FileManager.default.removeItem(at: directory)
    }

    func url(_ name: Name) -> URL {
        directory.appendingPathComponent("\(name.rawValue).json")
    }

    private func prepare() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = directory
        try mutable.setResourceValues(values)
    }
}
