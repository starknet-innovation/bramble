import BrambleCore
import SwiftUI

/// "Hidden accounts" (`hiddenAccountsSection` in `account-names.ts`, docs/accounts.md §2.4a): this
/// network's hidden accounts with the control that shows each again. Renders nothing when none is
/// hidden. The core decides what is hidden; this only renders it.
struct HiddenAccountsSection: View {
    @Environment(WalletStore.self) private var store

    var body: some View {
        if !store.hiddenRecords.isEmpty {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                Eyebrow(text: "Hidden accounts")
                StatusLine(text: "Hidden accounts stay in the wallet, out of the drawer and send pickers.")
                MenuGroup {
                    ForEach(store.hiddenRecords, id: \.id) { record in
                        KeptAccountRow(
                            address: record.address,
                            title: record.displayName,
                            detail: record.shortAddress
                        ) {
                            PillButton("Show", kind: .secondary, icon: .eye, small: true) {
                                Task { await store.setHidden(false, for: record.id) }
                            }
                            .accessibilityLabel("Show \(friendlyAccountName(address: record.address))")
                        }
                    }
                }
            }
        }
    }
}
