import SwiftUI

/// "Reliability diagnostics" under Settings → Network: local counters the person exports through
/// the share sheet. Nothing is sent.
struct ReliabilityDiagnosticsDisclosure: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var open = false
    @State private var isOn = ReliabilityDiagnostics.shared.enabled
    @State private var export: ActivityExport?

    var body: some View {
        Disclosure(title: "Reliability diagnostics", summary: isOn ? "On" : "Off", isOpen: $open) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                CheckRow(text: "Keep anonymous RPC and explorer reliability counters on this device", isOn: $isOn)
                Text("Stays on this device until you export it.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                PillButton("Export diagnostics", kind: .secondary, icon: .receive) { exportReport() }
                    .accessibilityIdentifier("diagnostics-export")
            }
        }
        .onChange(of: isOn) { _, next in
            ReliabilityDiagnostics.shared.enabled = next
            store.notify(next ? "Local diagnostics enabled" : "Local diagnostics cleared")
        }
        .sheet(item: $export, onDismiss: Self.removeFile) { file in
            ActivityShareSheet(export: file) { completed in
                export = nil
                Self.removeFile()
                if completed { store.notify("Diagnostics exported") }
            }
        }
    }

    private static var fileURL: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("bramble-diagnostics.json")
    }

    private static func removeFile() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    private func exportReport() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let text = ReliabilityDiagnostics.shared.report(
            accountCount: store.allRecords.count,
            network: store.network,
            version: version
        )
        do {
            try Data(text.utf8).write(to: Self.fileURL, options: .atomic)
            export = ActivityExport(url: Self.fileURL)
        } catch {
            store.toast = "Diagnostic export failed"
        }
    }
}
