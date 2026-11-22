import SwiftUI
import UIKit

/// The CSV export handed to the share sheet.
struct ActivityExport: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The platform share sheet over the exported file; `done` hears whether the person completed it.
struct ActivityShareSheet: UIViewControllerRepresentable {
    let export: ActivityExport
    let done: (Bool) -> Void

    func makeUIViewController(context _: Context) -> UIActivityViewController {
        let sheet = UIActivityViewController(activityItems: [export.url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, completed, _, _ in done(completed) }
        return sheet
    }

    func updateUIViewController(_: UIActivityViewController, context _: Context) {
        // The sheet shows one fixed file; nothing changes while it is up.
    }
}

extension WalletStore {
    /// `activityExportToast`: a feed whose on-chain history was unavailable is named as this
    /// device's records only, in the error tone; otherwise a plain confirmation.
    func activityExported() {
        if portfolio.activityView?.historyUnavailable == true {
            toast = "Exported this device's records only — on-chain history was unavailable."
        } else {
            notify("Activity exported")
        }
    }
}
