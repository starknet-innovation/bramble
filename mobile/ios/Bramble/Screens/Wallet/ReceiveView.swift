import SwiftUI

/// `receive` from the activity-and-assets journey (`app/screens/flows.ts`): the active account's
/// address, its Bramble contact card, and its wallet identity (`ReceiveAddressView`).
struct ReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: BrambleMetrics.Receive.gap) {
                FlowHeader(title: "Receive", network: store.networkLabel) { dismiss() }
                if let account = store.activeRecord {
                    ReceiveAddressView(
                        address: account.address,
                        copyLabel: "Copy address",
                        hint: "Only send \(store.networkInfo.name) assets to this address.",
                        signerKey: account.publicKey
                    )
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }
}
