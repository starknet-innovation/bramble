import BrambleCore
import SwiftUI

/// The accounts the vault holds that mobile keeps but does not operate (`unusableAccounts`,
/// docs/accounts.md §2.4a), read-only, each with why. The extension has no counterpart: it
/// operates all of them. Renders nothing when the list is empty.
struct UnusableAccountsSection: View {
    let accounts: [UnusableAccount]

    var body: some View {
        if !accounts.isEmpty {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                Eyebrow(text: "Not usable on this device")
                StatusLine(text: "These accounts stay in your wallet. Use them in the Bramble extension.")
                MenuGroup {
                    ForEach(accounts, id: \.id) { account in
                        KeptAccountRow(
                            address: account.address,
                            title: account.shortAddress,
                            detail: unusableReasonText(account)
                        ) { EmptyView() }
                    }
                }
            }
        }
    }
}

/// Why mobile keeps an account without operating it, in one plain line.
func unusableReasonText(_ account: UnusableAccount) -> String {
    switch account.reason {
    case .ledger:
        "Ledger account. Ledger isn't on mobile yet."

    case .importedPhrase:
        "From another recovery phrase."

    case .otherNetwork:
        "On \(account.networkId), which mobile doesn't support."

    case .notDerivedHere:
        "Mobile can't derive this account's key."
    }
}
